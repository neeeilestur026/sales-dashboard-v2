"""A214 — the travel-allowance pack.

Run:  venv/bin/python tests/flow/travel-pdf.py

Geometry from the rendered bytes, never eyeballs. Two assertions here exist because the thing they
catch is INVISIBLE in a normal read of the output: frame containment (ReportLab draws an overlong
fixed-height row off the page rather than clipping it) and the peso glyph (Lato has none, and the
Helvetica fallback prints the letter n).
"""
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdfplumber                                                         # noqa: E402
from trav_fixtures import SAMPLE, EMPTY, many, a_jpeg, render, leg        # noqa: E402
from quo_fixtures import digest                                           # noqa: E402
from pdf_generators.flow_quotation_pdf import MARGIN, PAGE_W              # noqa: E402
from pdf_generators.travel_allowance_pdf import (                         # noqa: E402
    _normalise, _day_first_rows, _fit_rows, _clip_text, PESO,
    MAX_BLANK_P1, MAX_BLANK_P2, MAX_BLANK_P3)

fail = 0


def eq(label, got, want):
    global fail
    if got != want:
        fail += 1
        print("  FAIL %s\n     got  %r\n     want %r" % (label, got, want))
    else:
        print("  ok   %s = %r" % (label, got))


def ok(label, cond, extra=None):
    global fail
    if not cond:
        fail += 1
        print("  FAIL %s%s" % (label, "" if extra is None else "  " + repr(extra)))
    else:
        print("  ok   %s" % label)


def pages(pdf):
    with pdfplumber.open(io.BytesIO(pdf)) as d:
        return [{"text": p.extract_text() or "", "words": p.extract_words(),
                 "h": p.height, "rects": p.rects} for p in d.pages]


def flat(s):
    return re.sub(r"\s+", "", s).upper()


def money_on(page, label):
    """The amount printed on the line whose flattened text starts with `label`."""
    for ln in page["text"].splitlines():
        if flat(ln).startswith(flat(label)):
            m = re.findall(r"[\d,]+\.\d\d", ln)
            if m:
                return float(m[-1].replace(",", ""))
    return None


print("== 1. FRAME CONTAINMENT — every word inside the page, every page ==")
for label, rec, rcp in [("sample", SAMPLE, None),
                        ("empty", EMPTY, None),
                        ("200 legs", many(200), None),
                        ("4000-char description", {**SAMPLE, "items": [
                            leg(1, "2026-07-27", "x" * 4000, "Bus", 50)]}, None),
                        ("400-char token", {**SAMPLE, "items": [
                            leg(1, "2026-07-27", "A" * 400, "B" * 400, 50)]}, None),
                        ("with receipts", SAMPLE, [{"seq": 1, "dataUrl": a_jpeg()},
                                                   {"seq": 2, "dataUrl": a_jpeg()}])]:
    out = []
    for pi, p in enumerate(pages(render(rec, rcp))):
        for w in p["words"]:
            if (float(w["top"]) < -1 or float(w["bottom"]) > p["h"] + 1
                    or float(w["x0"]) < MARGIN - 2 or float(w["x1"]) > PAGE_W - MARGIN + 2):
                out.append((pi + 1, w["text"][:24], round(float(w["top"]), 1)))
    ok("%s: nothing drawn outside the frame" % label, not out, out[:4])

print("\n== 2. THE PESO GLYPH — present, and never .notdef ==")
# The ANNEX is rendered too, not just the three-page core. It was left out of this loop once, and the
# receipt captions — set in Lato, which has no peso glyph — drew a .notdef box on every annex page
# while pages 1 to 3 printed the symbol correctly. That is exactly the failure this section exists
# to catch, and a three-page render cannot see it.
for label, rcp in [("core", None),
                   ("with the annex", [{"seq": 1, "dataUrl": a_jpeg()},
                                       {"seq": 2, "dataUrl": a_jpeg()},
                                       {"seq": 3, "dataUrl": a_jpeg()}])]:
    for pi, p in enumerate(pages(render(SAMPLE, rcp))):
        ok("%s · page %d has the peso sign" % (label, pi + 1), "₱" in p["text"], p["text"][:60])
        ok("%s · page %d has no .notdef box" % (label, pi + 1), "\x00" not in p["text"])
eq("PESO resolved to the real glyph, not the PHP fallback", PESO, "₱")

print("\n== 3. NON-ADDITIVITY — the three pages are projections, not parts ==")
pp = pages(render(SAMPLE))
p1 = money_on(pp[0], "TOTAL AMOUNT SPENT")
p2 = money_on(pp[1], "TOTAL")
p3 = money_on(pp[2], "TOTAL")
eq("page 1 · total spent (the claim)", p1, 105.0)
eq("page 2 · trips", p2, 105.0)
eq("page 3 · fares with no receipt", p3, 35.0)
ok("the claim is NOT the sum of pages 2 and 3", p1 != (p2 + p3), (p1, p2 + p3))
eq("remaining on a ₱2,000 float", money_on(pp[0], "REMAINING AMOUNT"), 1895.0)

print("\n== 4. DATE SUPPRESSION is per CHUNK, so no page opens undated ==")
eq("two legs, one day", _day_first_rows([{"date": "d1"}, {"date": "d1"}]), [True, False])
eq("a chunk starting mid-day still prints its date",
   _day_first_rows([{"date": "d1"}, {"date": "d2"}][1:]), [True])
pp2 = pages(render(many(60)))
itin = [p for p in pp2 if "Travel Itinerary" in p["text"]]
ok("60 legs spill the itinerary across pages", len(itin) > 1, len(itin))
for i, p in enumerate(itin):
    dates = [w for w in p["words"] if re.fullmatch(r"\d\d/\d\d/\d{4}", w["text"])
             and float(w["x0"]) < MARGIN + 80]
    ok("itinerary page %d opens with a date" % (i + 1), bool(dates), p["text"][:40])
tot_pages = [p for p in itin if re.search(r"T\s*O\s*T\s*A\s*L", p["text"])]
eq("exactly ONE total across the itinerary chunks", len(tot_pages), 1)

print("\n== 5. FILLER ROWS are pinned, so a font change announces itself ==")
eq("page-1 cap", MAX_BLANK_P1, 7)
eq("page-2 cap", MAX_BLANK_P2, 8)
eq("page-3 cap", MAX_BLANK_P3, 12)
eq("an empty claim fills to the cap", _fit_rows(0, 20, 10000, 7), 7)
eq("and pads nothing when the rows already fill it", _fit_rows(99, 20, 100, 7), 0)

print("\n== 6. NEVER RAISE ==")
HOSTILE = [
    ("no items", {**SAMPLE, "items": []}, None),
    ("empty record", {}, None),
    ("None record", None, None),
    ("non-dict items", {**SAMPLE, "items": ["x", 42, None]}, None),
    ("text amount", {**SAMPLE, "items": [leg(1, "2026-07-27", "d", "Bus", "abc")]}, None),
    ("NaN amount", {**SAMPLE, "items": [leg(1, "2026-07-27", "d", "Bus", float("nan"))]}, None),
    ("negative amount", {**SAMPLE, "items": [leg(1, "2026-07-27", "d", "Bus", -50)]}, None),
    ("blank dates", {**SAMPLE, "items": [leg(1, "", "d", "Bus", 10)]}, None),
    ("blank position", {**SAMPLE, "position": ""}, None),
    ("zero float", {**SAMPLE, "floatAmount": 0}, None),
    ("overspend", {**SAMPLE, "items": [leg(1, "2026-07-27", "d", "Bus", 2300)],
                   "overspendReason": "Client rescheduled twice"}, None),
    ("every leg receipted", {**SAMPLE, "items": [
        leg(1, "2026-07-27", "a", "Bus", 10, receipt=True)]}, None),
    ("no leg receipted", {**SAMPLE, "items": [leg(1, "2026-07-27", "a", "Bus", 10)]}, None),
    ("non-transport only", {**SAMPLE, "items": [
        leg(1, "2026-07-27", "Lunch", "", 180, kind="Meals")]}, None),
    ("corrupt receipt", SAMPLE, [{"seq": 1, "dataUrl": "data:image/jpeg;base64,bm90YXJlYWxqcGVn"}]),
    ("receipt for a leg that does not exist", SAMPLE, [{"seq": 99, "dataUrl": a_jpeg()}]),
    ("preview receipt, no bytes", SAMPLE, [{"seq": 1}]),
    ("5 receipts", SAMPLE, [{"seq": i, "dataUrl": a_jpeg()} for i in range(1, 6)]),
]
for label, rec, rcp in HOSTILE:
    try:
        b = render(rec, rcp)
        r = isinstance(b, bytes) and len(b) > 1000
    except Exception as e:
        r = "%s: %s" % (type(e).__name__, str(e)[:70])
    ok(label, r is True, r)

print("\n== 7. THE ANNEX NEVER CHANGES A TOTAL ==")
none_p = pages(render(SAMPLE))
some_p = pages(render(SAMPLE, [{"seq": 1, "dataUrl": a_jpeg()}, {"seq": 2, "dataUrl": a_jpeg()}]))
bad_p = pages(render(SAMPLE, [{"seq": 1, "dataUrl": "data:image/jpeg;base64,Y29ycnVwdA=="},
                              {"seq": 2, "dataUrl": "data:image/jpeg;base64,Y29ycnVwdA=="}]))
for lbl, ps in [("with receipts", some_p), ("with CORRUPT receipts", bad_p)]:
    eq("%s: page 1 total unchanged" % lbl, money_on(ps[0], "TOTAL AMOUNT SPENT"), 105.0)
    eq("%s: page 2 total unchanged" % lbl, money_on(ps[1], "TOTAL"), 105.0)
    eq("%s: page 3 total unchanged" % lbl, money_on(ps[2], "TOTAL"), 35.0)
eq("no receipts -> 3 pages", len(none_p), 3)
eq("2 receipts -> one annex page", len(some_p), 4)
eq("5 receipts -> three annex pages (two per page)",
   len(pages(render(SAMPLE, [{"seq": i, "dataUrl": a_jpeg()} for i in range(1, 6)]))), 6)
ok("a corrupt receipt says so rather than vanishing",
   "could not be read" in bad_p[3]["text"], bad_p[3]["text"][:80])

print("\n== 8. PAGE COUNTS pinned, and the annex is inside the numbering ==")
eq("the sample", len(none_p), 3)
last = pages(render(SAMPLE, [{"seq": 1, "dataUrl": a_jpeg()}]))[-1]
ok("the last annex page is numbered as part of the pack",
   "Page 4 of 4" in re.sub(r"\s+", " ", last["text"]), last["text"][-60:])

print("\n== 9. IDEMPOTENCE — same input, same bytes ==")
eq("two renders of the sample agree", digest(render(SAMPLE)), digest(render(SAMPLE)))
eq("and with receipts", digest(render(SAMPLE, [{"seq": 1, "dataUrl": a_jpeg()}])),
   digest(render(SAMPLE, [{"seq": 1, "dataUrl": a_jpeg()}])))

print("\n== 10. THE SWAP on page 3, and the named signers ==")
p3txt = pp[2]["text"]
ok("page 3 says CERTIFIED CORRECT", "CERTIFIED CORRECT" in p3txt)
ok("page 3 says APPROVED BY", "APPROVED BY" in p3txt)
i_cc, i_ab = p3txt.index("CERTIFIED CORRECT"), p3txt.index("APPROVED BY")
ok("and the director is on the APPROVED side, not the certifying one",
   p3txt.index("NEIL M. ESTUR") > i_ab or i_ab < i_cc, p3txt[i_cc:i_cc + 120])
approved = pages(render({**SAMPLE, "status": "Approved",
                         "acctApprovedBy": "A Real Accountant",
                         "dirApprovedBy": "A Real Director"}))
ok("an approved claim prints the REAL approvers, not the template constants",
   "A Real Director" in approved[0]["text"] and "NEIL M. ESTUR" not in approved[0]["text"],
   approved[0]["text"][-200:])
ok("and a draft falls back to the constants", "NEIL M. ESTUR" in pp[0]["text"])
ok("the rep is not printed twice when they are also the accountant",
   pp[0]["text"].count("ROJAN LEO R. FRANCISCO JR.") == 1,
   pp[0]["text"].count("ROJAN LEO R. FRANCISCO JR."))

print("\n== 11. THE ROUTE returns JSON on failure, never an HTML page ==")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import app as _app                                                        # noqa: E402
_a = _app.create_app() if hasattr(_app, "create_app") else _app.app
_c = _a.test_client()
for label, body in [("normal", SAMPLE), ("empty", {}), ("garbage items", {"items": ["x"]}),
                    ("garbage receipts", {**SAMPLE, "receipts": ["x", 42]})]:
    r = _c.post("/flow/travel-allowance-pdf", json=body)
    ct = r.headers.get("Content-Type", "")
    ok("%s: %d %s" % (label, r.status_code, ct[:20]),
       r.status_code == 200 and ct.startswith("application/pdf"))
ok("a malformed body never yields text/html",
   not _c.post("/flow/travel-allowance-pdf", data="not json").headers
       .get("Content-Type", "").startswith("text/html"))

print("\n%s — %d failure(s)" % ("PASS" if not fail else "FAIL", fail))
sys.exit(1 if fail else 0)
