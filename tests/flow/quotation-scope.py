"""A213 — the scope of supply inside the items table.

Run:  venv/bin/python tests/flow/quotation-scope.py

Asserts on GEOMETRY extracted from the rendered bytes, never on eyeballs. The headline property is
losslessness: inclusions are contractual, so a bullet that does not appear on any page is a
commitment the client never saw.
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdfplumber                                                       # noqa: E402
from quo_fixtures import CLIENT, TERMS, LONG_DESC, item, render, fixtures, digest  # noqa: E402
from pdf_generators.flow_quotation_pdf import (build_summary_table, _scope_rows,   # noqa: E402
                                               _desc_text_width, CONTENT_W, PX)
from pdf_generators.quotation_parser import parse_quotation_pdf, _columns, _rows   # noqa: E402
from pdf_generators.utils import QUO_SCOPE_INTABLE_HEADING                          # noqa: E402

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


ONE = [item("01", "PRECISION HEAVY DUTY LATHE MACHINE", 5439522.41, description=LONG_DESC)]
SUM1 = build_summary_table(5439522.41, "inclusive")
W = _desc_text_width(CONTENT_W - (36 + 70 + 110 + 120) * PX)


def scope(n, groups=0, text=None):
    """n bullets, each carrying a UNIQUE token so losslessness is checkable."""
    out = []
    for i in range(n):
        if groups and i % max(1, n // groups) == 0:
            out.append({"text": "Grouphead%d" % i, "bold": True})
        out.append({"text": text or ("Zqx%04d spindle nose D1-11 and related fitting" % i),
                    "bold": False})
    return out


def words(pdf_bytes):
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as d:
        return [(pi, w) for pi, pg in enumerate(d.pages) for w in pg.extract_words()]


def render_scope(sc, **kw):
    kw.setdefault("items", ONE)
    kw.setdefault("desc_mode", "long")
    kw.setdefault("summary_table_data", SUM1)
    kw["scope"] = sc
    return render(kw)


print("== 1. LOSSLESSNESS — every inclusion reaches a page, exactly once ==")
for n in (0, 1, 2, 39, 40, 41, 120, 400):
    sc = scope(n)
    pdf = render_scope(sc)
    txt = " ".join(w["text"] for _p, w in words(pdf))
    missing = [b["text"][:7] for b in sc if b["text"][:7] not in txt]
    dupes = [b["text"][:7] for b in sc if txt.count(b["text"][:7]) > 1]
    ok("%3d bullets: none missing" % n, not missing, missing[:5])
    ok("%3d bullets: none duplicated" % n, not dupes, dupes[:5])
    ok("%3d bullets: nothing was truncated away" % n,
       "shortened to fit" not in txt and "+%d more" % max(0, n - 1) not in txt)

print("\n== 2. NEVER 500 — the hostile matrix ==")
HOSTILE = [
    ("4000-char bullet", [{"text": "x" * 4000, "bold": False}]),
    ("400-char unbroken token", [{"text": "A" * 400, "bold": False}]),
    ("60 headings, no bullets", [{"text": "H%d" % i, "bold": True} for i in range(60)]),
    ("whitespace only", [{"text": "   ", "bold": False}]),
    ("empty strings", [{"text": "", "bold": False}, {"text": "", "bold": True}]),
    ("markup injection", [{"text": "<b>&amp;</b> <font color='red'>x", "bold": False}]),
    ("120 with groups", scope(120, groups=8)),
]
for label, sc in HOSTILE:
    for mode in ("short", "long"):
        for opts in (False, True):
            items = ONE if not opts else [item("01", "BASE", 100.0),
                                          item("02", "OPT A", 1.0, option_no="1")]
            try:
                render_scope(sc, items=items, desc_mode=mode,
                             recommended_option="1" if opts else "")
                r = True
            except Exception as e:
                r = "%s: %s" % (type(e).__name__, str(e)[:80])
            ok("%s [%s%s]" % (label, mode, ", options" if opts else ""), r is True, r)

print("\n== 3. the block stays INSIDE the description column ==")
pdf = render_scope(scope(29, groups=3))
with pdfplumber.open(io.BytesIO(pdf)) as d:
    qty_left = None
    for pg in d.pages:
        for row in _rows(pg):
            c = _columns(row)
            if c:
                qty_left = c["desc_x1_max"] + 4      # _columns stores qty_left − 4
                break
        if qty_left:
            break
    ok("the header row was found (shared with the importer's own detector)", qty_left is not None)
    spill = []
    for pg in d.pages:
        for w in pg.extract_words():
            if w["text"].startswith("Zqx") or w["text"].startswith("Grouphead") \
               or w["text"] == "INCLUSIONS":
                if float(w["x1"]) >= qty_left - 4:
                    spill.append((w["text"], round(float(w["x1"]), 1)))
    eq("no scope word spills under QTY / UNIT PRICE / AMOUNT", spill, [])

print("\n== 4. two columns, and they line up ==")
with pdfplumber.open(io.BytesIO(pdf)) as d:
    bands = {}
    for w in d.pages[0].extract_words():
        if w["text"].startswith("Zqx"):
            bands.setdefault(round(float(w["top"]) / 3), []).append(float(w["x0"]))
    lefts = sorted({round(min(v), 0) for v in bands.values()})
    rights = sorted({round(max(v), 0) for v in bands.values() if len(v) > 0})
    starts = sorted({round(x, 0) for v in bands.values() for x in v})
    ok("bullets start at exactly two x positions", len(set(lefts)) <= 2, lefts[:6])
    gap = (max(starts) - min(starts)) if starts else 0
    ok("the two columns are ~half the text width apart (%.0fpt of %.0fpt)" % (gap, W),
       W * 0.35 <= gap <= W * 0.65, gap)

print("\n== 5. the untouched path is byte-identical ==")
import json                                                            # noqa: E402
base = json.loads((Path(__file__).resolve().parent / "baseline" / "quotation-noscope.json").read_text())
moved = [n for n, kw in fixtures() if digest(render(kw)) != base[n]["sha256"]]
eq("scope-less fixtures that changed", moved, [])

print("\n== 6. the zebra reads as ONE band, with no rule chopping it ==")
with pdfplumber.open(io.BytesIO(pdf)) as d:
    pg = d.pages[0]
    heads = [w for w in pg.extract_words() if w["text"] == "INCLUSIONS"]
    ok("the heading is on page 1", bool(heads))
    if heads:
        top = float(heads[0]["top"])
        last = max(float(w["bottom"]) for w in pg.extract_words() if w["text"].startswith("Zqx"))
        wide = [r for r in pg.rects
                if r.get("height", 1) <= 2 and float(r["x1"]) - float(r["x0"]) >= 400
                and top < float(r["top"]) < last - 2]
        eq("no full-width rule inside the scope block", len(wide), 0)
        fills = {}
        for r in pg.rects:
            if float(r["x1"]) - float(r["x0"]) >= 400 and float(r.get("height", 0)) > 4:
                fills.setdefault(str(r.get("non_stroking_color")), 0)
                fills[str(r.get("non_stroking_color"))] += 1
        ok("the item band is drawn (fills present)", bool(fills), fills)

print("\n== 7. parser round-trip — scope belongs to no item ==")
for label, items, n in [
        ("1 item, 29", ONE, 29),
        ("3 items, 40", [item("01", "LATHE MACHINE", 5439522.41, description=LONG_DESC),
                         item("02", "TORQUE WRENCH KIT", 385000.0, qty=2.0),
                         item("03", "BOLT TENSIONER SET", 129500.5, qty=4.0)], 40),
        ("2 items, 400 (9 pages)", [item("01", "LATHE MACHINE", 5439522.41, description=LONG_DESC),
                                    item("02", "TORQUE WRENCH KIT", 385000.0, qty=2.0)], 400)]:
    total = sum(i["total_unit_price"] for i in items)
    pdf2 = render_scope(scope(n, groups=3), items=items,
                        summary_table_data=build_summary_table(total, "inclusive"))
    data, _w, _c = parse_quotation_pdf(pdf2)
    got = (data or {}).get("items") or []
    nm = str(got[0].get("itemName") or "") if got else ""
    eq("%s: items parsed" % label, len(got), len(items))
    ok("%s: item 01's name carries no INCLUSIONS heading" % label, "INCLUSIONS" not in nm.upper())
    ok("%s: no bullet text in the name" % label, "Zqx" not in nm)
    ok("%s: no sub-heading in the name" % label, "Grouphead" not in nm)
    ok("%s: name stayed short (%d chars)" % (label, len(nm)), len(nm) < 400)
    eq("%s: uom is not the repeated header" % label, got[0].get("uom") if got else None, "pc(s)")

print("\n== 8. the fallback: no base item to hang scope on ==")
allopt = [item("02", "OPT A", 1.0, option_no="1"), item("03", "OPT B", 2.0, option_no="2")]
pdf3 = render_scope(scope(20), items=allopt, recommended_option="1",
                    summary_table_data=build_summary_table(1.0, "inclusive"))
t3 = " ".join(w["text"] for _p, w in words(pdf3))
# _SectionHead draws its heading LETTER-SPACED, so word-joined text reads "S C O P E". Compare on the
# flattened form — the same normalisation the importer uses, so the test and the parser agree.
import re as _re
flat3 = _re.sub(r"\s+", "", t3).upper()
ok("falls back to the post-totals card",
   "SCOPEOFSUPPLY" in flat3 and "INCLUDED" in flat3, flat3[:60])
ok("and every bullet is still present",
   all(b["text"][:7] in t3 for b in scope(20)))
pdf4 = render_scope(scope(5), items=[], summary_table_data=build_summary_table(0, "inclusive"))
ok("no items at all still renders", isinstance(pdf4, bytes) and len(pdf4) > 1000)

print("\n== 9. the page budget, pinned ==")
sc_real = scope(29, groups=3)
with pdfplumber.open(io.BytesIO(render_scope(sc_real))) as d:
    eq("29 inclusions + 3 sub-headings, 1 item", len(d.pages), 2)
with pdfplumber.open(io.BytesIO(render_scope(scope(0)))) as d:
    eq("no scope at all", len(d.pages), 1)

print("\n== 10. _scope_rows is pure and bounded ==")
eq("empty in, empty out", [_scope_rows([], W), _scope_rows(None, W)], [[], []])
eq("whitespace only", _scope_rows([{"text": "  ", "bold": False}], W), [])
ok("two columns at the normal width", len(_scope_rows(scope(4), W)) == 1 + 2)
narrow = _desc_text_width(CONTENT_W - (96 + 70 + 110 + 120) * PX)
ok("one column when alternative offers narrow it", len(_scope_rows(scope(4), narrow)) == 1 + 4)
ok("a heading always flushes the pending pair",
   len(_scope_rows([{"text": "a", "bold": False}, {"text": "H", "bold": True},
                    {"text": "b", "bold": False}], W)) == 4)
eq("the heading string is the shared constant",
   QUO_SCOPE_INTABLE_HEADING, "INCLUSIONS — SCOPE OF SUPPLY")

print("\n%s — %d failure(s)" % ("PASS" if not fail else "FAIL", fail))
sys.exit(1 if fail else 0)
