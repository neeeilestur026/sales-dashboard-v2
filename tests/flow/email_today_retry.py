"""A405 — a sent-mail read that fails for a passing reason is retried and reported as a failure, never as
"mailbox not connected"; one bad message never costs the whole day; one GoDaddy read per person and day at a time.

Run:  ./venv/bin/python tests/flow/email_today_retry.py

Neil, 24 Nov 2026: Kimberlyn's daily report showed Emails sent "—, not counted" although her mailbox was connected and
read fine the evening before. Every IMAP error (a refused password, but also GoDaddy's limit on connections open at
once or a dropped connection) and every failed credential lookup was answered with needsSetup, which the page shows
as not connected and never tries again. The routes are driven with a test client; Code.gs and IMAP are replaced, so
this needs no mailbox and no network."""
import imaplib
import logging
import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("DASHBOARD_APPS_SCRIPT_URL", "https://script.google.com/macros/s/test/exec")

from app import app                                   # noqa: E402
import blueprints.session_auth as session_auth        # noqa: E402
import blueprints.email_log as el                     # noqa: E402

FAIL = 0
N = 0


def ok(label, cond, extra=None):
    global FAIL, N
    N += 1
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + repr(extra)[:400]))


logging.getLogger("blueprints.email_log").setLevel(logging.CRITICAL)   # the retries' warnings are expected here
REAL_FETCH = el.fetch_sent_today                      # section 4 drives the real read over a fake connection
_real_sleep = time.sleep
el.time.sleep = lambda s: None if s >= 0.5 else _real_sleep(s)    # the retries' waits, not the test's own pauses
session_auth.validate_session = lambda token: {"username": "sales1", "role": "sales"} if token == "good" else None
el._email_config_problem = lambda: None
el._decrypt = lambda b: ("kim@hiescorp.com", "pw")
c = app.test_client()
H = {"X-Session-Token": "good"}
DAY = "2026-11-24"


def today(**body):
    r = c.post("/api/email/today", json=dict({"date": DAY}, **body), headers=H)
    return r.status_code, r.get_json()


print("== 1 · the credential lookup: none stored is not the same as could not ask ==")
calls = []


def gs_seq(*replies):
    seq = list(replies)

    def f(payload, timeout=30):
        calls.append(payload.get("action"))
        return seq.pop(0) if len(seq) > 1 else seq[0]
    return f


el._creds_cache.clear()
el._gs_post = gs_seq({"success": True, "encBlob": ""})
ok("none stored → (None, reached)", el._creds_lookup("u1") == (None, True))
el._creds_cache.clear(); calls.clear()
el._gs_post = gs_seq({"success": False, "message": "HTTP 404: the backend did not answer with JSON"}, {"success": True, "encBlob": "blob"})
ok("a failed lookup is asked once more, and the second answer is used", el._creds_lookup("u2") == ("blob", True) and len(calls) == 2, calls)
el._creds_cache.clear(); calls.clear()
el._gs_post = gs_seq({"success": False, "message": "Read timed out"})
ok("two failed lookups → (None, not reached)", el._creds_lookup("u3") == (None, False) and len(calls) == 2, calls)
el._creds_cache.clear(); calls.clear()
el._gs_post = gs_seq({"success": False, "message": "Forbidden"})
ok("Forbidden (a secret mismatch) is not retried and is not a hiccup", el._creds_lookup("u4") == (None, True) and len(calls) == 1, calls)
el._creds_cache.clear()
el._gs_post = gs_seq({"success": True, "encBlob": "blob"})
ok("_get_enc_creds still answers the blob alone (quotation threads, status)", el._get_enc_creds("u5") == "blob")

print("\n== 2 · /api/email/today: what the page is told ==")
el._sent_mail_cache.clear()
el._creds_lookup = lambda u: (None, False)
st, r = today()
ok("lookup failed → success false, retry true, NOT needsSetup (HTTP 200)", st == 200 and r["success"] is False and r.get("retry") is True and not r.get("needsSetup"), (st, r))
el._creds_lookup = lambda u: (None, True)
st, r = today()
ok("nothing stored → needsSetup, as before", r.get("needsSetup") is True and r.get("success") is True, r)
el._creds_lookup = lambda u: ("blob", True)

reads = []


def fetch_seq(*outcomes):
    seq = list(outcomes)

    def f(addr, pwd, target_date=None, debug=None):
        reads.append(target_date)
        o = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(o, BaseException):
            raise o
        if debug is not None:
            debug["folder"] = "Sent"
        return o
    return f


el._sent_mail_cache.clear(); reads.clear()
el.fetch_sent_today = fetch_seq(imaplib.IMAP4.error("[UNAVAILABLE] Maximum number of connections from user+IP exceeded"), [{"messageId": "a"}])
st, r = today()
ok("GoDaddy's connection limit once, then a read → the read (retried inside the server)", r.get("success") is True and r["emails"] == [{"messageId": "a"}] and len(reads) == 2, (r, reads))
el._sent_mail_cache.clear(); reads.clear()
el.fetch_sent_today = fetch_seq(imaplib.IMAP4.error("[UNAVAILABLE] Maximum number of connections from user+IP exceeded"))
st, r = today()
ok("the limit twice → success false, retry true, the reason given, not needsSetup", st == 200 and r["success"] is False and r.get("retry") is True
   and "Maximum number of connections" in r.get("message", "") and not r.get("needsSetup") and len(reads) == 2, (st, r, reads))
el._sent_mail_cache.clear(); reads.clear()
el.fetch_sent_today = fetch_seq(imaplib.IMAP4.abort("socket error: EOF"))
st, r = today()
ok("a dropped connection (IMAP4.abort) is temporary too", r.get("retry") is True and not r.get("needsSetup") and len(reads) == 2, r)
el._sent_mail_cache.clear(); reads.clear()
el.fetch_sent_today = fetch_seq(TimeoutError("timed out"))
st, r = today()
ok("a socket timeout is retried, then reported for retry", r.get("retry") is True and len(reads) == 2, (r, reads))
el._sent_mail_cache.clear(); reads.clear()
el._creds_cache["sales1"] = {"enc_blob": "blob", "_ts": time.time()}
el.fetch_sent_today = fetch_seq(imaplib.IMAP4.error("b'[AUTHENTICATIONFAILED] Authentication failed.'"))
st, r = today()
ok("a refused password → needsSetup + reconnect (HTTP 400), not retried", st == 400 and r.get("needsSetup") is True and r.get("reconnect") is True and len(reads) == 1, (st, r, reads))
ok("  and the cached blob is dropped, so a reconnect is picked up at once", "sales1" not in el._creds_cache)
el.fetch_sent_today = fetch_seq(RuntimeError("Could not open Sent folder"))
el._sent_mail_cache.clear(); reads.clear()
st, r = today()
ok("any other failure → success false, retry true, the reason", r.get("retry") is True and "Could not open Sent folder" in r.get("message", "") and len(reads) == 1, (r, reads))
ok("classifier: auth words are a refused password; abort never is", el._imap_auth_failed(imaplib.IMAP4.error("LOGIN failed.")) and
   el._imap_auth_failed(imaplib.IMAP4.error("Invalid credentials")) and not el._imap_auth_failed(imaplib.IMAP4.abort("authentication socket closed"))
   and not el._imap_auth_failed(imaplib.IMAP4.error("[UNAVAILABLE] Too many connections")))

print("\n== 3 · one GoDaddy read per person and day at a time ==")
el._sent_mail_cache.clear(); reads.clear()


def slow(addr, pwd, target_date=None, debug=None):
    reads.append(target_date)
    _real_sleep(0.4)
    return [{"messageId": "x"}]


el.fetch_sent_today = slow
out = []


def hit():
    with app.test_client() as cc:
        out.append(cc.post("/api/email/today", json={"date": DAY}, headers=H).get_json())


ts = [threading.Thread(target=hit) for _ in range(3)]
[t.start() for t in ts]
[t.join() for t in ts]
ok("three requests for the same day at once → one read; all three get the mail", len(reads) == 1 and all(o.get("emails") == [{"messageId": "x"}] for o in out), (reads, out))
ok("  two of them were served from the cache", sum(1 for o in out if o.get("cached")) == 2, out)
reads.clear(); out.clear()
ts = [threading.Thread(target=lambda d=d: out.append(app.test_client().post("/api/email/today", json={"date": d}, headers=H).get_json())) for d in ("2026-11-20", "2026-11-23")]
[t.start() for t in ts]
[t.join() for t in ts]
ok("different days are not held up by each other", len(reads) == 2 and set(reads) == {"2026-11-20", "2026-11-23"}, reads)

print("\n== 4 · one odd message never costs the day ==")


class FakeConn:
    def __init__(self, parts):
        self.parts = parts

    def search(self, *a):
        return "OK", [b"1 2 3"]

    def fetch(self, *a):
        return "OK", self.parts

    def close(self):
        pass

    def logout(self):
        pass


def part(n, date, to="buyer@apex.ph", subj="Quotation"):
    hdr = (f"From: kim@hiescorp.com\r\nTo: {to}\r\nSubject: {subj}\r\nDate: {date}\r\nMessage-ID: <m{n}@x>\r\n\r\n").encode()
    return (f"{n} (FLAGS () INTERNALDATE \"24-Nov-2026 09:00:00 +0800\" BODY[HEADER.FIELDS (...)] {{{len(hdr)}}}".encode(), hdr)


parts = [part(1, "Tue, 24 Nov 2026 09:15:00 +0800"), b")", part(2, "Tue, 24 Nov 2026 10:00:00 +0800", to="boom@apex.ph"),
         b")", part(3, "Mon, 23 Nov 2026 17:00:00 +0800"), b")", (b"4 (BODY[HEADER] NIL)", None)]
el._imap_login = lambda a, p: FakeConn(parts)
el._open_sent = lambda conn: "Sent"
real_company = el._company_from_email


def company(a):
    if a.startswith("boom"):
        raise ValueError("odd")
    return real_company(a)


el._company_from_email = company
meta = {}
rows = REAL_FETCH("kim@hiescorp.com", "pw", target_date=DAY, debug=meta)
ok("the day's two good messages are kept; the one that fails to parse is skipped, not the day",
   [r["messageId"] for r in rows] == ["m1@x"] and meta.get("skipped") == 1 and meta.get("matched") == 1, (rows, meta))
ok("  another day's message in the window is still left out, and a NIL header part is passed over", all(r["sentAt"].startswith(DAY) for r in rows))
el._company_from_email = real_company
rows = REAL_FETCH("kim@hiescorp.com", "pw", target_date=DAY, debug={})
ok("without the odd one both of the day's messages are read", [r["messageId"] for r in rows] == ["m1@x", "m2@x"], rows)
hdr = b"From: kim@hiescorp.com\r\nTo: a@b.ph\r\nSubject: x\r\nDate: \xff\xfe not a date\r\nMessage-ID: <m9@x>\r\n\r\n"
r9 = el._sent_row((b'9 (INTERNALDATE "24-Nov-2026 11:00:00 +0800" BODY[HEADER.FIELDS (...)] {1}', hdr), __import__("datetime").date(2026, 11, 24), True)
ok("an unreadable Date header falls back to the server's INTERNALDATE", r9 and r9["sentAt"].startswith(DAY), r9)

el.time.sleep = _real_sleep
print(f"\n{N} checks, " + (f"{FAIL} FAILURE(S)" if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
