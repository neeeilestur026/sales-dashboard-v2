"""A240 — hidden prices, per-item scope headings, and titled note blocks.

Run:  ./venv/bin/python tests/flow/quotation_hidden_price.py

WHY THIS FILE EXISTS. Three separate ways for this feature to be quietly wrong, each of which puts a
wrong number or a lost commitment in front of a client:

  1. THE TOTAL. Hiding a price must not move it by one centavo. It is display-only: total_ex_vat in
     flow.py sums total_unit_price over every item regardless, so the printed total, the stored
     Quotations['Total'], the sales order and the commission base stay right BY CONSTRUCTION. The
     alternative — a zero-priced line — understates the real ACIC offer by PHP 7,249,695.36, so the
     figures below are that quotation's own, checked to the centavo.

  2. THE RE-IMPORT. Everything this feature adds to the item table is furniture that belongs to no
     item, and quotation_parser concatenates any unclaimed line onto the PREVIOUS item's name. A
     poisoned name is not visible the way a missing item is, which is why every shape round-trips
     here. The page letterhead was already doing this before A240 on any two-page quotation.

  3. THE 500. A ReportLab table row cannot split across a page, so a row taller than the frame raises
     LayoutError — a 500 on the quotation a rep is trying to send. Note blocks are one paragraph per
     row for that reason, and the adversarial matrix at the end is what proves it.
"""
import hashlib
import io
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdf_generators.flow_quotation_pdf import (          # noqa: E402
    build_quotation_pdf_bytes, build_summary_table, _number_span)
from pdf_generators.quotation_parser import parse_quotation_pdf   # noqa: E402
from pdf_generators.utils import QUO_SCOPE_ITEM_HEADING_FMT       # noqa: E402

FAIL = 0


def ok(label, cond, extra=""):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("  " + str(extra) if extra else ""))


def eq(label, got, want):
    ok(label + " = " + repr(got), got == want, "want " + repr(want))


CLIENT = {"company": "ADVANTAGE CONCRETE INDUSTRIES", "attention": "Ms A Cruz", "address": "Bulacan",
          "email": "a@acic.test", "quotation_no": "PRF-ACIC-26-538", "date": "2026-08-14"}
TERMS = {"delivery": "180 days", "warranty": "1 year", "payment": "50% DP"}

_NOISE = [re.compile(rb"/CreationDate\s*\([^)]*\)"), re.compile(rb"/ModDate\s*\([^)]*\)"),
          re.compile(rb"/ID\s*\[\s*<[^>]*>\s*<[^>]*>\s*\]")]


def item(no, name, price, **kw):
    d = {"item_no": no, "product_code": "PC-" + no, "product_name": name,
         "total_unit_price": price, "total_amount": price, "uom": "unit"}
    d.update(kw)
    return d


def render(items, scope=None, recommended=""):
    """NOTE the total: summed over EVERY item, hidden or not. That is the invariant under test —
    the renderer is handed the true total and must print it while suppressing individual cells."""
    total = sum(float(i.get("total_unit_price") or 0) for i in items
                if not i.get("option_no") or i.get("option_no") == recommended)
    return build_quotation_pdf_bytes(items, {}, CLIENT, TERMS,
                                     build_summary_table(total, "inclusive", 0),
                                     desc_mode="full", note="", scope=scope,
                                     exclusions=None, options=None, recommended_option=recommended)


def digest(b):
    for rx in _NOISE:
        b = rx.sub(b"<STRIPPED>", b)
    return hashlib.sha256(b).hexdigest()


def text_of(b):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(b)) as pdf:
        pages = [(p.extract_text() or "") for p in pdf.pages]
    return "\n".join(pages), len(pages)


def names_of(b):
    data, _w, _c = parse_quotation_pdf(b)
    return [str(i.get("itemName") or "") for i in ((data or {}).get("items") or [])]


# ── the real ACIC figures ─────────────────────────────────────────────────────────────────────────
# Items 01 and 02 are what the client sees priced; 03-12 carry the rest of the package, hidden.
ACIC_VISIBLE = 126650221.58
ACIC_TOTAL = 133899916.94
ACIC_VAT = 16067990.03
ACIC_GRAND = 149967906.97
ACIC_HIDDEN = 7249695.36


def acic_items():
    items = [item("01", "2000KVA DIESEL GENERATOR SET", 109191338.25),
             item("02", "SWITCHGEAR AND SYNCHRONISING PANEL", 17458883.33)]
    each = round(ACIC_HIDDEN / 10.0, 2)
    for n in range(3, 13):
        amt = each + (round(ACIC_HIDDEN - each * 10, 2) if n == 12 else 0.0)
        items.append(item("%02d" % n, "SUPPORTING PACKAGE ITEM %d" % n, amt, hide_price=True))
    return items


print("== the total does not move ==")
items = acic_items()
total = round(sum(float(i["total_unit_price"]) for i in items), 2)
eq("visible lines (01 + 02)", round(sum(float(i["total_unit_price"]) for i in items[:2]), 2),
   ACIC_VISIBLE)
eq("hidden lines (03-12)", round(sum(float(i["total_unit_price"]) for i in items[2:]), 2),
   ACIC_HIDDEN)
eq("total, VAT exclusive", total, ACIC_TOTAL)
eq("VAT at 12%", round(total * 0.12, 2), ACIC_VAT)
eq("grand total", round(total * 1.12, 2), ACIC_GRAND)

flat, _pages = text_of(render(items))
one = flat.replace("\n", " ")
ok("the PRINTED total is the full total, not the visible sum", "133,899,916.94" in one)
ok("  and the visible sum is nowhere on the page", "126,650,221.58" not in one)
ok("no hidden line's amount is printed", "724,969.5" not in one)
ok("both money cells of a hidden line are an em dash",
   re.search(r"SUPPORTING PACKAGE ITEM 3\b[^\n]*—[^\n]*—", flat) is not None)

print("\n== hiding NOTHING is byte-identical to before the feature ==")
plain = [item("01", "LATHE MACHINE C6266C", 500000.0), item("02", "TOOL POST GRINDER", 85000.0)]
none_flagged = [dict(i, hide_price=False) for i in plain]
eq("an explicit hide_price=False changes no byte",
   digest(render(none_flagged)), digest(render(plain)))

print("\n== hiding EVERY line ==")
allh = [dict(i, hide_price=True) for i in plain]
flat_all, _ = text_of(render(allh))
ok("the total still prints in full", "585,000.00" in flat_all.replace("\n", " "))
# Per LINE, not per document: "585,000.00" contains "85,000.00", so a substring test over the whole
# page reports a failure that is not there. Each item's own row is what has to be free of its amount.
_rows = [ln for ln in flat_all.split("\n") if "LATHE MACHINE" in ln or "TOOL POST GRINDER" in ln]
ok("neither line's own amount prints on its row",
   len(_rows) == 2 and not any(("500,000.00" in ln or "85,000.00" in ln) for ln in _rows), _rows)
ok("  and both rows carry two em dashes instead",
   all(ln.count("—") >= 2 for ln in _rows), _rows)
ok("the note covers both", "Items 01 and 02 are supplied" in flat_all.replace("\n", " "))

print("\n== the reconciling note ==")
ok("absent when nothing is hidden", "supplied within the package price" not in text_of(render(plain))[0])
ok("names the right span when 03-12 are hidden", "Items 03 to 12 are supplied" in one)
sing = [plain[0], dict(plain[1], hide_price=True)]
ok("singular for one line", "Item 02 is supplied" in text_of(render(sing))[0].replace("\n", " "))
for got, want in ((_number_span(["03"]), "03"),
                  (_number_span(["03", "04"]), "03 and 04"),
                  (_number_span(["03", "04", "05"]), "03 to 05"),
                  (_number_span(["03", "05", "09"]), "03, 05 and 09"),
                  (_number_span(["03", "04", "05", "09"]), "03 to 05 and 09"),
                  (_number_span(["1a", "1b"]), "1a and 1b")):
    eq("  span", got, want)

print("\n== per-item scope headings ==")
scoped = [item("01", "GENERATOR SET", 500000.0, scope="Radiator\n**Accessories**\nSpare filters"),
          item("02", "SWITCHGEAR", 85000.0, scope="Metering relays"),
          item("03", "FREIGHT", 15000.0)]
flat_s, _ = text_of(render(scoped))
ok("item 01 is headed", (QUO_SCOPE_ITEM_HEADING_FMT % "01") in flat_s)
ok("item 02 is headed", (QUO_SCOPE_ITEM_HEADING_FMT % "02") in flat_s)
ok("item 03, which has no scope, is NOT headed", (QUO_SCOPE_ITEM_HEADING_FMT % "03") not in flat_s)
# The trap the heading order exists to avoid: _ITEM_STOP holds "SCOPEOFSUPPLY" as a prefix that ENDS
# the item table, so a heading beginning with those words drops every item after the first.
ok("the heading does not begin with the words that end the item table",
   not re.sub(r"\s+", "", QUO_SCOPE_ITEM_HEADING_FMT % "01").upper().startswith("SCOPEOFSUPPLY"))

print("\n== titled note blocks ==")
FAT = ("Both sets undergo a Factory Acceptance Test witnessed by the client.\n\n"
       "Travel for two witnesses is for the account of the buyer.")
blocked = [item("01", "GENERATOR SET", 500000.0, scope="Radiator",
                blocks=[{"t": "FACTORY ACCEPTANCE TEST — ITEMS 01 & 02", "b": FAT}]),
           item("02", "SWITCHGEAR", 85000.0)]
flat_b, _ = text_of(render(blocked))
ok("the free-text heading prints verbatim", "FACTORY ACCEPTANCE TEST — ITEMS 01 & 02" in flat_b)
ok("both paragraphs print", "Factory Acceptance Test witnessed" in flat_b
   and "Travel for two witnesses" in flat_b)
# Built FROM `plain`, so the only difference between the two documents is the empty block itself.
blank = [dict(plain[0], blocks=[{"t": "", "b": ""}]), plain[1]]
eq("a wholly empty block renders nothing at all", digest(render(blank)), digest(render(plain)))

print("\n== nothing is read back as a product name ==")
CASES = [
    ("scope + block on 01, hidden 03", scoped[:2] + [dict(scoped[2], hide_price=True)],
     ["GENERATOR SET", "SWITCHGEAR", "FREIGHT"]),
    ("a block with NO scope above it",
     [item("01", "GENERATOR SET", 500000.0,
           blocks=[{"t": "DELIVERY", "b": "Ex-works Manila, ninety (90) calendar days."}]),
      item("02", "SWITCHGEAR", 85000.0)], ["GENERATOR SET", "SWITCHGEAR"]),
    ("the ACIC shape, 12 lines over two pages", acic_items(),
     ["2000KVA DIESEL GENERATOR SET", "SWITCHGEAR AND SYNCHRONISING PANEL"]
     + ["SUPPORTING PACKAGE ITEM %d" % n for n in range(3, 13)]),
    ("a SCATTERED span, whose note wraps",
     [item("%02d" % n, "PACKAGE LINE %d" % n, 1000.0 * n, hide_price=(n % 2 == 0))
      for n in range(1, 13)], ["PACKAGE LINE %d" % n for n in range(1, 13)]),
    ("twelve plain items, TWO PAGES — the letterhead, pre-existing",
     [item("%02d" % n, "PACKAGE LINE %d" % n, 1000.0 * n) for n in range(1, 13)],
     ["PACKAGE LINE %d" % n for n in range(1, 13)]),
    ("a scope block on every one of twelve items",
     [item("%02d" % n, "PACKAGE LINE %d" % n, 1000.0 * n,
           scope="**Feature %d**\nOne inclusion\n– a sub-bullet" % n) for n in range(1, 13)],
     ["PACKAGE LINE %d" % n for n in range(1, 13)]),
]
for label, its, want in CASES:
    got = names_of(render(its))
    ok(label, got == want,
       "got %d names, first mismatch %r" % (len(got), next((g for g, w in zip(got, want) if g != w), None)))

print("\n== the adversarial matrix — none of these may raise ==")
LONG = "Specification clause covering tolerances, finish and acceptance. " * 80   # ~5,100 chars
CRUEL = [
    ("a 4,000-character block title",
     [item("01", "GEN", 500000.0, blocks=[{"t": "T" * 4000, "b": "Body."}])]),
    ("a 20,000-character block body",
     [item("01", "GEN", 500000.0, blocks=[{"t": "NOTE", "b": LONG * 4}])]),
    ("a block on every one of twelve items, each with four paragraphs",
     [item("%02d" % n, "LINE %d" % n, 1000.0 * n,
           blocks=[{"t": "NOTE %d" % n, "b": "\n\n".join([LONG[:600]] * 4)}]) for n in range(1, 13)]),
    ("twelve items, every price hidden and every one carrying scope",
     [item("%02d" % n, "LINE %d" % n, 1000.0 * n, hide_price=True,
           scope="\n".join("Inclusion %d" % k for k in range(1, 30))) for n in range(1, 13)]),
    ("a hidden line with a 5,000-character name",
     [item("01", "X" * 5000, 500000.0, hide_price=True), item("02", "GEN", 1.0)]),
    ("blocks whose shape is wrong — None, a string, a list, a dict of junk",
     [item("01", "GEN", 500000.0, blocks=[None, "oops", ["a"], {"nope": 1}])]),
    ("a block that is only a title", [item("01", "GEN", 500000.0, blocks=[{"t": "SOLO"}])]),
    ("a block that is only a body", [item("01", "GEN", 500000.0, blocks=[{"b": "Solo body."}])]),
    ("blocks as a bare string rather than a list",
     [item("01", "GEN", 500000.0, blocks="not a list")]),
    ("hide_price on an item with no price at all",
     [dict(item("01", "GEN", 0.0), total_unit_price=None, total_amount=None, hide_price=True),
      item("02", "SWITCHGEAR", 85000.0)]),
    ("a single item, hidden, and nothing else", [item("01", "GEN", 500000.0, hide_price=True)]),
    ("forty items, alternating hidden, every one with a block",
     [item("%02d" % n, "LINE %d" % n, 1000.0 * n, hide_price=(n % 2 == 0),
           scope="**Head %d**\nOne\n– sub" % n,
           blocks=[{"t": "NOTE %d" % n, "b": LONG[:400]}]) for n in range(1, 41)]),
]
for label, its in CRUEL:
    try:
        b = render(its)
        ok(label + "  (%d pages)" % text_of(b)[1], len(b) > 1000)
    except Exception as exc:                                  # noqa: BLE001 — that IS the assertion
        ok(label, False, "%s: %s" % (type(exc).__name__, exc))

print("\n" + (("%d FAILED" % FAIL) if FAIL else "all passed"))
sys.exit(1 if FAIL else 0)
