"""A357 — a burst of requests checks a session ONCE and loads the roster ONCE.

Run:  ./venv/bin/python tests/flow/session_singleflight.py

22 Oct 2026, right after a deploy: the director's dashboard fired a dozen secured calls at once on an empty cache, each
validated the same token with Code.gs and each loaded the roster, and the queued Apps Script calls timed out at 30 s
("Read timed out"). Pinned here, against a slow stand-in for Code.gs:

  1. twelve concurrent checks of one token make ONE Code.gs call, and all twelve get the session
  2. an invalid token: one call, nobody let in, nothing cached; a transport failure retries once, then everyone is refused
  3. two different tokens are checked side by side (one call each)
  4. the roster: twelve concurrent loads make ONE call; while a refresh runs, the others are served the copy held
"""
import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")

import blueprints.session_auth as sa                               # noqa: E402

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


calls = []
reply = {}


def fake_gs_post(payload, timeout=30):
    calls.append(payload.get("action") + ":" + str(payload.get("token", "")))
    time.sleep(0.3)                     # a slow Apps Script, so the burst really overlaps
    r = reply.get(payload.get("action"))
    return r(payload) if callable(r) else dict(r or {})


sa.gs_post = fake_gs_post


def reset():
    calls.clear()
    sa._session_cache = sa._TTLCache(maxsize=2000, ttl=sa._SESSION_CACHE_TTL)
    sa._roster_cache.clear()


def burst(fn, n=12):
    out, threads = [None] * n, []
    for i in range(n):
        def run(i=i):
            out[i] = fn()
        t = threading.Thread(target=run)
        threads.append(t)
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    return out


print("\n== 1 · one token, twelve requests ==")
reset()
reply["validateSession"] = {"success": True, "valid": True, "username": "neil", "role": "director"}
res = burst(lambda: sa.validate_session("tok-A"))
ok("one Code.gs call for twelve concurrent checks", calls == ["validateSession:tok-A"], calls)
ok("  and all twelve get the session", all(r == {"username": "neil", "role": "director"} for r in res), res)
ok("  each gets its own copy (one request changing it cannot touch another's)", len({id(r) for r in res}) == 12)
calls.clear()
ok("the next request is answered from the cache, with no call", sa.validate_session("tok-A") == {"username": "neil", "role": "director"} and calls == [])
ok("  and no check is left in flight", sa._inflight == {})

print("\n== 2 · refused tokens ==")
reset()
reply["validateSession"] = {"success": True, "valid": False}
res = burst(lambda: sa.validate_session("tok-BAD"))
ok("an invalid token: one call, nobody let in", calls == ["validateSession:tok-BAD"] and all(r is None for r in res), (calls, res))
ok("  and nothing cached, so a later request asks again", sa._session_cache.get("tok-BAD") is None)
reset()
reply["validateSession"] = {"success": False, "message": "Read timed out"}
res = burst(lambda: sa.validate_session("tok-DOWN"))
ok("Code.gs unreachable: the one check retries once, then all are refused together",
   calls == ["validateSession:tok-DOWN", "validateSession:tok-DOWN"] and all(r is None for r in res), (calls, res))
ok("  and the next request tries afresh", (calls.clear() or sa.validate_session("tok-DOWN")) is None and len(calls) == 2)

print("\n== 3 · different tokens ==")
reset()
reply["validateSession"] = lambda p: {"success": True, "valid": True, "username": "u-" + p["token"], "role": "sales"}
t0 = time.time()
res = burst(lambda: (sa.validate_session("tok-1"), sa.validate_session("tok-2")), n=6)
ok("two tokens: one call each", sorted(calls) == ["validateSession:tok-1", "validateSession:tok-2"], calls)
ok("  each gets its own session", all(r[0]["username"] == "u-tok-1" and r[1]["username"] == "u-tok-2" for r in res), res)

print("\n== 4 · the roster ==")
reset()
reply["getUsersForBackend"] = {"success": True, "users": [{"username": "neil", "fullName": "Neil Estur", "role": "director"}]}
res = burst(sa.get_roster)
ok("twelve concurrent loads on an empty cache: one call, all get the roster",
   calls == ["getUsersForBackend:"] and all(r and r[0]["fullName"] == "Neil Estur" for r in res), (calls, res[:1]))
ok("  display names still map", sa.display_name_for("NEIL") == "Neil Estur")
calls.clear()
sa._roster_cache["_ts"] = time.time() - sa._ROSTER_CACHE_TTL - 5          # the copy is stale now
reply["getUsersForBackend"] = {"success": True, "users": [{"username": "neil", "fullName": "Neil E. Estur", "role": "director"}]}
started = []
def timed():
    t = time.time()
    r = sa.get_roster()
    started.append(time.time() - t)
    return r
res = burst(timed)
ok("a stale roster: one refresh, while the others are served the copy held without waiting",
   calls == ["getUsersForBackend:"] and sum(1 for s in started if s < 0.15) == 11, (calls, [round(s, 2) for s in started]))
ok("  and once it lands, the new names are used", sa.display_name_for("neil") == "Neil E. Estur")

print("\n== 5 · the server has room for a dashboard's burst ==")
yaml = open(os.path.join(os.path.dirname(__file__), "..", "..", "render.yaml")).read()
ok("gunicorn runs eight threads in its one process (and keeps the 120 s timeout)", "--workers 1 --threads 8 --worker-class gthread --timeout 120" in yaml)

print(f"\n{'FAIL — ' + str(FAIL) + ' of ' + str(N) if FAIL else 'all ' + str(N) + ' passed'}\n")
sys.exit(1 if FAIL else 0)
