"""Fixtures for the quotation renderer, shared by the baseline and the A213 suite.

Every fixture here is SCOPE-LESS on purpose. They exist to prove the untouched path stays untouched:
~100 live quotations render through it, and A213 rewires the items table's backgrounds and rules,
which is exactly the kind of change that shifts a hairline by a quarter point and nobody notices.

Two PDFs of identical content are not byte-identical — /CreationDate and the /ID array differ per
run — so `digest()` strips both before hashing.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pdf_generators.flow_quotation_pdf import build_quotation_pdf_bytes, build_summary_table  # noqa: E402


# Keys copied from what blueprints/flow.py:262-279 actually builds. Guessing them produced a
# sample with a blank Date and no customer, which looked like a renderer bug and was not one.
CLIENT = {
    "client_name": "San Miguel Global Power Holdings — Mariveles Power Generator",
    "client_address": "Bataan Freeport Zone Biaan, Mariveles, Bataan 2105 Philippines",
    "attention": "Wilfredo L. Villafuerte",
    "designation": "Procurement Assistant",
    "email": "wvillafuerte@smcgph.sanmiguel.com.ph",
    "subject": "Precision Heavy Duty Lathe Machine",
    "reference_no": "2026-434-NE-SMGPH-LATHE MACHINE",
    "reference_rfq_no": "PR 4279, 4282, 4283, 4284",
    "quotation_date": "August 08, 2026",
    "signature_name": "NEIL ESTUR",
    "signature_designation": "SALES APPLICATION AND FIELD EXECUTIVE",
    "signature_viber": "+639685541499",
    "signature_mobile": "+639685541499",
    "signature_email": "safe1.hi-escorp@hiescorp.com",
}

TERMS = {"validity": "30 days", "delivery": "7-8 months upon receipt of order",
         "payment": "50% down payment upon PO; 50% balance within 30 days after delivery of invoice",
         "warranty": "1 year warranty against factory defect"}


def item(n, name, price, qty=1.0, **kw):
    d = {"item_no": n, "product_name": name, "product_code": kw.get("code", "FML-600x3000"),
         "quantity": qty, "uom": kw.get("uom", "pc(s)"),
         "total_unit_price": price, "total_amount": price * qty,
         "description": kw.get("description", ""),
         "orig_code": kw.get("orig_code", ""), "orig_name": kw.get("orig_name", "")}
    if kw.get("option_no"):
        d["option_no"] = kw["option_no"]
    return d


LONG_DESC = ("Swing x Center: 600 x 3000 mm · Spindle Motor & Speed: 15HP (25-1200 rpm) (12) · "
             "Bed width: 420 mm · Spindle bore: 104 mm · Spindle nose: D1-11 · Tailstock quill "
             "diameter 90 mm · Cross slide travel 350 mm · Compound rest travel 180 mm")


def fixtures():
    """(name, kwargs) pairs. Keep the names stable — they are the baseline filenames."""
    one = [item("01", "PRECISION HEAVY DUTY LATHE MACHINE", 5439522.41, description=LONG_DESC)]
    three = [item("01", "PRECISION HEAVY DUTY LATHE MACHINE", 5439522.41, description=LONG_DESC),
             item("02", "HYDRAULIC TORQUE WRENCH KIT", 385000.00, qty=2.0, code="TWHC-8"),
             item("03", "BOLT TENSIONER SET", 129500.50, qty=4.0, code="BT-M36")]
    return [
        ("plain", dict(items=one, summary_table_data=build_summary_table(5439522.41, "inclusive"))),
        ("short-mode", dict(items=one, desc_mode="short",
                            summary_table_data=build_summary_table(5439522.41, "inclusive"))),
        ("long-mode", dict(items=one, desc_mode="long",
                           summary_table_data=build_summary_table(5439522.41, "inclusive"))),
        ("multi-item", dict(items=three, desc_mode="long",
                            summary_table_data=build_summary_table(6339023.41, "inclusive"))),
        ("discounted", dict(items=one, desc_mode="long",
                            summary_table_data=build_summary_table(5439522.41, "inclusive", 7.5))),
        ("paired-offer", dict(
            items=[item("01", "PRECISION HEAVY DUTY LATHE MACHINE", 5439522.41, description=LONG_DESC,
                        orig_code="LM-600", orig_name="Heavy duty lathe, 600mm swing")],
            desc_mode="long", summary_table_data=build_summary_table(5439522.41, "inclusive"))),
        ("alt-offers", dict(
            items=[item("01", "COMMON BASE ITEM", 100000.0),
                   item("02", "LATHE — OPTION A", 5439522.41, option_no="1", description=LONG_DESC),
                   item("03", "LATHE — OPTION B", 4880000.00, option_no="2", description=LONG_DESC)],
            recommended_option="1", desc_mode="long",
            summary_table_data=build_summary_table(5539522.41, "inclusive"))),
        ("exclusions-options", dict(
            items=one, desc_mode="long",
            summary_table_data=build_summary_table(5439522.41, "inclusive"),
            exclusions=[{"text": "Civil works and foundation", "bold": False},
                        {"text": "Electrical rough-in beyond the terminal box", "bold": False},
                        {"text": "Crane and rigging at site", "bold": False}],
            options=[{"text": "Extended 2-year warranty", "price": "PHP 180,000.00"},
                     {"text": "On-site commissioning, 5 days", "price": "PHP 95,000.00"}])),
    ]


def render(kwargs):
    kw = dict(kwargs)
    kw.setdefault("images", {})
    kw.setdefault("client_details", CLIENT)
    kw.setdefault("terms_and_conditions", TERMS)
    return build_quotation_pdf_bytes(**kw)


_VOLATILE = [re.compile(rb"/CreationDate\s*\([^)]*\)"),
             re.compile(rb"/ModDate\s*\([^)]*\)"),
             re.compile(rb"/ID\s*\[[^\]]*\]", re.S)]


def digest(pdf_bytes):
    """Hash the bytes with the per-run volatiles blanked, so identical content hashes identically."""
    b = pdf_bytes
    for rx in _VOLATILE:
        b = rx.sub(b"", b)
    return hashlib.sha256(b).hexdigest()
