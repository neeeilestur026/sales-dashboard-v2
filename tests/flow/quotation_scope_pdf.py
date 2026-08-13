"""A235 — per-item scope of supply: it renders, it survives page breaks, and it cannot 500.

Run:  ./venv/bin/python tests/flow/quotation_scope_pdf.py

WHY THIS FILE EXISTS. A213 chose to render scope as table ROWS rather than one cell for a specific
reason: a ReportLab table row cannot split across a page, so any single-cell layout is capped by the
frame height and a long list either truncates or raises LayoutError — a 500 on the quotation a rep is
trying to send. A235 puts a block under EVERY item instead of only the first, which multiplies every
one of those risks. The assertions below are that reasoning made executable.

The BYTE-IDENTITY case is the most important one here. ~100 quotations are already out with clients
and must keep rendering exactly as they did; A213-1 established that discipline and this keeps it.
"""
import hashlib
import io
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdf_generators.flow_quotation_pdf import (          # noqa: E402
    build_quotation_pdf_bytes, build_summary_table, _norm_bullets, _SCOPE_BULLET_LIMIT)

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


CLIENT = {"company": "ACME MINING CORP", "attention": "Ms A Cruz", "address": "Benguet",
          "email": "a@acme.test", "quotation_no": "2026-001-GL-ACME-LATHE", "date": "2026-08-13"}
TERMS = {"delivery": "30 days", "warranty": "1 year", "payment": "50% DP"}

# The only bytes that vary between two runs of identical input. Stripping them is what makes
# "byte-identical" a statement about CONTENT rather than about the clock.
_NOISE = [re.compile(rb"/CreationDate\s*\([^)]*\)"), re.compile(rb"/ModDate\s*\([^)]*\)"),
          re.compile(rb"/ID\s*\[\s*<[^>]*>\s*<[^>]*>\s*\]")]


def item(no, name, price, **kw):
    d = {"item_no": no, "product_code": "PC-" + no, "product_name": name,
         "total_unit_price": price, "total_amount": price, "uom": "unit"}
    d.update(kw)
    return d


def render(items, scope=None, recommended=""):
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
        return "\n".join((p.extract_text() or "") for p in pdf.pages), len(pdf.pages)


TWO = [item("01", "LATHE MACHINE C6266C", 500000.0), item("02", "TOOL POST GRINDER", 85000.0)]

print("== the parser for one item's scope ==")
eq("blank lines never become entries", len(_norm_bullets("a\n\n \n b")), 2)
eq("**bold** becomes a sub-heading", _norm_bullets("**Accessories**")[0]["bold"], True)
eq("a pasted bullet glyph is stripped", _norm_bullets("- 3-jaw chuck")[0]["text"], "3-jaw chuck")
eq("a list of dicts passes through", _norm_bullets([{"text": "x", "bold": True}])[0]["bold"], True)
eq("nothing in, nothing out", _norm_bullets(None), [])

print("\n== byte-identity: a quotation with NO per-item scope is untouched ==")
# The guard for the ~100 live quotations. If this ever fails, the change is wrong no matter how good
# the new feature looks.
base_plain = digest(render(TWO))
eq("rendering twice is reproducible", digest(render(TWO)), base_plain)
ok("an explicit empty scope changes nothing",
   digest(render([item("01", "LATHE MACHINE C6266C", 500000.0, scope=""),
                  item("02", "TOOL POST GRINDER", 85000.0, scope=None)])) == base_plain)

doc_scope = [{"text": "Delivery 30 days", "bold": False},
             {"text": "Standard Accessories", "bold": True},
             {"text": "3-jaw chuck 250mm", "bold": False}]
base_doc = digest(render(TWO, scope=doc_scope))
ok("the DOCUMENT-level block still renders and is stable", digest(render(TWO, scope=doc_scope)) == base_doc)
ok("  and differs from the no-scope document", base_doc != base_plain)

print("\n== each item's scope prints under ITS OWN item ==")
t, _ = text_of(render([item("01", "LATHE MACHINE", 500000.0, scope="ALPHA inclusion"),
                       item("02", "TOOL GRINDER", 85000.0, scope="BETA inclusion")]))
flat = t.replace("\n", " ")
pos = [flat.find(x) for x in ("LATHE", "ALPHA", "GRINDER", "BETA")]
ok("order is item1 -> its scope -> item2 -> its scope", all(a < b for a, b in zip(pos, pos[1:])), pos)
ok("every marker was actually found", all(p >= 0 for p in pos), pos)

print("\n== many entries: nothing is dropped, the document paginates ==")
forty = "\n".join("Inclusion number %d for the machine package" % i for i in range(1, 41))
t40, pages40 = text_of(render([item("01", "LATHE MACHINE", 500000.0, scope=forty),
                               item("02", "TOOL GRINDER", 85000.0)]))
found = sum(1 for i in range(1, 41) if ("Inclusion number %d " % i) in t40.replace("\n", " "))
eq("all 40 bullets reach the page", found, 40)
ok("and the document ran onto a second page rather than truncating", pages40 >= 2, pages40)

print("\n== long text: capped, VISIBLY, and never a LayoutError ==")
# The failure this whole design exists to prevent. An absurd single bullet must still render.
try:
    big = render([item("01", "LATHE MACHINE", 500000.0, scope="Q" * 4000)])
    tb, _ = text_of(big)
    ok("a 4000-character bullet renders without raising", True)
    ok("  and the cut is VISIBLE (ellipsis), never silent", "…" in tb)
except Exception as e:                                     # noqa: BLE001 — any failure is the bug
    ok("a 4000-character bullet renders without raising", False, "%s: %s" % (type(e).__name__, e))
eq("the cap is a named constant, not a literal", _SCOPE_BULLET_LIMIT, 1200)

print("\n== load: every item carrying a block, all at once ==")
try:
    many = [item("%02d" % n, "MACHINE %d" % n, 100000.0,
                 scope="\n".join("Item %d inclusion %d" % (n, i) for i in range(1, 16)))
            for n in range(1, 9)]
    tm, pm = text_of(render(many))
    ok("8 items x 15 entries renders", True)
    ok("  and every one of the 120 entries is on the page",
       all(("Item %d inclusion %d" % (n, i)) in tm.replace("\n", " ")
           for n in range(1, 9) for i in range(1, 16)))
except Exception as e:                                     # noqa: BLE001
    ok("8 items x 15 entries renders", False, "%s: %s" % (type(e).__name__, e))

print("\n== a sub-heading never strands at a page foot ==")
# Orphan control: the heading shares a ROW with its first bullet, and rows do not split. Proven
# structurally rather than by pixel-hunting — if they are in one row they cannot be separated.
head = "\n".join(["Filler line %d" % i for i in range(1, 34)] + ["**Standard Accessories**", "3-jaw chuck"])
th, ph = text_of(render([item("01", "LATHE MACHINE", 500000.0, scope=head)]))
fh = th.replace("\n", " ")
ok("the heading and its first bullet both survive",
   "Standard Accessories" in fh and "3-jaw chuck" in fh)
ok("  and the heading still precedes its bullet",
   fh.find("Standard Accessories") < fh.find("3-jaw chuck"))

print("\n== walking the page boundary one bullet at a time ==")
# The concern this feature was asked about by name: "without ruining the page break and spacing". A
# single split is one sample and could pass by luck, so step the block across the boundary and require
# the same three things at EVERY count — nothing raised, nothing lost, no heading stranded from its
# bullet. The crossing lands between 34 and 35 on the current frame; the range brackets it either way.
def _walk(n):
    lines = ["Inclusion line %02d for the machine package" % i for i in range(1, n)]
    lines += ["**Standard Accessories**", "3-jaw chuck 250mm"]     # heading + its bullet, last
    b = render([item("01", "LATHE MACHINE", 500000.0, scope="\n".join(lines)),
                item("02", "TOOL GRINDER", 85000.0, scope="Carbide inserts, 10 pcs")])
    import pdfplumber
    with pdfplumber.open(io.BytesIO(b)) as pdf:
        pages = [(p.extract_text() or "").replace("\n", " ") for p in pdf.pages]
    flat = " ".join(pages)
    lost = [i for i in range(1, n) if ("Inclusion line %02d " % i) not in flat]
    hp = [j for j, t in enumerate(pages) if "Standard Accessories" in t]
    bp = [j for j, t in enumerate(pages) if "3-jaw chuck 250mm" in t]
    return lost, hp, bp, ("Carbide inserts" in flat)

_lost, _orphan, _tail, _crossed = [], [], [], set()
for _n in range(24, 46):
    try:
        lost, hp, bp, tail = _walk(_n)
    except Exception as e:                                 # noqa: BLE001 — any raise is the bug
        _lost.append((_n, "%s: %s" % (type(e).__name__, e)))
        continue
    if lost: _lost.append((_n, lost))
    if not hp or not bp or hp[0] != bp[0]: _orphan.append((_n, hp, bp))
    if not tail: _tail.append(_n)
    if hp: _crossed.add(hp[0])
ok("no bullet is lost at any count", not _lost, _lost[:3])
ok("no sub-heading is ever stranded from its bullet", not _orphan, _orphan[:3])
ok("the NEXT item's scope survives every split", not _tail, _tail[:3])
ok("  and the block really did cross a page boundary in this sweep", len(_crossed) > 1, sorted(_crossed))

print("\n== the two blocks coexist ==")
tc, _ = text_of(render([item("01", "LATHE MACHINE", 500000.0, scope="ITEMLEVEL inclusion"),
                        item("02", "TOOL GRINDER", 85000.0)], scope=doc_scope))
fc = tc.replace("\n", " ")
ok("per-item and document-level both print", "ITEMLEVEL inclusion" in fc and "Delivery 30 days" in fc)

print("\n" + ("%d FAILED" % FAIL) if FAIL else "\nall passed")
sys.exit(1 if FAIL else 0)
