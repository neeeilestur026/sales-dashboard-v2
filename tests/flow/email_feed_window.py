"""A382 — how far back the email feed reads, how much it keeps, and the Sent-folder search.

Run:  ./venv/bin/python tests/flow/email_feed_window.py

Quotation status lets a rep pick the email that was a quotation's last follow-up, which is often weeks old. A plain
Sent feed therefore reads up to 120 days and keeps 500 messages past 60; a search (`match`: a client's addresses or
domain, a quotation number in the subject) reads only those messages, up to 180 days and 200 of them. Every term is
cleaned so nothing in it can be read as IMAP syntax. The route is driven with a test client; IMAP is replaced by a
recorder, so this needs no mailbox."""
import os
import sys

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


print("== 1 · the window: how far back, how many ==")
for kind, raw, want in [("sent", 120, (120, 500)), ("sent", 60, (60, 250)), ("sent", 61, (61, 500)), ("inbox", 120, (60, 250)),
                        ("spam", 90, (60, 250)), ("sent", "x", (14, 250)), ("sent", 0, (1, 250)), ("sent", 9999, (120, 500)),
                        ("inbox", None, (14, 250))]:
    ok(f"{kind} {raw!r} → {want}", el._feed_window(kind, raw) == want, el._feed_window(kind, raw))

print("\n== 2 · search terms are cleaned ==")
m = el._sent_match({"to": ['buyer@apex.ph', 'apex.ph', 'gmail.com', 'boss@gmail.com', 'x"y\r\nOR ALL', 'ab', 'APEX.PH', 1, 2, 3, 4],
                    "subject": ['2026-431-KPB', 'Re: "quote"', 'ab', '2026-431-KPB']})
ok("addresses and domains kept, lower-cased, once; a bare public domain dropped, a full public address kept",
   m.get("to", [])[:4] == ["buyer@apex.ph", "apex.ph", "boss@gmail.com", "xyrnor all"] or m.get("to", [])[:3] == ["buyer@apex.ph", "apex.ph", "boss@gmail.com"], m)
ok("  no more than six addresses are read", len(m.get("to", [])) <= 6, m)
ok("  nothing left in any term that IMAP could read as syntax", all('"' not in t and "\r" not in t and "\n" not in t and "\\" not in t
                                                                    for t in m.get("to", []) + m.get("subject", [])), m)
ok("subjects kept once, quotes stripped, short ones dropped", m.get("subject") == ["2026-431-KPB", "Re quote"], m.get("subject"))
ok("nothing usable is {} (a plain feed)", el._sent_match({"to": ["gmail.com"], "subject": ["ab"]}) == {} and el._sent_match("x") == {} and el._sent_match(None) == {})
crit = el._sent_criteria("01-Jul-2026", {"to": ["apex.ph"], "subject": ["2026-431"]})
ok("the criteria: SINCE, then To or Cc or the subject", crit == 'SINCE 01-Jul-2026 (OR TO "apex.ph" OR CC "apex.ph" SUBJECT "2026-431")', crit)
ok("  no match is a plain SINCE", el._sent_criteria("01-Jul-2026", {}) == "SINCE 01-Jul-2026")

print("\n== 3 · the route ==")
session_auth.validate_session = lambda token: {"username": "sales1", "role": "sales"} if token == "good" else None
el._email_config_problem = lambda: None
el._get_enc_creds = lambda u: "blob"
el._decrypt = lambda b: ("kim@hiescorp.com", "pw")
seen = []


def fake_fetch(addr, pwd, kind, days=14, cap=250, match=None):
    seen.append({"kind": kind, "days": days, "cap": cap, "match": match})
    return [{"messageId": f"m{i}", "subject": "s", "sentAt": "2026-10-01T09:00:00+08:00"} for i in range(min(cap, 3 if not match else 2))]


el.fetch_folder = fake_fetch
el._feed_cache.clear()
c = app.test_client()
H = {"X-Session-Token": "good"}
r = c.post("/api/email/feed", json={"folder": "sent", "days": 120}, headers=H).get_json()
ok("a 120-day Sent feed reads 120 days and keeps 500", seen[-1] == {"kind": "sent", "days": 120, "cap": 500, "match": None} and r["days"] == 120 and r["cap"] == 500
   and r["truncated"] is False, (seen[-1], r))
r2 = c.post("/api/email/feed", json={"folder": "sent", "days": 120}, headers=H).get_json()
ok("  the same call again comes from the cache", len(seen) == 1 and r2.get("cached") is True, (len(seen), r2.get("cached")))
r = c.post("/api/email/feed", json={"folder": "inbox", "days": 120}, headers=H).get_json()
ok("the inbox stays at 60 days and 250", seen[-1]["days"] == 60 and seen[-1]["cap"] == 250, seen[-1])
r = c.post("/api/email/feed", json={"folder": "sent", "days": 150, "match": {"to": ["buyer@apex.ph"], "subject": ["2026-431"]}}, headers=H).get_json()
ok("a search reads 150 days, keeps 200, with the cleaned match", seen[-1] == {"kind": "sent", "days": 150, "cap": 200, "match": {"to": ["buyer@apex.ph"], "subject": ["2026-431"]}}
   and r["match"] == {"to": ["buyer@apex.ph"], "subject": ["2026-431"]}, seen[-1])
n = len(seen)
c.post("/api/email/feed", json={"folder": "sent", "days": 150, "match": {"to": ["other.ph"]}}, headers=H)
ok("  another match is another read (the match is part of the cache key)", len(seen) == n + 1, len(seen))
c.post("/api/email/feed", json={"folder": "inbox", "days": 30, "match": {"to": ["apex.ph"]}}, headers=H)
ok("a match on the inbox is ignored", seen[-1]["kind"] == "inbox" and seen[-1]["match"] is None, seen[-1])
el.fetch_folder = lambda addr, pwd, kind, days=14, cap=250, match=None: [{"messageId": str(i)} for i in range(cap)]
el._feed_cache.clear()
r = c.post("/api/email/feed", json={"folder": "sent", "days": 30}, headers=H).get_json()
ok("truncated says the cap was reached", r["truncated"] is True and len(r["emails"]) == 250, (r["truncated"], len(r["emails"])))
ok("without a session: 401", c.post("/api/email/feed", json={"folder": "sent"}).status_code == 401)

print(f"\n{N} checks, " + (f"{FAIL} FAILURE(S)" if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
