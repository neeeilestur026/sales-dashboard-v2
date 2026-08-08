"""Fixtures for the travel-allowance pack, shared by the A214 suite.

SAMPLE is the source workbook's own claim — ₱35 tricycle + ₱70 bus on 2026-07-27 — because it is the
case that proves the three pages are not additive: ₱105 spent, ₱105 of trips, ₱35 without a receipt.
"""
import base64
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pdf_generators.travel_allowance_pdf import build_travel_allowance_pdf_bytes  # noqa: E402


def leg(seq, date, desc, means, amount, dep="", arr="", receipt=False, kind="Transport"):
    return {"seq": seq, "date": date, "kind": kind, "description": desc,
            "departureTime": dep, "arrivalTime": arr, "means": means,
            "amount": amount, "hasReceipt": receipt}


SAMPLE = {
    "travNo": "TRAV-0007", "date": "2026-08-03",
    "weekStart": "2026-07-27", "weekEnd": "2026-08-02",
    "user": "ROJAN LEO R. FRANCISCO JR.", "position": "Accounting Staff",
    "durationLabel": "July 27-31, 2026", "purpose": "Client visit in Makati, City",
    "floatAmount": 2000,
    "items": [
        leg(1, "2026-07-27", "Residence to Terminal", "Tricycle", 35, "7:30 AM", "7:40 AM", False),
        leg(2, "2026-07-27", "Terminal to MRT Kamuning", "Bus", 70, "7:42 AM", "9:50 AM", True),
    ],
}

EMPTY = {"travNo": "", "date": "2026-08-03", "weekStart": "2026-07-27", "weekEnd": "2026-08-02",
         "user": "Crystal Gayle", "position": "Sales Engineer", "floatAmount": 2000, "items": []}


def many(n, receipts_every=2):
    """n legs across five days, alternating receipts."""
    return {**SAMPLE, "items": [
        leg(i, "2026-07-%02d" % (27 + (i - 1) % 5), "Leg %d of the week" % i,
            ["Bus", "MRT", "Jeepney", "Tricycle", "Grab"][i % 5], 10 + i,
            "7:%02d AM" % (i % 60), "8:%02d AM" % (i % 60), i % receipts_every == 0)
        for i in range(1, n + 1)]}


def a_jpeg(px=40, colour=(200, 120, 40)):
    """A real, decodable JPEG — so 'the annex drew the photo' can be told from 'it drew a box'."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (px, px), colour).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def render(rec, receipts=None):
    rcp = []
    for r in (receipts or []):
        raw = None
        if r.get("dataUrl"):
            raw = base64.b64decode(r["dataUrl"].split(",", 1)[1])
        rcp.append({"seq": r.get("seq"), "bytes": raw})
    return build_travel_allowance_pdf_bytes(rec, receipts=rcp)
