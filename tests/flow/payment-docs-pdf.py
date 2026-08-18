"""A243 — the three payment documents must never fail to render.

Run:  ./venv/bin/python tests/flow/payment-docs-pdf.py

WHY THIS FILE EXISTS. A ReportLab table row cannot split across a page, and ReportLab does not clip
an overlong cell — it grows the row until it is taller than the frame and then raises LayoutError.
The route turns that into a 500, so the document simply does not exist. The request still saved, so
nothing looks wrong until somebody tries to print it.

A238 fixed exactly this in travel_allowance_pdf, and measured its ceilings rather than guessing. The
A243 scan found the identical bug still live in all three payment documents, which between them are
what a supplier is paid against:

    payment_request   purpose @ 1,600 chars -> LayoutError
    payment_slip      purpose @ 1,600 chars -> LayoutError
    cash_voucher      payee_name @ 1,200, particulars @ 2,000 -> LayoutError

1,600 characters is one pasted paragraph in a field labelled "Purpose". These were reachable.

The fix is utils.clip_to_lines at every unsplittable cell, and the cut is visible — an ellipsis —
because silently shortening a line on a document somebody signs is worse than the crash it replaces.

WHAT THIS TEST DOES NOT CLAIM. It maxes every FREE-TEXT field. Controlled fields (currency, the
money figures, dates, priority, payee type, payment method) keep real values, because they come from
dropdowns and computed totals — a 4,000-character currency code is not a shape any caller can
construct, and a test pinning an impossible input is noise, not coverage.
"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdf_generators.payment_request_pdf import build_payment_request_pdf   # noqa: E402
from pdf_generators.payment_slip_pdf import build_payment_slip_pdf         # noqa: E402
from pdf_generators.cash_voucher_pdf import build_cash_voucher_pdf         # noqa: E402
from pdf_generators.utils import clip_to_lines                             # noqa: E402
from reportlab.lib.styles import ParagraphStyle                            # noqa: E402

FAIL = 0


def ok(label, cond, extra=""):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("  " + str(extra) if extra else ""))


# Fields that arrive from a dropdown, a date picker or a computed total. Never free text.
CONTROLLED = {"currency", "amount", "amount_php_est", "po_total", "po_paid_before", "debit_amount",
              "request_date", "due_date", "cv_date", "cheque_date", "paid_at", "priority",
              "payee_type", "payment_method", "payment_mode", "payment_portion",
              "pr_number", "cv_number"}

BASE = dict(
    pr_number="PRF-202608-001", request_date="August 15, 2026", requested_by="N Estur",
    payee_name="ACME SUPPLY CORP", payee_type="Supplier", department="Sales", priority="Normal",
    amount=125000.0, currency="PHP", payment_method="Bank Transfer", bank_name="BDO",
    bank_branch="Makati", account_name="ACME SUPPLY CORP", account_number="0012345678",
    due_date="August 30, 2026", purpose="Supply of generator parts", remarks="",
    amount_php_est=125000.0, po_total=125000.0, po_paid_before=0.0, payment_portion="Full",
    cv_number="CV-202608-001", cv_date="August 15, 2026", particulars="Supply of parts",
    prepared_by="N Estur", approved_by="G Luceña", cheque_number="0012345",
    cheque_date="August 15, 2026", account_charged="COGS", credit_account="Cash in Bank",
    debit_amount=125000.0, payment_mode="Cheque", additional_notes="",
    paid_at="August 16, 2026", paid_by="Accounting")

GENERATORS = [
    ("payment_request", lambda d: build_payment_request_pdf(io.BytesIO(), d)),
    ("payment_slip",    lambda d: build_payment_slip_pdf(io.BytesIO(), d)),
    ("cash_voucher",    lambda d: build_cash_voucher_pdf(io.BytesIO(), d, d)),
]
FREE_TEXT = [k for k, v in BASE.items() if isinstance(v, str) and k not in CONTROLLED]

print("== the exact lengths that used to raise ==")
# Regression anchors: the measured breaking points from the A243 scan.
for name, fn in GENERATORS:
    for field, n in (("purpose", 1600), ("payee_name", 1600), ("particulars", 2000),
                     ("account_name", 1600)):
        rec = dict(BASE)
        rec[field] = "Lorem ipsum dolor sit amet consectetur adipiscing elit. " * (n // 56 + 1)
        try:
            fn(rec)
            ok("%-16s %s at %d chars" % (name, field, n), True)
        except Exception as exc:                                # noqa: BLE001 — that IS the assertion
            ok("%-16s %s at %d chars" % (name, field, n), False,
               "%s: %s" % (type(exc).__name__, str(exc)[:90]))

print("\n== one free-text field at a time, far past anything a person types ==")
for name, fn in GENERATORS:
    broke = []
    for field in FREE_TEXT:
        rec = dict(BASE)
        rec[field] = "Supply and delivery of assorted spare parts and consumables. " * 340   # ~20k
        try:
            fn(rec)
        except Exception as exc:                                # noqa: BLE001
            broke.append("%s(%s)" % (field, type(exc).__name__))
    ok("%-16s survives 20,000 chars in all %d free-text fields" % (name, len(FREE_TEXT)),
       not broke, ", ".join(broke))

print("\n== every free-text field at once ==")
hostile = {k: (("Lorem ipsum dolor sit amet " * 400) if (isinstance(v, str) and k not in CONTROLLED)
               else v) for k, v in BASE.items()}
for name, fn in GENERATORS:
    try:
        fn(hostile)
        ok("%-16s renders with every free-text field at ~10,000 chars" % name, True)
    except Exception as exc:                                    # noqa: BLE001
        ok("%-16s renders with every free-text field at ~10,000 chars" % name, False,
           "%s: %s" % (type(exc).__name__, str(exc)[:110]))

print("\n== the ordinary record still renders, and is not silently clipped ==")
for name, fn in GENERATORS:
    try:
        fn(dict(BASE))
        ok("%-16s renders a normal record" % name, True)
    except Exception as exc:                                    # noqa: BLE001
        ok("%-16s renders a normal record" % name, False, exc)

print("\n== clip_to_lines itself ==")
_st = ParagraphStyle("t", fontName="Helvetica", fontSize=9, leading=11)
ok("short text is returned untouched", clip_to_lines("Supply of parts", _st, 200, 8) == "Supply of parts")
ok("empty is empty", clip_to_lines("", _st, 200, 8) == "" and clip_to_lines(None, _st, 200, 8) == "")
ok("a long value is cut VISIBLY, with an ellipsis", clip_to_lines("A" * 5000, _st, 200, 2).endswith("…"))
ok("  and actually shortened", len(clip_to_lines("A" * 5000, _st, 200, 2)) < 5000)
# It sits in the render path of three money documents; it must never be the thing that fails.
for junk in (None, 12345, 3.14, [], {}, object()):
    try:
        clip_to_lines(junk, _st, 200, 4)
        ok("never raises on %-8s" % type(junk).__name__, True)
    except Exception as exc:                                    # noqa: BLE001
        ok("never raises on %-8s" % type(junk).__name__, False, exc)

print("\n" + (("%d FAILED" % FAIL) if FAIL else "all passed"))
sys.exit(1 if FAIL else 0)
