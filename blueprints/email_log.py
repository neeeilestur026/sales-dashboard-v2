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
import re
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
_USERS_CACHE_TTL = 600         # backend user roster cached 10 min
_SENT_TTL_TODAY = 120          # sent-mail cache: today's list refreshes every ~2 min
_SENT_TTL_PAST = 3600          # past dates are immutable history — cache 1 h
_SENT_CACHE_MAX = 500          # bound memory
_session_cache: dict[str, dict] = {}   # token -> { username, role, _ts }
_creds_cache: dict[str, dict] = {}     # username -> { enc_blob, _ts }
_users_cache: dict = {}                # { users: [...], _ts }
_sent_mail_cache: dict = {}            # (username, date) -> { emails, meta, addr, _ts }


def _email_config_problem() -> Optional[str]:
    """If the server can't do email at all (missing deploy config), return an actionable message.
    Without DASHBOARD_APPS_SCRIPT_URL the backend can't reach Code.gs to validate the session, so every
    call would otherwise fail with a misleading 401 'Invalid session' — surface the real cause instead."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return ("Email service is not configured on the server: DASHBOARD_APPS_SCRIPT_URL is not set. "
                "Set it (and EMAIL_CRED_KEY / INTERNAL_SHARED_SECRET) in the deployment's Environment, "
                "then redeploy.")
    if not EMAIL_CRED_KEY:
        return ("Email service is not configured on the server: EMAIL_CRED_KEY is not set. "
                "Set it in the deployment's Environment, then redeploy.")
    return None


def _fernet() -> Optional[Fernet]:
    if not EMAIL_CRED_KEY:
        return None
    try:
        return Fernet(EMAIL_CRED_KEY.encode() if isinstance(EMAIL_CRED_KEY, str) else EMAIL_CRED_KEY)
    except Exception as exc:
        logger.error("Invalid EMAIL_CRED_KEY: %s", exc)
        return None


def _gs_post(payload: dict, timeout: int = 30) -> dict:
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
        logger.error("_gs_post error: %s", exc)
        return {"success": False, "message": str(exc)}


def _validate_session(token: str) -> Optional[dict]:
    """Return { username, role } if token is valid, else None. Caches 5 min.

    Retries once on a TRANSPORT failure (Code.gs unreachable / transient error) so a burst of
    concurrent requests on a cold cache doesn't 401 spuriously. An explicitly invalid token
    (Code.gs answered, said no) is never retried."""
    if not token:
        return None
    now = time.time()
    cached = _session_cache.get(token)
    if cached and (now - cached["_ts"]) < _SESSION_CACHE_TTL:
        return {"username": cached["username"], "role": cached["role"]}
    result = _gs_post({"action": "validateSession", "token": token})
    # _gs_post's exception path returns {success:False, message:<transport error>} with no 'valid' key;
    # a real Code.gs "invalid token" reply carries valid:False. Retry only the former.
    if not result.get("success") and "valid" not in result:
        time.sleep(0.5)
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
        if str(result.get("message", "")).strip().lower() == "forbidden":
            logger.warning("getEmailCredentialsForBackend Forbidden — INTERNAL_SHARED_SECRET mismatch "
                           "with Code.gs; set the matching Script Property in the Code.gs project.")
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
    # 15s socket timeout: a hung GoDaddy connection must fail fast instead of stalling a worker.
    conn = imaplib.IMAP4_SSL(GODADDY_IMAP_HOST, GODADDY_IMAP_PORT, timeout=15)
    conn.login(addr, pwd)
    return conn


# Candidate folder names per logical mailbox (servers differ).
_FOLDER_CANDIDATES = {
    "inbox": ('"INBOX"', 'INBOX'),
    "sent": ('"Sent"', '"Sent Items"', '"INBOX.Sent"', '"INBOX.Sent Items"', 'Sent', 'Sent Items'),
    "spam": ('"Junk"', '"Spam"', '"Junk E-mail"', '"INBOX.Junk"', '"INBOX.spam"',
             '"Bulk Mail"', 'Junk', 'Spam'),
}

_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\)\s+(?:"[^"]*"|NIL)\s+(?P<name>"(?:[^"\\]|\\.)*"|\S+)\s*$')


def _list_mailboxes(conn: imaplib.IMAP4_SSL) -> list[tuple[str, str]]:
    """Return [(flags_lower, mailbox_name), …] from IMAP LIST (name unquoted)."""
    out = []
    try:
        typ, data = conn.list()
        if typ != "OK" or not data:
            return out
        for line in data:
            if line is None:
                continue
            b = line if isinstance(line, bytes) else str(line).encode()
            m = _LIST_RE.search(b)
            if not m:
                continue
            flags = m.group("flags").decode(errors="replace").lower()
            name = m.group("name").decode(errors="replace")
            if name.startswith('"') and name.endswith('"'):
                name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            out.append((flags, name))
    except imaplib.IMAP4.error:
        pass
    return out


def _mailbox_count(conn: imaplib.IMAP4_SSL, name: str) -> int:
    """SELECT a mailbox read-only and return its message count, or -1 if it can't be opened."""
    try:
        typ, data = conn.select('"' + name.replace('"', '\\"') + '"', readonly=True)
        if typ == "OK" and data and data[0] is not None:
            return int(data[0])
    except (imaplib.IMAP4.error, ValueError, TypeError):
        pass
    return -1


def _find_sent_mailbox(conn: imaplib.IMAP4_SSL) -> Optional[str]:
    """Discover the REAL Sent mailbox: prefer the \\Sent special-use folder, then a 'sent'-named one,
    preferring a mailbox that actually contains messages (avoids an empty decoy 'Sent')."""
    boxes = _list_mailboxes(conn)
    special = [nm for fl, nm in boxes if "\\sent" in fl]
    named = [nm for fl, nm in boxes if re.search(r'(^|[./\\])sent', nm, re.I)]
    # ordered, de-duped candidates: special-use first, then sent-named
    ordered = []
    for nm in special + named:
        if nm not in ordered:
            ordered.append(nm)
    if not ordered:
        return None
    best = None
    for nm in ordered:
        c = _mailbox_count(conn, nm)
        if c > 0:
            return nm            # a populated sent folder — use it
        if c == 0 and best is None:
            best = nm            # remember an openable-but-empty one as fallback
    return best or ordered[0]


def _open_sent(conn: imaplib.IMAP4_SSL) -> Optional[str]:
    """Open the Sent folder read-only; returns the selected mailbox name, or None."""
    nm = _find_sent_mailbox(conn)
    if nm and _mailbox_count(conn, nm) >= 0:
        return nm
    # Fallback: the old hardcoded candidate list, preferring one with messages.
    empty = None
    for folder in _FOLDER_CANDIDATES["sent"]:
        try:
            typ, data = conn.select(folder, readonly=True)
        except imaplib.IMAP4.error:
            continue
        if typ == "OK":
            try:
                n = int(data[0]) if data and data[0] is not None else 0
            except (ValueError, TypeError):
                n = 0
            if n > 0:
                return folder.strip('"')
            if empty is None:
                empty = folder.strip('"')
    return empty


def _select_sent(conn: imaplib.IMAP4_SSL) -> bool:
    return _open_sent(conn) is not None


def _select_folder(conn: imaplib.IMAP4_SSL, kind: str) -> bool:
    """Select a logical folder (inbox/sent/spam) read-only; True if found."""
    if kind == "sent":
        return _open_sent(conn) is not None
    for folder in _FOLDER_CANDIDATES.get(kind, ()):
        try:
            typ, _ = conn.select(folder, readonly=True)
            if typ == "OK":
                return True
        except imaplib.IMAP4.error:
            continue
    return False


# ── Incoming-email classification (rule-based, B2B industrial distributor) ──
_PRINCIPAL_HINTS = ("powerteam", "cejn", "radtorque", "rad torque", "rad-torque", "spx", "spxflow")


def _classify(from_addr: str, from_name: str, subject: str, my_domain: str) -> str:
    addr = (from_addr or "").lower()
    name = (from_name or "").lower()
    subj = (subject or "").lower()
    blob = name + " " + subj + " " + addr
    sender_domain = addr.split("@", 1)[1] if "@" in addr else ""

    def has(*words):
        return any(w in blob for w in words)

    # Internal — same domain as the connected mailbox.
    if my_domain and sender_domain.endswith(my_domain):
        return "Internal"
    # Supplier / Principal — known principals by domain or name.
    if any(h in sender_domain for h in _PRINCIPAL_HINTS) or any(h in blob for h in _PRINCIPAL_HINTS):
        return "Supplier/Principal"
    # Newsletter / promo / no-reply senders.
    if addr.startswith(("noreply", "no-reply", "donotreply", "do-not-reply", "newsletter", "mailer", "notifications")) \
       or has("unsubscribe", "newsletter", "webinar", "% off", "promo", "promotion", "marketing email"):
        return "Newsletter/Promo"
    # Purchase order / order.
    if has("purchase order", "p.o.", "po no", "po#", "order confirmation", "sales order"):
        return "Purchase Order"
    # Finance / payment.
    if has("payment", "remittance", "statement of account", "soa", "billing", "official receipt",
           "credit memo", "debit memo", "invoice", "collection"):
        return "Finance/Payment"
    # Sales inquiry / RFQ.
    if has("inquiry", "enquiry", "quotation", "quote", "rfq", "request for quote", "price",
           "pricelist", "price list", "availability", "canvass", "interested", "looking for"):
        return "Sales Inquiry/RFQ"
    return "Other"


def fetch_folder(addr: str, pwd: str, kind: str, days: int = 14, cap: int = 250) -> list[dict]:
    """Fetch recent message headers from a logical folder (inbox/sent/spam) within `days`.
    Inbox/Spam messages are classified. Returns newest-first, capped at `cap`."""
    my_domain = addr.split("@", 1)[1].lower() if "@" in addr else ""
    conn = _imap_login(addr, pwd)
    try:
        if not _select_folder(conn, kind):
            raise RuntimeError(f"Could not open {kind} folder")
        since_dt = datetime.now(PH_TZ) - timedelta(days=max(1, int(days)))
        date_str = since_dt.strftime("%d-%b-%Y")
        typ, data = conn.search(None, f"SINCE {date_str}")
        if typ != "OK" or not data or not data[0]:
            return []
        ids = data[0].split()
        if not ids:
            return []
        # Newest first; cap to protect the gateway timeout on busy mailboxes.
        ids = ids[::-1][:cap]
        id_set = b",".join(ids)
        typ, msg_data = conn.fetch(id_set, "(BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])")
        if typ != "OK" or not msg_data:
            return []
        out = []
        for part in msg_data:
            if not isinstance(part, tuple) or len(part) < 2:
                continue
            msg = email_pkg.message_from_bytes(part[1])
            subject = _decode_mime(msg.get("Subject", ""))
            date_hdr = msg.get("Date", "")
            message_id = (msg.get("Message-ID", "") or "").strip("<>")
            try:
                dt = parsedate_to_datetime(date_hdr) if date_hdr else None
            except (TypeError, ValueError):
                dt = None
            iso = dt.astimezone(PH_TZ).isoformat() if dt else date_hdr

            if kind == "sent":
                raw = (_decode_mime(msg.get("To", "")) or _decode_mime(msg.get("Cc", "")))
                pname, paddr = "", ""
                for n, a in (getaddresses([raw]) if raw else []):
                    if a:
                        pname, paddr = n, a
                        break
                out.append({
                    "name": pname or paddr, "recipient": paddr,
                    "company": _company_from_email(paddr),
                    "subject": subject, "date": iso, "messageId": message_id,
                })
            else:
                raw = _decode_mime(msg.get("From", ""))
                fname, faddr = "", ""
                for n, a in (getaddresses([raw]) if raw else []):
                    if a:
                        fname, faddr = n, a
                        break
                out.append({
                    "name": fname or faddr, "from": faddr,
                    "company": _company_from_email(faddr),
                    "subject": subject, "date": iso, "messageId": message_id,
                    "category": _classify(faddr, fname, subject, my_domain),
                })
        # parsedate may be missing/garbled; keep server order (already newest-first by id).
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


def fetch_sent_today(addr: str, pwd: str, target_date: str = None, debug: dict = None) -> list[dict]:
    """Connect to GoDaddy IMAP; return headers for emails sent on `target_date` (PH local, YYYY-MM-DD),
    or today when omitted."""
    conn = _imap_login(addr, pwd)
    try:
        folder = _open_sent(conn)
        if not folder:
            raise RuntimeError("Could not open Sent folder")
        if debug is not None:
            debug["folder"] = folder
        today_ph = datetime.now(PH_TZ).date()
        target = today_ph
        if target_date:
            try:
                target = datetime.strptime(target_date, "%Y-%m-%d").date()
            except (TypeError, ValueError):
                target = today_ph
        is_today = (target == today_ph)
        if debug is not None:
            debug["date"] = target.isoformat()
        # Bound the IMAP search to the target day (±1 day covers PH↔server timezone edges); then filter
        # client-side to exactly `target` in PH local time.
        since_str = (target - timedelta(days=1)).strftime("%d-%b-%Y")
        before_str = (target + timedelta(days=2)).strftime("%d-%b-%Y")
        typ, data = conn.search(None, f'SINCE {since_str} BEFORE {before_str}')
        if typ != "OK" or not data or not data[0]:
            if debug is not None:
                debug["windowCount"] = 0
            return []
        ids = data[0].split()
        if debug is not None:
            debug["windowCount"] = len(ids)
        if not ids:
            return []
        # Batch fetch all headers in a single round-trip — sequential per-id fetches
        # over 50+ messages exceeds Render's gateway timeout (502). INTERNALDATE is a
        # reliable fallback when the Date header is missing/oddly-stamped by webmail.
        id_set = b",".join(ids)
        typ, msg_data = conn.fetch(id_set, "(INTERNALDATE BODY.PEEK[HEADER.FIELDS (TO CC BCC SUBJECT DATE MESSAGE-ID)])")
        if typ != "OK" or not msg_data:
            return []
        out = []
        for part in msg_data:
            if not isinstance(part, tuple) or len(part) < 2:
                continue
            envelope = part[0] if isinstance(part[0], (bytes, bytearray)) else b""
            hdr_bytes = part[1]
            msg = email_pkg.message_from_bytes(hdr_bytes)
            subject = _decode_mime(msg.get("Subject", ""))
            date_hdr = msg.get("Date", "")
            message_id = (msg.get("Message-ID", "") or "").strip("<>")
            # Prefer the Date header; fall back to the server INTERNALDATE when it's missing/unparseable.
            sent_dt = None
            try:
                sent_dt = parsedate_to_datetime(date_hdr) if date_hdr else None
            except (TypeError, ValueError):
                sent_dt = None
            if sent_dt is None:
                try:
                    tup = imaplib.Internaldate2tuple(envelope)
                    if tup:
                        sent_dt = datetime.fromtimestamp(time.mktime(tup), tz=timezone.utc)
                except Exception:
                    sent_dt = None
            # Keep only messages sent on the target PH date. Undated messages are kept only for "today"
            # (so a past-date window doesn't leak undated mail).
            if sent_dt:
                if sent_dt.astimezone(PH_TZ).date() != target:
                    continue
            elif not is_today:
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
        if debug is not None:
            debug["matched"] = len(out)
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
    _cfg = _email_config_problem()
    if _cfg or not INTERNAL_SHARED_SECRET:
        return jsonify({"success": False, "message": _cfg or "Email service is not configured on the server: INTERNAL_SHARED_SECRET is not set."}), 503
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
        msg = result.get("message", "Failed to save")
        # Code.gs rejected the shared secret — a config mismatch, not a server crash.
        if str(msg).strip().lower() == "forbidden":
            logger.warning("setEmailCredentials Forbidden — INTERNAL_SHARED_SECRET mismatch with Code.gs")
            return jsonify({"success": False, "message": (
                "Apps Script rejected the request: the Code.gs INTERNAL_SHARED_SECRET Script Property "
                "does not match this server's. In the Code.gs Apps Script project, open Project Settings "
                "→ Script properties and set INTERNAL_SHARED_SECRET to the same value as the server."
            )}), 403
        return jsonify({"success": False, "message": msg}), 500
    _creds_cache[session["username"]] = {"enc_blob": enc_blob, "_ts": time.time()}
    return jsonify({"success": True, "message": "Email connected", "godaddyEmail": addr})


@email_log_bp.route("/api/email/test", methods=["POST"])
def email_test():
    _cfg = _email_config_problem()
    if _cfg:
        return jsonify({"success": False, "message": _cfg}), 503
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
    _cfg = _email_config_problem()
    if _cfg:
        return jsonify({"success": False, "message": _cfg}), 503
    token = ""
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        token = body.get("sessionToken", "")
    token = token or request.headers.get("X-Session-Token", "") or request.args.get("sessionToken", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    # Oversight roles may request another user's sent mail (management "see what each user is doing").
    body = request.get_json(silent=True) or {} if request.method == "POST" else {}
    target_user = (body.get("user") or "").strip()
    # Which date's sent mail to fetch (default today). Validate strictly.
    req_date = (body.get("date") or request.args.get("date") or "").strip()
    target_date = req_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", req_date) else None
    oversight = str(session.get("role", "")).lower() in ("admin", "accounting", "management", "director")
    lookup_user = target_user if (target_user and oversight) else session["username"]
    enc_blob = _get_enc_creds(lookup_user)
    if not enc_blob:
        return jsonify({"success": True, "needsSetup": True, "emails": [], "user": lookup_user})
    decrypted = _decrypt(enc_blob)
    if not decrypted:
        return jsonify({"success": False, "message": "Stored credentials could not be decrypted (key rotated?)"}), 500
    addr, pwd = decrypted

    # Per-(user, date) cache: today refreshes every ~2 min (the oversight page polls every 3), and
    # past dates are immutable history (1 h). Skips a full IMAP login+search per user per request —
    # the single biggest speed win for the all-users aggregation, and far fewer GoDaddy logins.
    ph_today = datetime.now(PH_TZ).date().isoformat()
    eff_date = target_date or ph_today
    cache_key = (lookup_user, eff_date)
    cached = _sent_mail_cache.get(cache_key)
    ttl = _SENT_TTL_TODAY if eff_date == ph_today else _SENT_TTL_PAST
    if cached and (time.time() - cached["_ts"]) < ttl:
        return jsonify({"success": True, "emails": cached["emails"], "godaddyEmail": cached["addr"],
                        "user": lookup_user, "date": eff_date, "meta": cached["meta"], "cached": True})

    # Always collect a small diagnostic (folder / window / matched) — no PII — so the UI can explain
    # an empty day ("checked Sent, 0 in window") instead of a bare "no emails".
    meta = {}
    try:
        emails = fetch_sent_today(addr, pwd, target_date=target_date, debug=meta)
        if len(_sent_mail_cache) >= _SENT_CACHE_MAX:
            _sent_mail_cache.pop(next(iter(_sent_mail_cache)))
        _sent_mail_cache[cache_key] = {"emails": emails, "meta": meta, "addr": addr, "_ts": time.time()}
        resp = {"success": True, "emails": emails, "godaddyEmail": addr, "user": lookup_user,
                "date": eff_date, "meta": meta}
        return jsonify(resp)
    except imaplib.IMAP4.error as exc:
        # Likely password changed — invalidate cache so next call re-fetches
        _creds_cache.pop(lookup_user, None)
        return jsonify({"success": False, "message": f"IMAP error: {exc}", "needsSetup": True}), 400
    except Exception as exc:
        # Structured JSON (200) instead of a 500: the client renders the per-user error state either
        # way, and transient IMAP timeouts stop spamming the console as server errors.
        logger.error("fetch_sent_today error: %s", exc)
        return jsonify({"success": False, "message": str(exc)})


@email_log_bp.route("/api/email/users", methods=["POST"])
def email_users():
    """User roster for the oversight sent-email aggregation (all-daily-reports).

    Proxies the shared-secret Code.gs action getUsersForBackend (POST — the production deployment
    404s on GET, which is why the client can't call getUsers directly). Oversight roles only.
    Returns [{username, fullName, role}] — no passwords/creds. Cached ~10 min."""
    _cfg = _email_config_problem()
    if _cfg:
        return jsonify({"success": False, "message": _cfg}), 503
    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "") or request.headers.get("X-Session-Token", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    if str(session.get("role", "")).lower() not in ("admin", "accounting", "management", "director"):
        return jsonify({"success": False, "message": "Forbidden (oversight roles only)"}), 403

    now = time.time()
    if _users_cache.get("users") and (now - _users_cache.get("_ts", 0)) < _USERS_CACHE_TTL:
        return jsonify({"success": True, "users": _users_cache["users"], "cached": True})

    # Apps Script cold starts routinely exceed 30s — give the roster scan headroom, and retry once
    # on a transport-style failure (timeout / connection error; never on an explicit Code.gs reply).
    payload = {"action": "getUsersForBackend", "sharedSecret": INTERNAL_SHARED_SECRET}
    result = _gs_post(payload, timeout=60)
    def _is_explicit(res):
        m = str(res.get("message", "")).strip().lower()
        return m == "forbidden" or "unknown action" in m
    if not result.get("success") and not _is_explicit(result):
        time.sleep(0.5)
        result = _gs_post(payload, timeout=60)
    if not result.get("success"):
        # Stale fallback: the roster changes rarely — serve the last good list rather than dropping
        # the whole sent-email section because Apps Script was slow this once.
        if _users_cache.get("users"):
            logger.warning("email_users: Code.gs failed (%s) — serving stale roster",
                           result.get("message"))
            return jsonify({"success": True, "users": _users_cache["users"], "stale": True})
        msg = str(result.get("message", "")).strip()
        if msg.lower() == "forbidden":
            msg = ("Code.gs rejected the request: INTERNAL_SHARED_SECRET mismatch. Set the matching "
                   "Script Property in the Code.gs project.")
        elif "unknown action" in msg.lower():
            msg = ("The production Code.gs does not have the getUsersForBackend action yet — paste "
                   "handleGetUsersForBackend + its doPost case from the repo Code.gs into the live "
                   "project and redeploy.")
        return jsonify({"success": False, "message": msg or "Could not load users."}), 502
    users = result.get("users") or []
    _users_cache["users"] = users
    _users_cache["_ts"] = now
    return jsonify({"success": True, "users": users})


@email_log_bp.route("/api/email/feed", methods=["POST"])
def email_feed():
    """Feed recent messages from a logical folder (inbox/sent/spam); inbox/spam classified."""
    _cfg = _email_config_problem()
    if _cfg:
        return jsonify({"success": False, "message": _cfg}), 503
    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "") or request.headers.get("X-Session-Token", "")
    session = _validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    kind = (body.get("folder") or "inbox").strip().lower()
    if kind not in ("inbox", "sent", "spam"):
        return jsonify({"success": False, "message": "Invalid folder"}), 400
    try:
        days = max(1, min(60, int(body.get("days", 14))))
    except (TypeError, ValueError):
        days = 14
    enc_blob = _get_enc_creds(session["username"])
    if not enc_blob:
        return jsonify({"success": True, "needsSetup": True, "emails": [], "folder": kind})
    decrypted = _decrypt(enc_blob)
    if not decrypted:
        return jsonify({"success": False, "message": "Stored credentials could not be decrypted (key rotated?)"}), 500
    addr, pwd = decrypted
    try:
        emails = fetch_folder(addr, pwd, kind, days=days)
        return jsonify({"success": True, "folder": kind, "emails": emails, "godaddyEmail": addr, "days": days})
    except imaplib.IMAP4.error as exc:
        _creds_cache.pop(session["username"], None)
        return jsonify({"success": False, "message": f"IMAP error: {exc}", "needsSetup": True}), 400
    except Exception as exc:
        logger.error("email_feed error: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 500


@email_log_bp.route("/api/email/status", methods=["GET", "POST"])
def email_status():
    _cfg = _email_config_problem()
    if _cfg:
        return jsonify({"success": False, "configured": False, "message": _cfg}), 503
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
    _cfg = _email_config_problem()
    if _cfg or not INTERNAL_SHARED_SECRET:
        return jsonify({"success": False, "message": _cfg or "Email service is not configured on the server: INTERNAL_SHARED_SECRET is not set."}), 503
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
