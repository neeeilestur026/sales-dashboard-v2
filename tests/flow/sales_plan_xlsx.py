"""A403 — the Sales plan's Download Excel: Flask's /flow/sales-plan-xlsx and pdf_generators/sales_plan_xlsx.py.

Run:  ./venv/bin/python tests/flow/sales_plan_xlsx.py

Neil, 23 Nov 2026: his "Individual Sales Strategy Workbook" filled in from the portal. Pinned here, against a stand-in for
Code.gs (sessions) and FlowAPI (getSalesPlan, getSalesActivity):

  1. only sales, the director and management; FlowAPI is asked as the signed-in person (a rep's `user` is dropped)
  2. the same nine sheets and columns as Neil's file, with live formulas and the same dropdowns
  3. a rep's copy carries no cost; the director's does
  4. a sale on an account is written under the account's name (the account sheet totals it by name)
  5. more than 50 accounts, sales or quotations: the tables grow, the formulas follow
  6. the activity is read for at most 92 days of the plan year; a future year reads none
"""
import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("FLASK_SECRET_KEY", "test")

from flask import Flask                                            # noqa: E402
from openpyxl import load_workbook                                 # noqa: E402

import blueprints.session_auth as sa                               # noqa: E402
import blueprints.flow as fl                                       # noqa: E402
from pdf_generators.sales_plan_xlsx import build_sales_plan_xlsx   # noqa: E402

FAIL = 0
N = 0


def ok(label, cond, extra=None):
    global FAIL, N
    N += 1
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n     " + repr(extra)[:400]))


ROLES = {"t-rep": "sales", "t-dir": "director", "t-mgmt": "management", "t-hr": "hr"}


def fake_gs_post(payload, timeout=30):
    role = ROLES.get(payload.get("token"))
    if payload.get("action") == "validateSession" and role:
        return {"success": True, "valid": True, "username": role + "-user", "role": role}
    return {"success": True, "valid": False}


def plan_reply(cost, accounts=None, sales=None, quotes=None):
    acc = accounts if accounts is not None else [
        {"clientNo": "CB-1", "company": "Therma South, Inc.", "sector": "Power", "tier": "A", "target": 1000000, "actual": 0, "status": "Prospect",
         "contact": {"name": "Joe Cruz", "position": "Purchasing", "phone": "0917 000 1111"}, "lastVisit": "2026-11-03", "nextVisit": "", "focus": "", "focusHints": ["Torque wrench"]},
        {"clientNo": "CB-2", "company": "Philex Mining", "sector": "Mining", "tier": "B", "target": 600000, "actual": 200000, "status": "Active",
         "contact": None, "lastVisit": "", "nextVisit": "2026-11-27", "focus": "Spare parts", "focusHints": []}]
    sl = sales if sales is not None else [
        {"soNo": "SO-2", "date": "2026-06-01", "customer": "Philex Mining Corp.", "clientNo": "CB-2", "via": "quotation", "shared": False, "poNo": "PO-77",
         "invNos": ["INV-1"], "products": "Seal kit; Pump cartridge", "amount": 200000, "quotationNo": "Q-5", "payment": "Overdue", "outstanding": 124000}]
    if cost:
        for s in sl:
            s.setdefault("cost", 130000)
            s.setdefault("gp", 70000)
    return {"success": True, "today": "2026-11-23", "year": 2026, "user": "Gerald Lucena",
            "plan": {"annual": 25000000, "months": [8.33] * 11 + [8.37], "set": False, "tierTargets": {"A": 1000000, "B": 600000, "C": 240000}},
            "accounts": acc, "sales": sl,
            "pipeline": [{"source": "quotation", "recordNo": "Q-1", "company": "Therma South, Inc.", "project": "Hydraulic torque wrench", "category": "", "value": 90000,
                          "stage": "Negotiation", "probability": 70, "weighted": 63000, "expectedClose": "2026-12-05", "decisionMaker": "Joe Cruz",
                          "nextAction": "Meet the plant manager", "nextActionDate": "2026-11-26"},
                         {"source": "quotation", "recordNo": "Q-5", "company": "Philex Mining Corp.", "project": "Spare parts", "value": 200000, "stage": "Closed Won",
                          "probability": 100, "weighted": 200000, "closedAt": "2026-06-01"}],
            "quotes": quotes if quotes is not None else [
                {"quotationNo": "Q-1", "date": "2026-11-10", "customer": "Therma South, Inc.", "subject": "Hydraulic torque wrench", "value": 90000, "state": "Submitted",
                 "lastFollowUp": "", "decidedAt": "", "reason": "", "soNo": ""},
                {"quotationNo": "Q-5", "date": "2026-05-20", "customer": "Philex Mining Corp.", "subject": "Spare parts", "value": 200000, "state": "Won",
                 "decidedAt": "2026-06-01", "soNo": "SO-2"}],
            "months": [], "may": {"cost": cost, "target": cost, "oversight": cost}, "lists": {}}


ACT = {"success": True, "from": "2026-08-24", "to": "2026-11-23", "rows": [
    {"date": "2026-11-18", "type": "Customer visit", "company": "Philex Mining", "person": "Engr. Dela Cruz", "purpose": "Plant walk", "outcome": "RFQ promised",
     "nextAction": "Send RFQ form", "nextDate": "2026-11-20", "value": None, "source": "Daily report"},
    {"date": "2026-11-18", "type": "Site survey", "company": "Aboitiz SNAPB", "purpose": "Measured the flanges", "outcome": "Done", "source": "Daily report"}]}

forwarded = []
NEXT = {"plan": None}


class _Resp:
    def __init__(self, text):
        self.text = text


def fake_gs_call(url, json=None, timeout=60):                       # noqa: A002 — the real signature
    forwarded.append(dict(json))
    if json.get("action") == "getSalesPlan":
        r = NEXT["plan"] if NEXT["plan"] is not None else plan_reply(json.get("actorRole") in ("director", "management"))
        return _Resp(__import__("json").dumps(r))
    if json.get("action") == "getSalesActivity":
        return _Resp(__import__("json").dumps(ACT))
    return _Resp('{"success": false, "message": "unexpected"}')


sa.gs_post = fake_gs_post
sa.DASHBOARD_APPS_SCRIPT_URL = "https://example.invalid/codegs"
fl.gs_call = fake_gs_call
fl.FLOW_APPS_SCRIPT_URL = "https://example.invalid/flowapi"
fl.INTERNAL_SHARED_SECRET = "test-secret"

app = Flask(__name__)
app.register_blueprint(fl.flow_bp)
client = app.test_client()


def download(token, body):
    forwarded.clear()
    r = client.post("/flow/sales-plan-xlsx", headers={"X-Session-Token": token} if token else {}, json=body)
    return r, list(forwarded)


TEMPLATE_SHEETS = ["Start Here", "KPI Dashboard", "50 Customer Accounts", "Monthly Targets", "Sales Log", "Sales Pipeline", "Daily Activity", "Quotation Tracker", "Action Tracker"]

print("\n1 · who may download, and as whom FlowAPI is asked")
r, fwd = download("", {"year": 2026})
ok("no session → 401, nothing asked", r.status_code == 401 and not fwd, r.status_code)
r, fwd = download("t-hr", {"year": 2026})
ok("HR → 403, nothing asked", r.status_code == 403 and not fwd, r.status_code)
r, fwd = download("t-rep", {"year": 2026, "user": "Kimberlyn Blones"})
plan_call = [f for f in fwd if f["action"] == "getSalesPlan"]
ok("a rep gets a workbook", r.status_code == 200 and "spreadsheetml" in r.headers.get("Content-Type", ""), (r.status_code, r.get_data()[:200]))
ok("  FlowAPI is asked as the rep (role from the session), and the rep's `user` is dropped",
   plan_call and plan_call[0]["actorRole"] == "sales" and "user" not in plan_call[0] and plan_call[0]["flowSecret"] == "test-secret", plan_call)
ok("  the file is named for the year and the rep", "Sales_plan_2026_-_Gerald_Lucena.xlsx" in r.headers.get("Content-Disposition", "") and r.headers.get("Content-Disposition", "").startswith("attachment"), r.headers.get("Content-Disposition"))
act_call = [f for f in fwd if f["action"] == "getSalesActivity"]
ok("  the activity: at most 92 days, inside the plan year", act_call and act_call[0]["from"] >= "2026-01-01" and act_call[0]["from"] <= act_call[0]["to"], act_call)
rep_wb = load_workbook(io.BytesIO(r.get_data()))
r, fwd = download("t-dir", {"year": 2026, "user": "Gerald Lucena"})
dir_call = [f for f in fwd if f["action"] == "getSalesPlan"]
ok("the director names the rep", r.status_code == 200 and dir_call and dir_call[0].get("user") == "Gerald Lucena" and dir_call[0]["actorRole"] == "director")
dir_wb = load_workbook(io.BytesIO(r.get_data()))
r, fwd = download("t-mgmt", {"year": 2027})
ok("a future year reads no activity", r.status_code == 200 and not [f for f in fwd if f["action"] == "getSalesActivity"], [f["action"] for f in fwd])
NEXT["plan"] = {"success": False, "message": "The sales plan is switched off (FlowSettings salesPlan)."}
r, fwd = download("t-dir", {"year": 2026})
ok("FlowAPI's refusal comes back as the message", r.status_code == 400 and "switched off" in (r.get_json() or {}).get("message", ""), r.get_json())
NEXT["plan"] = None

print("\n2 · the same nine sheets, columns and formulas as Neil's file")
ok("nine sheets in his order", rep_wb.sheetnames == TEMPLATE_SHEETS, rep_wb.sheetnames)
hdr = lambda wb, sh, n: [c.value for c in wb[sh][4][:n]]
ok("50 Customer Accounts: his 13 columns", hdr(rep_wb, "50 Customer Accounts", 13) == ["Account ID", "Customer Name", "Industry / Sector", "Account Tier", "Annual Sales Target",
   "Actual Sales YTD", "Remaining Target", "Achievement %", "Primary Contact", "Last Visit", "Next Visit", "Products / Opportunity Focus", "Account Status"])
ok("Sales Log: his columns, dated by the order", hdr(rep_wb, "Sales Log", 10) == ["Order Date", "Customer Name", "Invoice / PO No.", "Product / Service", "Sales Amount",
   "Cost of Sales", "Gross Profit", "Gross Margin %", "Payment Status", "Notes"])
ok("Sales Pipeline: his 12 columns", hdr(rep_wb, "Sales Pipeline", 12) == ["Opportunity ID", "Customer Name", "Opportunity / Project", "Product Category", "Opportunity Value",
   "Stage", "Probability %", "Weighted Value", "Expected Close Date", "Decision Maker", "Next Action", "Next Action Date"])
ok("Daily Activity: his 10 columns", hdr(rep_wb, "Daily Activity", 10) == ["Date", "Sales Executive", "Customer Name", "Activity Type", "Purpose / Customer Need", "Outcome",
   "Next Action", "Next Action Date", "Opportunity Value", "Notes"])
ok("Monthly Targets: his 6 columns and a total", hdr(rep_wb, "Monthly Targets", 6) == ["Month", "Target Allocation %", "Sales Target", "Actual Sales", "Variance", "Achievement %"]
   and rep_wb["Monthly Targets"]["A17"].value == "TOTAL")
ac, sl, kd, mt, pp = (dir_wb[s] for s in ("50 Customer Accounts", "Sales Log", "KPI Dashboard", "Monthly Targets", "Sales Pipeline"))
ok("the accounts total the Sales Log by name", ac["F5"].value == "=SUMIF('Sales Log'!$B$5:$B$504,B5,'Sales Log'!$E$5:$E$504)", ac["F5"].value)
ok("the months total the Sales Log by date in the plan year", "DATE(2026,1,1)" in mt["D5"].value and "DATE(2026,2,1)" in mt["D5"].value and mt["C5"].value == "=B5*'KPI Dashboard'!$B$5")
ok("the dashboard's year so far, weighted pipeline and win rate are formulas", kd["B7"].value.startswith("=SUM('Sales Log'!E5:E") and "Closed Won" in kd["B10"].value
   and "COUNTIF('Quotation Tracker'!F5:F" in kd["B18"].value)
ok("weighted value = value × probability", pp["H5"].value == '=IF(OR(E5="",G5=""),"",E5*G5)' and pp["G5"].value == 0.7 and pp["F5"].value == "Negotiation")
ok("the target is the plan's, editable", kd["B4"].value == 25000000 and kd["B5"].value == "=B4")
dvs = {str(dv.sqref): dv.formula1 for dv in ac.data_validations.dataValidation}
ok("the dropdowns: tier and status", dvs.get("D5:D54") == '"A,B,C"' and dvs.get("M5:M54") == '"Active,Prospect,Dormant,On Hold"', dvs)
ok("the stage dropdown is his", any(dv.formula1 == '"Lead,Qualified,Technical Review,Quotation,Negotiation,Closed Won,Closed Lost"' for dv in pp.data_validations.dataValidation))
ok("tables like his (CustomerAccounts, SalesLog, SalesPipeline, DailyActivity, QuotationTracker, ActionTracker)",
   sorted(t for ws in dir_wb.worksheets for t in ws.tables.keys()) == sorted(["CustomerAccounts", "SalesLog", "SalesPipeline", "DailyActivity", "QuotationTracker", "ActionTracker"]))
ok("the activity is filled with the workbook's types", rep_wb["Daily Activity"]["D5"].value == "Customer Visit" and rep_wb["Daily Activity"]["D6"].value == "Site Survey"
   and rep_wb["Daily Activity"]["G5"].value == "Send RFQ form" and rep_wb["Daily Activity"]["B5"].value == "Gerald Lucena")
ok("the quotation in negotiation says so on the tracker", rep_wb["Quotation Tracker"]["F5"].value == "Negotiation" and rep_wb["Quotation Tracker"]["F6"].value == "Won")
ok("Excel recalculates on open", dir_wb.calculation.fullCalcOnLoad is True)

print("\n3 · cost: the director's copy only")
ok("a rep's copy: no cost, and the dashboard says so", rep_wb["Sales Log"]["F5"].value is None and rep_wb["KPI Dashboard"]["B13"].value == "Not shown")
ok("the director's copy: the cost and the gross profit formula", sl["F5"].value == 130000 and sl["G5"].value == '=IF(OR(E5="",F5=""),"",E5-F5)' and kd["B13"].value.startswith("=SUM('Sales Log'!G5:G"))

print("\n4 · a sale on an account carries the account's name")
ok("Philex Mining Corp.'s order is written as the account Philex Mining", sl["B5"].value == "Philex Mining" and "Order to Philex Mining Corp." in sl["J5"].value, (sl["B5"].value, sl["J5"].value))
ok("  with its order, PO and invoice numbers", sl["C5"].value == "SO SO-2 · PO PO-77 · INV INV-1", sl["C5"].value)

print("\n5 · longer lists: the tables grow, the formulas follow")
many = [{"clientNo": "CB-%d" % i, "company": "Client %d" % i, "tier": "C", "target": 240000, "actual": 0, "status": "Prospect", "focusHints": []} for i in range(74)]
lots = [{"soNo": "S%d" % i, "date": "2026-03-01", "customer": "Client 1", "clientNo": "CB-1", "amount": 10, "invNos": [], "payment": "Unpaid"} for i in range(520)]
wb = load_workbook(io.BytesIO(build_sales_plan_xlsx(plan_reply(False, accounts=many, sales=lots), ACT)))
ok("74 accounts: the table runs to row 78", wb["50 Customer Accounts"].tables["CustomerAccounts"].ref == "A4:M78" and wb["50 Customer Accounts"]["B78"].value == "Client 73")
ok("520 sales: the Sales Log runs to row 524 and every total reads to it", wb["Sales Log"].tables["SalesLog"].ref == "A4:J524"
   and "$B$5:$B$524" in wb["50 Customer Accounts"]["F5"].value and "E5:E524" in wb["KPI Dashboard"]["B7"].value and "$E$5:$E$524" in wb["Monthly Targets"]["D5"].value)
ok("a short list keeps his blank rows to type into (50 accounts, 500 sales)", rep_wb["50 Customer Accounts"].tables["CustomerAccounts"].ref == "A4:M54"
   and rep_wb["Sales Log"].tables["SalesLog"].ref == "A4:J504")

print("\n6 · wired")
root = os.path.join(os.path.dirname(__file__), "..", "..")
js = open(os.path.join(root, "dashboard", "js", "sales-plan.js"), encoding="utf-8").read()
ok("the page posts to the route with the session header", "fetch('/flow/sales-plan-xlsx'" in js and "hxAuthHeaders(" in js)
ok("the route carries require_session", getattr(fl.sales_plan_xlsx, "_requires_session", False) is True)

print("\n%d checks, %s" % (N, "%d FAILED" % FAIL if FAIL else "all ok"))
sys.exit(1 if FAIL else 0)
