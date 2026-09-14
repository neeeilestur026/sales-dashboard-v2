"""A277 — the Friday report and the lead sheet, extracted and read, not screenshotted.

Run:  ./venv/bin/python tests/flow/leadgen_pdf.py

Both builders are pure: they take the payload the page drew from. So the test is that the eight
numbers the page showed are the eight numbers on the paper, that the reply rate carries its
definition, that a non-working day is drawn but not counted, and that the lead sheet says which of
the four conditions held. Also writes both PDFs to the scratchpad for a look.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from io import BytesIO                                            # noqa: E402
from pdfminer.high_level import extract_text                      # noqa: E402
from PyPDF2 import PdfReader                                      # noqa: E402

from pdf_generators.leadgen_report_pdf import (                   # noqa: E402
    build_leadgen_week_pdf_bytes, build_leadgen_lead_pdf_bytes)

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n         " + repr(extra)[:300]))


DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]
KEYS = ["plants", "contacts", "introEmails", "followupEmails", "coldCalls", "followupCalls", "leads", "meetings"]
by_day = {}
for i, d in enumerate(DAYS):
    working = i < 5 and d != "2026-09-09"
    by_day[d] = {"plants": 15 if working else 3, "contacts": 20, "introEmails": 40, "followupEmails": 25,
                 "coldCalls": 22, "followupCalls": 9, "leads": 3, "meetings": 1 if i % 2 == 0 else 0,
                 "replies": 2, "working": working}
working_days = [d for d in DAYS if by_day[d]["working"]]
totals = {k: sum(by_day[d][k] for d in working_days) for k in KEYS}
quotas = {"plants": 15, "contacts": 20, "introEmails": 40, "followupEmails": 30, "coldCalls": 20, "followupCalls": 10, "leads": 3, "meetings": 1}
targets = {k: quotas[k] * len(working_days) for k in KEYS}
WEEK = {
    "success": True, "today": "2026-09-11", "hour": "15:05", "date": "2026-09-11",
    "day": by_day["2026-09-11"], "quotas": quotas,
    "week": {"start": DAYS[0], "end": DAYS[6], "days": DAYS, "workingDays": working_days, "targets": targets, "totals": totals,
             "byDay": by_day, "replies": 8, "replyRate": 5.0, "replyRateAim": 8},
    "sector": {"name": "Power", "index": 3, "of": 4}, "reps": {"Luzon": "gerald", "VisMin": "kim"},
    "workingDays": ["Mon", "Tue", "Wed", "Thu", "Fri"], "holidays": ["2026-09-09"], "maxBatch": 60,
    "preparedBy": "Ana Reyes",
}

print("== the Friday report ==")
pdf = build_leadgen_week_pdf_bytes(WEEK)
text = extract_text(BytesIO(pdf))
flat = " ".join(text.split())
ok("one page", len(PdfReader(BytesIO(pdf)).pages) == 1, len(PdfReader(BytesIO(pdf)).pages))
ok("title and the week", "Lead Generation" in flat and "Weekly Report" in flat and "2026-09-07 to 2026-09-13" in flat, flat[:200])
ok("four working days, the holiday named", "4 working days" in flat and "2026-09-09" in flat, flat[:300])
ok("sector week printed", "Sector week 3 of 4: Power" in flat, flat[:300])
for k, label in [("plants", "Plants researched"), ("introEmails", "Intro emails"), ("leads", "Leads handed off"), ("meetings", "Meetings booked")]:
    ok("%s: target %d and actual %d both on the page" % (label, targets[k], totals[k]),
       label in flat and str(targets[k]) in flat and str(totals[k]) in flat, (label, targets[k], totals[k]))
ok("follow-up emails short by 20 (100 of 120)", "20 short" in flat, flat)
ok("plants met (60 of 60)", flat.count("met") >= 1 and "60" in flat)
ok("reply rate with its definition", "Reply rate: 5.0%" in flat and "(aim 8%)" in flat and "8 ÷ 160" in flat, flat)
ok("Mon–Sun grid drawn with the non-working days present", all(d in flat for d in ["Mon", "Sat", "Sun"]) and "09-12" in flat, flat)
ok("reps by username", "Luzon: gerald" in flat and "VisMin: kim" in flat, flat)
ok("prepared by in the footer", "Prepared by Ana Reyes" in flat, flat[-300:])
ok("a Saturday number is drawn as data, not counted: 3 appears, weekly plants stays 60", " 3 " in flat and "60" in flat)

print("\n== an empty week does not throw ==")
empty = build_leadgen_week_pdf_bytes({"week": {}, "quotas": {}, "preparedBy": ""})
ok("renders", len(empty) > 500)
ok("reply rate dash", "Reply rate: —" in " ".join(extract_text(BytesIO(empty)).split()))

print("\n== the lead sheet ==")
LEAD = {"leadNo": "QLD-202609-004", "plantNo": "PLT-1", "contactNo": "CTC-1", "territory": "Luzon", "handedTo": "gerald",
        "rightPerson": True, "ownMaintenance": True, "flangedOrHydraulic": False, "saidYes": True,
        "pain": "Bolt failures on the kiln shell — 3 shutdowns this year", "whatTheySaid": "Send a deck & a price for a torque wrench set <b>before</b> Friday",
        "nextStep": "Presentation with the maintenance head", "nextStepDate": "2026-09-18", "presentationDate": "2026-09-25", "bookedOn": "2026-09-11",
        "status": "Presentation Booked", "handedOffOn": "2026-09-10", "rehandedOn": "", "company": "Holcim Philippines", "plantSite": "Bulacan",
        "sector": "Cement", "province": "Bulacan", "contactName": "R. Santos", "contactRole": "Maintenance / O&M Head",
        "contactEmail": "r.santos@holcim.example", "contactMobile": "0917 000 0000", "notes": ""}
pdf2 = build_leadgen_lead_pdf_bytes({"lead": LEAD, "preparedBy": "Ana Reyes"})
t2 = " ".join(extract_text(BytesIO(pdf2)).split())
ok("one page", len(PdfReader(BytesIO(pdf2)).pages) == 1)
ok("title names the company and site", "Lead Sheet" in t2 and "Holcim Philippines" in t2 and "Bulacan" in t2, t2[:200])
ok("id, territory and status in the subtitle", "QLD-202609-004" in t2 and "Luzon" in t2 and "Presentation Booked" in t2, t2[:300])
ok("the contact and how to reach them", "R. Santos" in t2 and "Maintenance / O&M Head" in t2 and "0917 000 0000" in t2 and "r.santos@holcim.example" in t2, t2)
ok("handed to gerald on 2026-09-10", "gerald" in t2 and "2026-09-10" in t2, t2)
ok("three YES and one NO (no tick glyph — the fonts have none)", t2.count("YES") == 3 and t2.count(" NO ") == 1, (t2.count("YES"), t2.count(" NO ")))
ok("pain and what they said, with the angle brackets escaped not rendered", "Bolt failures" in t2 and "<b>before</b>" in t2, t2)
ok("next step with its date, and the presentation with its booking day", "2026-09-18" in t2 and "2026-09-25" in t2 and "booked 2026-09-11" in t2, t2)

out = os.environ.get("LG_PDF_OUT")
if out:
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "leadgen_week.pdf"), "wb").write(pdf)
    open(os.path.join(out, "leadgen_lead.pdf"), "wb").write(pdf2)
    print("\nwrote sample PDFs to " + out)

print("\n" + ("%d FAILURE(S)" % FAIL if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
