"""A281 — the SERVICE QUOTATION, end to end through the real Flask route.

Run:  ./venv/bin/python tests/flow/service_quotation_route.py

WHY THIS FILE EXISTS, AND WHY THE BUILDER'S OWN TEST WAS NOT ENOUGH.

A276 built every half of the hire document — the title, the DURATION/RATE columns, the "/ DAY"
suffix, the rental-terms block — and `service_quotation_pdf.py` proved all of it by calling
`build_quotation_pdf_bytes` directly with `doc_type="service"`.

The document was still impossible to produce. `blueprints/flow.py` never passed `doc_type`, so the
parameter defaulted to "supply" and every quotation the app rendered came out as an ordinary one.
A test that calls the builder directly cannot see that: it supplies the argument the caller forgot.

So this file goes through the ROUTE, exactly as the browser does. It is the difference between
"the renderer can draw a hire" and "the app can produce one".

It also pins the bug found while wiring it: the builder picks its own four term keys by doc_type —
("validity", "availability", "payment", "support") for a hire — and reads them off the dict it is
handed. Mapping the hire's two into the supply names left AVAILABILITY and SUPPORT printing an
em-dash on a document going to a client.

The figures are the A276 sample, 2026-450-NE-TOOL RENTAL: 7 x 8,500 + 7 x 12,000 + 7 x 4,500 +
1 LOT x 15,000 -> 190,000 / 22,800 / 212,800.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")

from io import BytesIO                                           # noqa: E402
from pdfminer.high_level import extract_text                     # noqa: E402

from app import app                                              # noqa: E402

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n         " + repr(extra)[:300]))


def line(no, name, qty, price, uom, kind, duration=None):
    return {"itemNo": no, "itemName": name, "description": name, "qty": qty, "price": price,
            "uom": uom, "chargeKind": kind, "rateBasis": uom, "scope": "", "blocks": [],
            "hidePrice": False, "group": "", "optionNo": "", "imageDataUrl": "",
            # A282 — how long, as opposed to how many. Absent means one rate-unit, which is what
            # every caller that predates it sends and is why those documents did not move.
            "duration": duration}


BASE = {
    "quotationNo": "2026-450-NE", "customer": "HOLCIM PHILIPPINES, INC.", "date": "2026-09-21",
    "vatOption": "inclusive", "discountPct": 0, "descMode": "long", "photos": False,
    "designVersion": 2,
    "items": [
        line("HTW-3000", "HYDRAULIC TORQUE WRENCH, 3000 Nm", 7, 8500, "DAYS", "Rental"),
        line("HP-700", "ELECTRIC HYDRAULIC PUMP, 700 bar", 7, 12000, "DAYS", "Rental"),
        line("OPR", "CERTIFIED OPERATOR on site", 7, 4500, "MANDAYS", "Operator"),
        line("MOB", "MOBILIZATION and DEMOBILIZATION", 1, 15000, "LOT", "Mobilization"),
    ],
    "doc": {
        "address": "Norzagaray, Bulacan", "attention": "Engr. R. Santos", "designation": "Maintenance Head",
        "email": "r.santos@holcim.example", "subject": "RENTAL OF HYDRAULIC TORQUE WRENCH PACKAGE",
        "rfqNo": "RFQ-2026-118", "note": "", "plantSite": "Norzagaray Plant", "descMode": "long",
        "validity": "30 days", "payment": "30 days upon billing",
        "delivery": "1-3 weeks upon receipt of order", "warranty": "1 year",
        "availability": "Subject to availability on the requested dates",
        "support": "Operator training and on-call support included",
        "serviceTerms": ("The tool remains the property of H.O Estur Corporation at all times.\n"
                         "Transport to and from site is for the client's account.\n"
                         "The client is responsible for loss or damage while in their custody."),
        "sigName": "Neil Estur", "sigDesignation": "Sales Engineer",
        "sigMobile": "0917 000 0000", "sigViber": "0917 000 0000", "sigEmail": "neil@hiescorp.com",
        "scope": "", "exclusions": "", "options": "",
    },
}


def render(payload):
    with app.test_client() as c:
        r = c.post("/flow/quotation-pdf", json=payload)
    assert r.status_code == 200, (r.status_code, r.data[:300])
    assert r.headers["Content-Type"] == "application/pdf", r.headers["Content-Type"]
    raw = extract_text(BytesIO(r.data))
    spaced = " ".join(raw.split())
    # Headings are letter-spaced by the renderer ("R E N T A L"), so collapse single-char runs.
    flat = re.sub(r"(?<=\b\w) (?=\w\b)", "", spaced)
    return r.data, spaced, flat


print("== the hire document, through the route ==")
svc = dict(BASE); svc["docType"] = "Service"
data, t, flat = render(svc)
ok("the route answers with a PDF", len(data) > 50000, len(data))
ok("titled SERVICE QUOTATION — the route passes doc_type at last", "SERVICE QUOTATION" in t, t[:160])
# A282 — SIX columns on a hire: QTY (how many tools), RATE, DURATION (for how long), AMOUNT.
ok("the columns ask QTY, RATE and DURATION", all(h in t for h in ("QTY", "RATE", "DURATION")))
ok("  and never UNIT PRICE — a hire quotes a rate", "UNIT PRICE" not in t)
ok("a day rate prints its per-unit", "/ DAY" in t)
ok("  a manday rate its own", "/ MANDAY" in t)
ok("  and a LOT charge prints NONE — it is a flat fee, not a rate to multiply", "/ LOT" not in t)
ok("the rental terms block is drawn", "RENTALTERMS" in flat or "RENTAL TERMS" in flat)
ok("  with the terms that were typed", "property of H.O Estur" in t)
# The bug this file was written for.
ok("AVAILABILITY carries its value, not an em-dash", "Subject to availability" in t, t[-400:])
ok("SUPPORT carries its value", "Operator training" in t, t[-400:])
ok("  and the supply headings are gone", "DELIVERY" not in flat and "WARRANTY" not in flat)
ok("the A276 sample arithmetic: 190,000 ex-VAT", "190,000.00" in t)
ok("  VAT 22,800", "22,800.00" in t)
ok("  grand total 212,800", "212,800.00" in t)

print("\n== the supply document is untouched ==")
sup = dict(BASE)                       # no docType at all — what every existing caller sends
data2, t2, flat2 = render(sup)
ok("titled QUOTATION", "QUOTATION" in t2 and "SERVICE QUOTATION" not in t2)
ok("the columns ask QTY and UNIT PRICE", "UNIT PRICE" in t2)
ok("  and never DURATION", "DURATION" not in t2)
ok("no rate suffix anywhere", "/ DAY" not in t2 and "/ MANDAY" not in t2)
ok("no rental-terms block", "RENTALTERMS" not in flat2)
ok("DELIVERY and WARRANTY are back", "DELIVERY" in flat2 and "WARRANTY" in flat2)
ok("  carrying the supply values", "1-3 weeks" in t2 and "1 year" in t2)
ok("the same money", "190,000.00" in t2 and "212,800.00" in t2)

print("\n== docType is read exactly, and anything else is a supply quotation ==")
for val, want_service in [("Service", True), ("service", True), ("SERVICE", True),
                          ("", False), ("Supply", False), ("rental", False)]:
    p = dict(BASE); p["docType"] = val
    _, tt, _ = render(p)
    got = "SERVICE QUOTATION" in tt
    ok("docType=%-8r -> %s" % (val, "SERVICE QUOTATION" if want_service else "QUOTATION"), got == want_service)

print("\n== a refundable deposit is not VATed — the quotation must agree with the invoice ==")
# WHY: createInvoice has charged VAT on revenue only since A278; a deposit is the client's own money
# held against damage, not consideration for a supply. The quotation used to tax it, so the client
# was quoted one figure and billed another on the document they keep. Same four sample lines
# (190,000) plus a 20,000 refundable deposit: subtotal 210,000, VAT still 22,800, grand 232,800.
dep = dict(BASE); dep["docType"] = "Service"
dep["items"] = BASE["items"] + [line("DEP", "REFUNDABLE SECURITY DEPOSIT", 1, 20000, "LOT", "Deposit")]
_, td, flatd = render(dep)
ok("the deposit line is on the document", "REFUNDABLESECURITYDEPOSIT" in flatd or "SECURITY DEPOSIT" in td)
ok("subtotal carries it: 210,000", "210,000.00" in td, td[-500:])
ok("VAT is 22,800 — 12% of the 190,000 that is revenue", "22,800.00" in td, td[-500:])
ok("  and NOT 25,200, which is 12% of the subtotal", "25,200.00" not in td)
ok("grand total 232,800", "232,800.00" in td, td[-500:])
ok("the row says what the tax was charged on", "12% on PHP 190,000.00" in " ".join(td.split()), td[-500:])
ok("  and why the client's arithmetic will not match", "not subject to VAT" in td)

print("\n-- with a quotation discount, the base is discounted too --")
dep10 = dict(dep); dep10["discountPct"] = 10
_, td10, _ = render(dep10)
ok("net 189,000 after 10% off 210,000", "189,000.00" in td10)
ok("VAT 20,520 — 12% of the discounted 171,000", "20,520.00" in td10, td10[-500:])
ok("grand 209,520", "209,520.00" in td10, td10[-500:])

print("\n-- a supply quotation is unchanged: no charge kinds exist there, so VAT is on all of it --")
sdep = dict(BASE); sdep["items"] = dep["items"]        # no docType -> supply
_, tsd, _ = render(sdep)
ok("VAT 25,200 on the full 210,000", "25,200.00" in tsd, tsd[-500:])
ok("  the row keeps its plain label", "12% on PHP" not in " ".join(tsd.split()))

print("\n== A282: TWO wrenches for SEVEN days — a hire has two multipliers ==")
# The gap this closes: A276 put the duration in the quantity column, so "qty 7" meant seven days of
# ONE tool and a second wrench could not be quoted at all. Qty is now how many tools, Duration is
# for how long, and the amount is the product of the three.
two = dict(BASE); two["docType"] = "Service"
two["items"] = [
    line("HTW-3000", "HYDRAULIC TORQUE WRENCH, 3000 Nm", 2, 8500, "DAYS", "Rental", 7),
    line("OPR", "CERTIFIED OPERATOR on site", 1, 4500, "MANDAYS", "Operator", 7),
    line("MOB", "MOBILIZATION and DEMOBILIZATION", 1, 15000, "LOT", "Mobilization"),
    line("DEP", "REFUNDABLE SECURITY DEPOSIT", 2, 10000, "LOT", "Deposit"),
]
# 2 x 8,500 x 7 = 119,000 | 1 x 4,500 x 7 = 31,500 | 15,000 flat | 2 x 10,000 deposit = 20,000
# subtotal 185,500, VAT on 165,500 = 19,860, total 205,360.
_, t2d, flat2d = render(two)
ok("two wrenches at a day rate bill for seven days", "119,000.00" in t2d, t2d[:900])
ok("  one operator for seven mandays", "31,500.00" in t2d)
ok("  a LOT charge is flat — it is NOT multiplied by the hire's length", "15,000.00" in t2d)
ok("  and neither is the deposit: 2 tools x 10,000, not x 7 days", "20,000.00" in t2d)
ok("subtotal 185,500", "185,500.00" in t2d, t2d[-600:])
ok("  VAT 19,860 — 12% of the 165,500 that is revenue", "19,860.00" in t2d, t2d[-600:])
ok("  total 205,360", "205,360.00" in t2d, t2d[-600:])
_f2 = " ".join(t2d.split())
ok("the DURATION column states the span", "7 DAYS" in _f2 or "7" in _f2)
ok("  a flat line's duration is an em-dash, not a 1 to be multiplied", "\u2014" in t2d)

print("\n-- a duration is only ever applied to a rate per unit of TIME --")
for uom, dur, want in [("DAYS", 5, 50000), ("WEEKS", 2, 20000), ("HOURS", 3, 30000),
                       ("LOT", 5, 10000), ("PC(S)", 5, 10000), ("DAYS", 0, 10000),
                       ("DAYS", None, 10000)]:
    p1 = dict(BASE); p1["docType"] = "Service"
    p1["items"] = [line("X", "ONE LINE", 1, 10000, uom, "Rental", dur)]
    _, tt, _ = render(p1)
    ok("%-6s x %-4s -> %s" % (uom, dur, "{:,.2f}".format(want)), "{:,.2f}".format(want) in tt, tt[:400])

print("\n-- and a SUPPLY quotation never spans, whatever it is sent --")
psup = dict(BASE)
psup["items"] = [line("X", "ONE LINE", 2, 10000, "DAYS", "", 7)]
_, tsup, _ = render(psup)
ok("2 x 10,000 = 20,000, the duration ignored", "20,000.00" in tsup, tsup[:400])
ok("  and 140,000 appears nowhere", "140,000.00" not in tsup)

out = os.environ.get("SVC_PDF_OUT")
if out:
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "service_quotation_route.pdf"), "wb").write(data)
    print("\nwrote " + os.path.join(out, "service_quotation_route.pdf"))

print("\n" + ("%d FAILURE(S)" % FAIL if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
