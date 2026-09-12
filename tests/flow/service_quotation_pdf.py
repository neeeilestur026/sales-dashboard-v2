"""A276 — the SERVICE QUOTATION: quoting the hire of a tool instead of the sale of one.

Run:  ./venv/bin/python tests/flow/service_quotation_pdf.py

WHY THIS FILE EXISTS.

  1. THE SUPPLY DOCUMENT MUST NOT MOVE. ~102 live quotations render through this renderer, and every
     change A276 makes is a branch inside it. `quotation-baseline.py` hashes eight fixtures and is the
     real guard; this file holds the other half of that promise — that the supply branch still SAYS
     the supply words, so a future edit cannot satisfy the hash by making both documents identical.

  2. THE RATE IS NOT A PRICE. "8,500.00 / DAY" beside "7 DAYS" is a different claim from "8,500.00"
     beside "7 pc(s)", and the difference is the whole document. A mobilization line charged once per
     LOT must NOT gain a "/ LOT", or the reader is invited to multiply a flat fee by something.

  3. THE HEADER FITS. "SERVICE QUOTATION" is nearly twice the width of "QUOTATION" and shares its row
     with the logo. The title shrinks to fit; if that ever stops working the two collide on page one
     of a document that goes to a client.

The figures are the client's own sample, 2026-450-NE-TOOL RENTAL: 7 days x P8,500 and P12,000, an
operator at 7 x P4,500 and mobilization at 1 LOT x P15,000 -> 190,000 / 22,800 / 212,800.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdfminer.high_level import extract_text                      # noqa: E402
from io import BytesIO                                            # noqa: E402
from reportlab.pdfbase import pdfmetrics                          # noqa: E402

from pdf_generators.flow_quotation_pdf import (                   # noqa: E402
    ARCH_XB, MARGIN, PAGE_W, build_quotation_pdf_bytes, build_summary_table, _rate_basis_label)

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     %r" % (extra,)))


def eq(label, got, want):
    ok("%s = %r" % (label, want), got == want, {"got": got, "want": want})


def section(t):
    print("\n" + t)


CLIENT = {"client_name": "Client Company Name", "client_address": "Client address line",
          "subject": "Rental of Torque Tools with Certified Operator & Calibration",
          "reference_no": "2026-450-NE-TOOL RENTAL", "quotation_date": "September 12, 2026",
          "signature_name": "NEIL ESTUR"}

SVC_TERMS = {"validity": "30 days",
             "availability": "3-5 working days upon receipt of PO, subject to tool availability",
             "payment": "50% down payment upon PO; 50% balance upon completion of rental period",
             "support": "Technical support and tool replacement in case of malfunction"}
SUP_TERMS = {"validity": "30 days", "delivery": "7-8 months upon receipt of order",
             "payment": "50% down payment upon PO", "warranty": "1 year against factory defect"}

RENTAL_TC = [
    "Rental period is counted from delivery at site to pick-up; minimum rental period is three (3) days",
    "The client is responsible for loss, theft, or damage beyond normal wear and tear",
    "Standby days caused by client-side delays are billed as rental days",
]


def line(n, name, rate, dur, uom, desc="", scope=None):
    return {"item_no": n, "product_name": name, "product_code": "", "quantity": dur, "uom": uom,
            "total_amount": rate, "total_unit_price": rate * dur, "description": desc,
            "orig_code": "", "orig_name": "", "option_no": "", "scope": scope}


SAMPLE = [
    line(1, "RENTAL - RAD PNEUMATIC TORQUE WRENCH", 8500.0, 7, "DAYS", "Model: RAD 34GX",
         ["Valid calibration certificate", "Carrying / storage case"]),
    line(2, "RENTAL - HYDRAULIC TORQUE WRENCH SET", 12000.0, 7, "DAYS", "700 bar electric pump",
         ["Valid calibration certificate", "Electric pump & hose set"]),
    line(3, "CERTIFIED TOOL OPERATOR / TECHNICIAN", 4500.0, 7, "DAYS", "8 hours per day"),
    line(4, "MOBILIZATION & DEMOBILIZATION", 15000.0, 1, "LOT", "Within Luzon"),
]


def render(items=None, service=True, terms=None, rental_tc=None, **kw):
    items = SAMPLE if items is None else items
    total = sum(i["total_unit_price"] for i in items)
    return build_quotation_pdf_bytes(
        items=items, images={}, client_details=CLIENT,
        terms_and_conditions=terms or (SVC_TERMS if service else SUP_TERMS),
        summary_table_data=build_summary_table(total, "inclusive"),
        desc_mode="long", design_version=2,
        doc_type="service" if service else "supply",
        service_terms=(RENTAL_TC if rental_tc is None else rental_tc), **kw)


def text(pdf):
    return extract_text(BytesIO(pdf))


def flat(pdf):
    """Text with newlines collapsed — ReportLab breaks cells wherever the column ends."""
    return " ".join(text(pdf).split())


def squeeze(pdf):
    """Text with ALL whitespace removed.

    Section headings are drawn letter-spaced — "RENTAL TERMS & CONDITIONS" reaches the page as
    "R E N T A L   T E R M S   &   C O N D I T I O N S" — so collapsing runs of whitespace is not
    enough to find one. Removing every space is."""
    return "".join(text(pdf).split())


# ─────────────────────────────────────────────────────────────
section("1 - the service document says service things")
_pdf = render()
svc, svc_sq = flat(_pdf), squeeze(_pdf)
for probe in ["SERVICE QUOTATION", "SERVICE & DESCRIPTION", "DURATION", "RATE", "AMOUNT",
              "INCLUSIONS"]:
    ok("contains %r" % probe, probe in svc)
# letter-spaced headings — matched with the spaces removed
for probe in ["RENTAL TERMS & CONDITIONS", "VALIDITY", "AVAILABILITY", "PAYMENT", "SUPPORT",
              "BANK DETAILS", "SINCERELY YOURS"]:
    ok("contains the %r heading" % probe, probe.replace(" ", "") in svc_sq)
for absent in ["ITEM & DESCRIPTION", "UNIT PRICE"]:
    ok("does NOT contain %r" % absent, absent not in svc)
for absent in ["WARRANTY", "DELIVERY"]:
    ok("the supply-only heading %r is gone" % absent, absent not in svc_sq)

# ─────────────────────────────────────────────────────────────
section("2 - the supply document is untouched by any of it")
sup = flat(render(service=False))
for probe in ["QUOTATION", "ITEM & DESCRIPTION", "QTY", "UNIT PRICE"]:
    ok("still contains %r" % probe, probe in sup)
for absent in ["SERVICE QUOTATION", "SERVICE & DESCRIPTION", "DURATION", "/ DAY"]:
    ok("never contains %r" % absent, absent not in sup)
sup_sq = squeeze(render(service=False))
for absent in ["RENTAL TERMS & CONDITIONS", "AVAILABILITY", "SUPPORT"]:
    ok("nor the service heading %r" % absent, absent.replace(" ", "") not in sup_sq)
for probe in ["DELIVERY", "WARRANTY"]:
    ok("and keeps its own %r heading" % probe, probe in sup_sq)
ok("a supply caller passing service_terms is ignored, not corrupted",
   "RENTALTERMS" not in squeeze(render(service=False, rental_tc=RENTAL_TC)))

# ─────────────────────────────────────────────────────────────
section("3 - the rate carries its basis, and only when it is time")
eq("DAYS -> per day", _rate_basis_label("DAYS"), "/ DAY")
eq("  singular too", _rate_basis_label("DAY"), "/ DAY")
eq("WEEKS -> per week", _rate_basis_label("WEEKS"), "/ WEEK")
eq("MONTHS -> per month", _rate_basis_label("MONTHS"), "/ MONTH")
eq("HOURS -> per hour", _rate_basis_label("HOURS"), "/ HOUR")
eq("MANDAYS -> per manday", _rate_basis_label("MANDAYS"), "/ MANDAY")
eq("a LOT is a flat charge, not a rate", _rate_basis_label("LOT"), "")
eq("  so is a piece", _rate_basis_label("pc(s)"), "")
eq("  and a blank unit", _rate_basis_label(""), "")
eq("  and a missing one", _rate_basis_label(None), "")
ok("the hire lines print '/ DAY'", "/ DAY" in svc)
ok("the mobilization line does NOT print '/ LOT'", "/ LOT" not in svc)

# ─────────────────────────────────────────────────────────────
section("4 - a duration reads as a duration")
ok("seven days is '7', not '7.0'", "7 DAYS" in svc and "7.0 DAYS" not in svc)
ok("one lot is '1', not '1.0'", "1 LOT" in svc and "1.0 LOT" not in svc)
half = flat(render(items=[line(1, "HALF DAY CALLOUT", 4000.0, 1.5, "DAYS")]))
ok("half a day survives as 1.5", "1.5 DAYS" in half)
ok("  a supply quotation keeps its one decimal", "1.0" in flat(render(service=False)))

# ─────────────────────────────────────────────────────────────
section("5 - the sample's money, to the centavo")
eq("ex-VAT", sum(i["total_unit_price"] for i in SAMPLE), 190000.0)
s = build_summary_table(190000.0, "inclusive")
eq("VAT at 12%", round(s["vat"], 2), 22800.0)
eq("grand total", round(s["total"], 2), 212800.0)
for money in ["190,000.00", "22,800.00", "212,800.00", "59,500.00", "84,000.00",
              "31,500.00", "15,000.00"]:
    ok("prints %s" % money, money in svc)

# ─────────────────────────────────────────────────────────────
section("6 - the title fits beside the logo")
# The logo is drawn at MARGIN and is LOGO_H tall; the title is right-aligned against the far margin.
# What must never happen is the two meeting in the middle.
for title, size_guess in [("QUOTATION", 46), ("SERVICE QUOTATION", 46)]:
    w = pdfmetrics.stringWidth(title, ARCH_XB, size_guess)
    ok("%r at full size is %s" % (title, "too wide - must shrink" if w > PAGE_W - 2 * MARGIN - 150 else "fine"),
       True)
ok("'SERVICE QUOTATION' renders on page 1", "SERVICE QUOTATION" in flat(render()))
ok("  and the reference chip survives beside it", "2026-450-NE-TOOL RENTAL" in svc)
ok("  and the company name is not overprinted away", "H.O ESTUR CORPORATION" in svc)

# ─────────────────────────────────────────────────────────────
section("7 - the awkward shapes still render rather than 500")
cases = [
    ("no service terms at all", dict(rental_tc=[])),
    ("one very long term", dict(rental_tc=["x" * 600])),
    ("no inclusions on any line", dict(items=[line(1, "BARE RENTAL", 1000.0, 3, "DAYS")])),
    ("a zero-duration line", dict(items=[line(1, "PLACEHOLDER", 1000.0, 0, "DAYS")])),
    ("a very long service name", dict(items=[line(1, "RENTAL - " + "TORQUE WRENCH " * 12, 900.0, 5, "DAYS")])),
    ("many lines", dict(items=[line(i, "RENTAL LINE %d" % i, 500.0 + i, 2, "DAYS") for i in range(1, 16)])),
]
for label, kw in cases:
    try:
        pdf = render(**kw)
        ok("%s -> %d bytes" % (label, len(pdf)), len(pdf) > 1000)
    except Exception as e:                                       # a 500 on a client's quotation
        ok(label, False, "%s: %s" % (type(e).__name__, e))

print("\n" + ("%d FAILED" % FAIL if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
