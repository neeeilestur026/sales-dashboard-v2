"""A241 — the redesigned quotation document (design 2).

Run:  ./venv/bin/python tests/flow/quotation_design_v2.py

WHY THIS FILE EXISTS. The redesign adds three new kinds of thing to the item table — a group band, an
INCLUDED cell spanning two columns, and a large natural-aspect photo — and each is a fresh instance of
a failure this codebase has already paid for:

  1. DESIGN 1 MUST NOT MOVE. ~102 quotations exist and a client holds a copy of some of them. A record
     keeps design 1 until someone edits it, so every case here renders BOTH ways and the design-1 side
     is asserted to be exactly what it was.

  2. NEW FURNITURE POISONS THE RE-IMPORT. quotation_parser concatenates any unclaimed line onto the
     PREVIOUS item's product name. A213 hit it with scope headings, A240 hit it twice more, and A241
     hit it again in a way none of them did: the parser buckets rows by round(top/3) and `top` depends
     on FONT SIZE, so a band's 11.5px title and 9.5px tag drawn on one baseline landed in different
     buckets and the tag — the only matchable part — never arrived. Pinned here.

  3. A ROW CANNOT SPLIT ACROSS A PAGE. A row taller than the 773.65pt frame raises LayoutError, which
     is a 500 on the quotation a rep is sending. A natural-aspect photo is a new way to grow a row
     without bound, so the cap is asserted and the adversarial matrix is the proof.
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdf_generators.flow_quotation_pdf import (          # noqa: E402
    build_quotation_pdf_bytes, build_summary_table, _theme, _Photo, PX)
from pdf_generators.quotation_parser import parse_quotation_pdf      # noqa: E402
from pdf_generators.utils import (                        # noqa: E402
    QUO_GROUP_TAG_RANGE_FMT, QUO_GROUP_TAG_ONE_FMT, QUO_INCLUDED_WORD)

FAIL = 0


def ok(label, cond, extra=""):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("  " + str(extra) if extra else ""))


CLIENT = {"company": "ACME", "client_name": "ACME MINING CORP", "attention": "Ms A Cruz",
          "address": "Benguet", "email": "a@acme.test", "quotation_no": "Q-1",
          "subject": "Supply", "reference_rfq_no": "RFQ-1", "plant_site": "Benguet",
          "quotation_date": "August 15, 2026", "signature_name": "A REP"}
TERMS = {"validity": "30 days", "delivery": "30 days", "payment": "50% DP", "warranty": "1 year"}


def item(no, name, price, **kw):
    d = {"item_no": no, "product_code": "PC-" + no, "product_name": name,
         "total_unit_price": price, "total_amount": price, "uom": "unit", "qty": 1}
    d.update(kw)
    return d


def render(items, dv=2, scope=None, rec=""):
    total = sum(float(i.get("total_unit_price") or 0) for i in items
                if not i.get("option_no") or i.get("option_no") == rec)
    return build_quotation_pdf_bytes(items, {}, CLIENT, TERMS,
                                     build_summary_table(total, "inclusive", 0),
                                     desc_mode="full", note="", scope=scope, exclusions=None,
                                     options=None, recommended_option=rec, design_version=dv)


def text_of(b):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(b)) as pdf:
        pages = [(p.extract_text() or "") for p in pdf.pages]
    return "\n".join(pages), len(pages)


def names_of(b):
    data, _w, _c = parse_quotation_pdf(b)
    return [str(i.get("itemName") or "") for i in ((data or {}).get("items") or [])]


CABLES = "Power and Control Cables, Cable Trays and Grounding System"


def acic():
    """The shape the redesign was written against: two priced headline items, then grouped runs."""
    out = [item("01", "2000KVA STANDBY GENERATOR SET", 109191338.25,
                scope="**Diesel Engine** — Baudouin 16M33G1650/6 — 3 pcs\n– Vacuum CB: ABB-VD4"),
           item("02", "SYNCHRONIZING PANEL AND SWITCHGEAR", 17458883.33, hide_price=True)]
    for n in range(3, 9):
        out.append(item("%02d" % n, "Cable type %d" % n, 0.0, hide_price=True, group=CABLES))
    out.append(item("09", "GB copper-bonded steel earth rod", 0.0, hide_price=True, group=CABLES))
    out.append(item("10", "Commissioning Engineer", 0.0, hide_price=True, uom="DAYS",
                    group="Testing, Commissioning and Start-Up"))
    return out


print("== the theme resolves, and design 1 is the OLD behaviour ==")
t1, t2 = _theme(1), _theme(2)
ok("design 1 keeps the 66px thumbnail", abs(t1.photo_w - 66 * PX) < 1e-9)
ok("design 2 uses the 150px photo", abs(t2.photo_w - 150 * PX) < 1e-9)
ok("design 1 indents the scope past the thumbnail", t1.scope_indent is True)
ok("design 2 starts it at the cell's left edge", t2.scope_indent is False)
ok("design 1 prints the reconciling note", t1.hidden_note is True)
ok("design 2 does not (INCLUDED says it on the line)", t2.hidden_note is False)
ok("only design 2 bands", (t2.bands, t1.bands) == (True, False))
ok("an unknown/absent version falls back to design 1", _theme(None).v2 is False)
ok("  and so does junk", _theme("banana").v2 is False)

print("\n== group bands ==")
flat, _p = text_of(render(acic()))
one = " ".join(flat.split())
ok("the band title prints, uppercased", CABLES.upper() in one)
ok("a run is tagged as a range", (QUO_GROUP_TAG_RANGE_FMT % ("03", "09")) in one)
ok("a group of one is tagged singular", (QUO_GROUP_TAG_ONE_FMT % "10") in one)
ok("the second group prints too", "TESTING, COMMISSIONING AND START-UP" in one)
# EXACTLY as many bands as there are groups — an ungrouped line must not raise one. Counted from the
# generated tag rather than from the titles, because a long title wraps and a rep's title could say
# anything. Anchored at END of line: "ITEM 01 — SCOPE OF SUPPLY" also opens with those words, and the
# band tag is the only one of the two that finishes its line.
_TAG_RE = re.compile(r"ITEMS? \d[\d\s–-]*$")


def _count_tags(txt):
    return sum(1 for ln in txt.split("\n") if _TAG_RE.search(ln.strip()))


_tags = _count_tags(flat)
ok("exactly one band per group, and none for the ungrouped lines", _tags == 2, "found %d" % _tags)
none_grouped = [dict(i) for i in acic()]
for i in none_grouped:
    i.pop("group", None)
ok("no groups at all -> no band and no tag", _count_tags(text_of(render(none_grouped))[0]) == 0)

print("\n== INCLUDED ==")
ok("the word prints", QUO_INCLUDED_WORD in one)
ok("once per suppressed line (9 of 10)", one.count(QUO_INCLUDED_WORD) == 9)
ok("no em-dash price survives on design 2", "— —" not in flat)
ok("the priced line keeps its figures", "109,191,338.25" in one)
ok("no reconciling note on design 2", "supplied within the package price" not in one)
f1, _p = text_of(render(acic(), dv=1))
o1 = " ".join(f1.split())
ok("design 1 still prints em dashes, not INCLUDED", QUO_INCLUDED_WORD not in o1)
ok("  and still prints the note", "supplied within the package price" in o1)
ok("  and raises no band", CABLES.upper() not in o1)

print("\n== the photo is capped ==")
for label, ar, side in (("landscape 4:3", 4 / 3.0, (800, 600)),
                        ("square", 1.0, (600, 600)),
                        ("portrait 3:4", 0.75, (600, 800)),
                        ("panorama 1:3", 1 / 3.0, (400, 1200))):
    try:
        from PIL import Image as PILImage
        buf = io.BytesIO()
        PILImage.new("RGB", side, (200, 200, 200)).save(buf, format="PNG")
        ph = _Photo(buf.getvalue(), width=150 * PX, max_h=160 * PX)
        ok("%-14s h=%6.2fpt <= cap %.2fpt" % (label, ph.height, 160 * PX),
           ph.height <= 160 * PX + 1e-6)
    except Exception as exc:                                # noqa: BLE001
        ok(label, False, exc)
ok("a missing image still has a bounded height",
   _Photo(None, width=150 * PX, max_h=160 * PX).height <= 160 * PX + 1e-6)

print("\n== nothing new is read back as a product name ==")
CASES = [
    ("the ACIC shape", acic(),
     ["2000KVA STANDBY GENERATOR SET", "SYNCHRONIZING PANEL AND SWITCHGEAR"]
     + ["Cable type %d" % n for n in range(3, 9)]
     + ["GB copper-bonded steel earth rod", "Commissioning Engineer"]),
    ("a group of one, first line", [item("01", "Solo", 100.0, group="Only")], ["Solo"]),
    ("two groups back to back",
     [item("01", "A", 1.0, group="First"), item("02", "B", 1.0, group="Second")], ["A", "B"]),
    ("a group broken by an ungrouped line",
     [item("01", "A", 1.0, group="G"), item("02", "Plain", 1.0), item("03", "C", 1.0, group="G")],
     ["A", "Plain", "C"]),
    ("twelve grouped lines over two pages",
     [item("%02d" % n, "LINE %d" % n, 1000.0 * n, group="Bulk") for n in range(1, 13)],
     ["LINE %d" % n for n in range(1, 13)]),
]
for label, its, want in CASES:
    got = names_of(render(its))
    ok(label, got == want,
       "got %d, first mismatch %r" % (len(got), next((g for g, w in zip(got, want) if g != w), None)))

print("\n== the adversarial matrix — none of these may raise ==")
LONG = "Specification clause covering tolerances, finish and acceptance. " * 40
CRUEL = [
    ("a 4,000-character group title",
     [item("01", "GEN", 1.0, group="T" * 4000), item("02", "B", 1.0, group="T" * 4000)]),
    ("a group title of only whitespace", [item("01", "GEN", 1.0, group="    ")]),
    ("a group title full of markup", [item("01", "GEN", 1.0, group="<b>&amp;</b> <font>x")]),
    ("40 items alternating grouped / ungrouped",
     [item("%02d" % n, "LINE %d" % n, 100.0 * n, hide_price=(n % 3 == 0),
           group=("Bulk" if n % 2 else "")) for n in range(1, 41)]),
    ("every line grouped, hidden, and scoped",
     [item("%02d" % n, "LINE %d" % n, 100.0, hide_price=True, group="G",
           scope="**Head**\nOne\n– sub") for n in range(1, 13)]),
    ("a grouped line carrying blocks",
     [item("01", "GEN", 1.0, group="G", blocks=[{"t": "NOTE", "b": LONG}])]),
    ("a group whose members span a page break",
     [item("%02d" % n, "LINE %d" % n, 100.0, group="Bulk",
           scope="\n".join("Inclusion %d" % k for k in range(1, 20))) for n in range(1, 10)]),
    ("groups mixed with ALTERNATIVE OFFERS",
     [item("01", "BASE", 100.0, group="G"), item("02", "OPT A", 200.0, option_no="A"),
      item("03", "OPT B", 210.0, option_no="B")]),
    ("a single grouped, hidden line and nothing else",
     [item("01", "ONLY", 100.0, hide_price=True, group="G")]),
    ("group set on an item with no name at all", [item("01", "", 1.0, group="G")]),
]
for label, its in CRUEL:
    try:
        b = render(its)
        ok(label + "  (%d pages)" % text_of(b)[1], len(b) > 1000)
    except Exception as exc:                                # noqa: BLE001 — that IS the assertion
        ok(label, False, "%s: %s" % (type(exc).__name__, exc))

print("\n" + (("%d FAILED" % FAIL) if FAIL else "all passed"))
sys.exit(1 if FAIL else 0)
