#!/usr/bin/env python3
"""A269 — data clean-up workbook: quotation -> sales order -> PO -> payment request -> shipment.

Read-only. Issues GET reads only; nothing is ever written to the live book.

    ./venv/bin/python tools_process_cleanup.py [output.xlsx]

One sheet per process, every recorded row on it, with what the rest of the chain says about that
row beside it. GREY columns are computed; YELLOW are the ones to fill. Send the file back and the
ACTION column drives what gets applied.
"""
import collections
import datetime as dt
import json
import os
import sys
import urllib.request

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as G
from openpyxl.worksheet.datavalidation import DataValidation

FLOW = ("https://script.google.com/macros/s/"
        "AKfycbyOnYzt0M7HePi4VTEHINDaMxNi_ppvjGUyT4cSaExG-oPtjUYWZ6mcjxx9uVNgyyXY/exec")

K = lambda v: str(v or "").strip()
N = lambda v: float(v or 0)
TODAY = dt.date.today()


def fetch(action):
    with urllib.request.urlopen(f"{FLOW}?action={action}", timeout=300) as r:
        return json.load(r)


def load(cache=None):
    names = ["getQuotations", "getSalesOrders", "getPurchaseOrders", "getPaymentRequests",
             "getAPAging", "getShipments", "getReceiving", "getInvoices", "getARAging",
             "getCollections", "getSOCostDetails"]
    d = {}
    for a in names:
        if cache and os.path.exists(f"{cache}/{a}.json"):
            res = json.load(open(f"{cache}/{a}.json"))
        else:
            res = fetch(a)
        if not res.get("success"):
            raise SystemExit(f"{a} failed: {res.get('message')}")
        d[a] = res.get("data") or []
        print(f"  {a:22} {len(d[a]):>4}")
    return d


def DS(v):
    s = K(v)
    if not s:
        return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%d")
    return s[:10]


def age_days(v):
    s = DS(v)
    try:
        return (TODAY - dt.date(*map(int, s.split("-")))).days
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────── styling
FONT = "Calibri"
BASE = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
MUTED = Font(name=FONT, size=9, color="666666", italic=True)
TITLE = Font(name=FONT, size=14, bold=True, color="1F3864")
HDRF = Font(name=FONT, size=9, bold=True, color="FFFFFF")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MONEY = '#,##0.00;[Red]-#,##0.00'
YEL = PatternFill("solid", fgColor="FFF2CC")
GREY = PatternFill("solid", fgColor="F2F2F2")
BAND = PatternFill("solid", fgColor="FAFAFA")
FLAG = PatternFill("solid", fgColor="FCE4D6")


def banner(ws, title, sub, width):
    ws.cell(1, 1, title).font = TITLE
    c = ws.cell(2, 1, sub); c.font = MUTED
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=min(width, 10))
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=min(width, 14))
    ws.row_dimensions[2].height = 32


def header(ws, row, cols, colour):
    for i, (lab, w, kind) in enumerate(cols, 1):
        c = ws.cell(row, i, lab)
        c.font = HDRF
        c.fill = PatternFill("solid", fgColor=("7F6000" if kind == "f" else colour))
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[G(i)].width = w
    ws.row_dimensions[row].height = 34


def put(ws, r, i, val, kind, band=False, flag=False):
    c = ws.cell(r, i)
    if kind == "n":
        c.value = round(N(val), 2) if val not in (None, "") else None
        c.number_format = MONEY
        c.alignment = Alignment(horizontal="right")
    elif kind == "i":
        c.value = val if val not in (None, "") else None
        c.alignment = Alignment(horizontal="center")
    else:
        c.value = val if val != "" else None
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=(kind == "t"))
    c.font = BASE
    c.border = BOX
    c.fill = YEL if kind == "f" else (FLAG if flag else (BAND if band else GREY))
    return c


def sheet(wb, name, title, sub, cols, rows, colour, dv_map=None):
    ws = wb.create_sheet(name)
    banner(ws, title, sub, len(cols))
    header(ws, 4, cols, colour)
    for n, (vals, flags) in enumerate(rows):
        r = 5 + n
        for i, ((lab, w, kind), v) in enumerate(zip(cols, vals), 1):
            put(ws, r, i, v, kind, band=(n % 2 == 1), flag=(lab in flags))
    last = 4 + len(rows)
    ws.freeze_panes = "B5"
    if rows:
        ws.auto_filter.ref = f"A4:{G(len(cols))}{last}"
        for col_label, formula in (dv_map or {}).items():
            idx = [c[0] for c in cols].index(col_label) + 1
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            ws.add_data_validation(dv)
            dv.add(f"{G(idx)}5:{G(idx)}{last}")
    return ws


# ───────────────────────────────────────────────────────────────────── analysis
def index(d):
    """Everything each sheet needs to say what the REST of the chain thinks of a row."""
    ix = {}
    ix["so"] = {K(s.get("soNo")): s for s in d["getSalesOrders"]}
    ix["mr"] = collections.defaultdict(list)
    ix["mrPo"] = collections.defaultdict(list)
    for r in d["getReceiving"]:
        if K(r.get("soNo")): ix["mr"][K(r.get("soNo"))].append(r)
        if K(r.get("poNo")): ix["mrPo"][K(r.get("poNo"))].append(r)
    ix["inv"] = collections.defaultdict(list)
    for i in d["getInvoices"]:
        if not i.get("voided"): ix["inv"][K(i.get("soNo"))].append(i)
    ix["ar"] = collections.defaultdict(list)
    for a in d["getARAging"]: ix["ar"][K(a.get("soNo"))].append(a)
    ix["col"] = collections.defaultdict(list)
    for c in d["getCollections"]: ix["col"][K(c.get("soNo"))].append(c)
    ix["cd"] = {K(c.get("soNo")) for c in d["getSOCostDetails"]}
    ix["ap"] = {K(a.get("poNo")): a for a in d["getAPAging"]}
    ix["payByPo"] = collections.defaultdict(list)
    for p in d["getPaymentRequests"]:
        if K(p.get("poNo")): ix["payByPo"][K(p.get("poNo"))].append(p)
    ix["soByQuote"] = {}
    for s in d["getSalesOrders"]:
        if K(s.get("quotationNo")): ix["soByQuote"][K(s.get("quotationNo"))] = K(s.get("soNo"))
    return ix


def chain_state(soNo, ix):
    """The one derivation used everywhere: where an order actually is."""
    ars = ix["ar"].get(soNo, [])
    if ars:
        out = sum(N(a.get("outstanding")) for a in ars)
        if out <= 0.01 and ix["col"].get(soNo):
            return "Collected", 0.0
        return "Awaiting payment", out
    if ix["inv"].get(soNo):
        return "Invoiced", 0.0
    if ix["mr"].get(soNo):
        return "Received, not invoiced", 0.0
    return "Nothing yet", 0.0


def quote_dupes(quotes):
    """Same customer AND same total is the signal that actually finds them here; exact duplicate
       quotation NUMBERS do not exist in this book (checked)."""
    g = collections.defaultdict(list)
    for q in quotes:
        g[(K(q.get("customer")), round(N(q.get("total")), 2))].append(q)
    tag, gid = {}, 0
    for (cust, tot), v in g.items():
        if len(v) > 1 and tot > 0:
            gid += 1
            for q in v:
                tag[K(q.get("quotationNo"))] = f"GROUP {gid} ({len(v)} quotations, same customer + same total)"
    return tag


# ─────────────────────────────────────────────────────────────────────── sheets
QUOTE_ACTIONS = '"Keep,Close - won,Close - lost,Close - not pursued,Delete (duplicate),Not sure"'
SO_ACTIONS    = '"Looks right,Wrong - see notes,Not sure"'
PO_ACTIONS    = '"Keep,Mark received,Approve it,Delete (duplicate),Delete (demo/test),Not sure"'
PAY_ACTIONS   = '"Keep,Mark paid,Close - done,Delete (duplicate),Not sure"'
SHP_ACTIONS   = '"Keep,Set the status I typed,Delete (test data),Not sure"'
SHP_STATUS    = '"Pending,Booked,In Transit,Arrived,Delivered,Cancelled"'


def sheet_quotations(wb, d, ix):
    cols = [("Created By", 18, "t"), ("Quotation No", 34, "t"), ("Date", 11, "d"),
            ("Customer", 28, "t"), ("Subject", 30, "t"), ("Total", 14, "n"),
            ("Status", 15, "t"), ("Sent At", 11, "d"), ("Age (days)", 10, "i"),
            ("PR No", 16, "t"), ("Became SO", 20, "t"), ("Possible duplicate", 40, "t"),
            ("ACTION", 22, "f"), ("NOTES", 30, "f")]
    dupes = quote_dupes(d["getQuotations"])
    rows = []
    for q in sorted(d["getQuotations"],
                    key=lambda x: (K(x.get("createdBy")), DS(x.get("date"))), reverse=False):
        no = K(q.get("quotationNo"))
        dup = dupes.get(no, "")
        rows.append(([K(q.get("createdBy")), no, DS(q.get("date")), K(q.get("customer")),
                      K(q.get("subject")), N(q.get("total")), K(q.get("status")),
                      DS(q.get("sentAt")), age_days(q.get("date")), K(q.get("prNo")),
                      ix["soByQuote"].get(no, ""), dup, "", ""],
                     {"Possible duplicate"} if dup else set()))
    return sheet(wb, "Quotations", "Every quotation, by who raised it",
                 f"{len(rows)} quotations. Duplicates are pre-flagged in orange — same customer AND "
                 "same total. Fill ACTION on the ones to close or remove; leave the rest blank and "
                 "they stay as they are.",
                 cols, rows, "1F3864", {"ACTION": QUOTE_ACTIONS})


def sheet_sales_orders(wb, d, ix):
    cols = [("SO No", 22, "t"), ("Date", 11, "d"), ("Customer", 28, "t"), ("Total", 14, "n"),
            ("Status", 11, "t"), ("Where it really is", 20, "t"), ("Still owed", 13, "n"),
            ("Label", 13, "t"), ("Cost record", 11, "t"), ("PO", 20, "t"),
            ("Receiving", 11, "t"), ("Invoice date", 12, "d"), ("Collection date", 13, "d"),
            ("ACTION", 20, "f"), ("NOTES", 30, "f")]
    poBySo = collections.defaultdict(list)
    for p in d["getPurchaseOrders"]:
        if K(p.get("soNo")): poBySo[K(p.get("soNo"))].append(K(p.get("poNo")))
    rows = []
    for s in sorted(d["getSalesOrders"], key=lambda x: DS(x.get("date")), reverse=True):
        k = K(s.get("soNo"))
        state, owed = chain_state(k, ix)
        ivs, cols_ = ix["inv"].get(k, []), ix["col"].get(k, [])
        rows.append(([k, DS(s.get("date")), K(s.get("customer")), N(s.get("total")),
                      K(s.get("status")), state, owed, K(s.get("supplierType")) or "— none —",
                      "yes" if k in ix["cd"] else "MISSING",
                      "; ".join(poBySo.get(k, [])), "yes" if ix["mr"].get(k) else "no",
                      DS(ivs[0].get("date")) if ivs else "",
                      DS(cols_[0].get("date")) if cols_ else "", "", ""],
                     ({"Label"} if not K(s.get("supplierType")) else set())
                     | ({"Cost record"} if k not in ix["cd"] else set())))
    return sheet(wb, "Sales Orders", "Every sales order — check only",
                 f"{len(rows)} orders. You said to leave these alone and just check them, so there "
                 "is nothing to fill unless something looks wrong. 'Where it really is' is derived "
                 "from invoices, AR and collections — not from the Status column.",
                 cols, rows, "375623", {"ACTION": SO_ACTIONS})


def sheet_purchase_orders(wb, d, ix):
    cols = [("PO No", 26, "t"), ("Date", 11, "d"), ("Supplier", 28, "t"), ("SO No", 20, "t"),
            ("Cur", 6, "t"), ("PO Total PHP", 14, "n"), ("Status", 11, "t"),
            ("Goods received?", 14, "t"), ("Receiving ref", 18, "t"),
            ("AP amount", 13, "n"), ("AP paid", 13, "n"), ("Payment request", 22, "t"),
            ("ACTION", 22, "f"), ("NOTES", 30, "f")]
    rows = []
    for p in sorted(d["getPurchaseOrders"], key=lambda x: DS(x.get("date"))):
        k, s_ = K(p.get("poNo")), K(p.get("soNo"))
        mrs = ix["mrPo"].get(k) or ix["mr"].get(s_, [])
        got = "YES" if mrs else "no"
        a = ix["ap"].get(k)
        pays = ix["payByPo"].get(k, [])
        flags = set()
        if got == "YES" and K(p.get("status")) != "Approved":
            flags.add("Status")           # received but never approved
        if got == "no":
            flags.add("Goods received?")
        rows.append(([k, DS(p.get("date")), K(p.get("supplier")), s_, K(p.get("currency")),
                      N(p.get("totalPHP")) or N(p.get("total")), K(p.get("status")), got,
                      "; ".join(K(m.get("mrNo")) for m in mrs[:3]),
                      N(a.get("amountPHP")) if a else 0, N(a.get("paidPHP")) if a else 0,
                      "; ".join(f"{K(x.get('prNo'))} ({K(x.get('status'))})" for x in pays),
                      "", ""], flags))
    return sheet(wb, "Purchase Orders", "Every purchase order, against what was actually received",
                 f"{len(rows)} purchase orders. 'Goods received?' is joined from the receiving "
                 "records, by PO number or by sales order — so it says what really happened, not "
                 "what the Status column claims. Orange = worth a look.",
                 cols, rows, "833C00", {"ACTION": PO_ACTIONS})


def sheet_payment_requests(wb, d, ix):
    cols = [("PR No", 24, "t"), ("Date", 11, "d"), ("Type", 8, "t"), ("PO No", 24, "t"),
            ("SO No", 20, "t"), ("Payee", 26, "t"), ("Cur", 6, "t"), ("Amount", 14, "n"),
            ("Amount PHP", 14, "n"), ("Status", 18, "t"), ("Paid At", 11, "d"),
            ("Paid By", 16, "t"), ("Approvals so far", 30, "t"),
            ("ACTION", 20, "f"), ("NOTES", 30, "f")]
    rows = []
    for p in sorted(d["getPaymentRequests"], key=lambda x: DS(x.get("createdAt"))):
        st = K(p.get("status"))
        appr = [n for n, v in (("Admin", p.get("adminApprovedBy")), ("Acct", p.get("acctApprovedBy")),
                               ("Dir", p.get("dirApprovedBy")), ("Mgmt", p.get("mgmtApprovedBy")))
                if K(v)]
        flags = set()
        if st == "Approved" and not K(p.get("paidAt")):
            flags.add("Status")          # signed off but the money never went out
        rows.append(([K(p.get("prNo")), DS(p.get("createdAt")), K(p.get("type")), K(p.get("poNo")),
                      K(p.get("soNo")), K(p.get("payee")), K(p.get("currency")), N(p.get("amount")),
                      N(p.get("amountPHPEst")) or N(p.get("actualDebitedPHP")), st,
                      DS(p.get("paidAt")), K(p.get("paidBy")), " → ".join(appr) or "— none —",
                      "", ""], flags))
    return sheet(wb, "Payment Requests", "Every payment request and how far it got",
                 f"{len(rows)} requests. Orange = approved but with no payment date recorded, so the "
                 "money may have gone out without being logged — or the request is genuinely still "
                 "waiting.",
                 cols, rows, "7B3F00", {"ACTION": PAY_ACTIONS})


def sheet_shipments(wb, d, ix):
    cols = [("Shipment ID", 16, "t"), ("SO No", 20, "t"), ("SO exists?", 10, "t"),
            ("Customer", 26, "t"), ("Status now", 12, "t"), ("What the chain says", 22, "t"),
            ("Mode", 7, "t"), ("Supplier kind", 12, "t"), ("SO label", 13, "t"),
            ("Labels agree?", 12, "t"), ("ETD", 11, "d"), ("ETA", 11, "d"), ("AWB", 16, "t"),
            ("Receiving?", 11, "t"), ("Duties", 12, "n"), ("VAT", 10, "n"),
            ("Shipping", 12, "n"), ("Delivery", 11, "n"),
            ("Intl records complete?", 22, "t"), ("Invoiced?", 10, "t"), ("Collected?", 11, "t"),
            ("TRUE STATUS", 16, "f"), ("ACTION", 22, "f"), ("NOTES", 30, "f")]
    rows = []
    for x in sorted(d["getShipments"], key=lambda y: K(y.get("shipmentId"))):
        s_ = K(x.get("soNo"))
        so = ix["so"].get(s_)
        exists = "yes" if so else "NO"
        state, _ = chain_state(s_, ix)
        kind = K(x.get("supplierKind"))
        label = K(so.get("supplierType")) if so else ""
        # 'intl' on the shipment vs 'International' on the order are the SAME thing — comparing the
        # raw strings marked all 7 international shipments as disagreeing when none of them do.
        canon = lambda v: ("INTL" if K(v).lower()[:4] in ("intl", "inte") else
                           ("LOCAL" if K(v).lower().startswith("loc") else ""))
        agree = "—" if (not so or not canon(kind) or not canon(label)) else \
                ("yes" if canon(kind) == canon(label) else "NO")
        mrs = ix["mr"].get(s_, [])
        duties = sum(N(r.get("duties")) for r in mrs)
        vat = sum(N(r.get("vat")) for r in mrs)
        ship = sum(N(r.get("totalShipping")) for r in mrs)
        deliv = sum(N(r.get("delivery")) for r in mrs)
        if canon(kind) == "INTL":
            missing = [n for n, v in (("duties", duties), ("VAT", vat), ("shipping", ship)) if v <= 0]
            complete = "complete" if not missing else "missing " + ", ".join(missing)
        elif canon(kind) == "LOCAL":
            complete = "n/a — local"
        else:
            complete = "— no supplier kind set —"
        st = K(x.get("status"))
        moved = state in ("Collected", "Awaiting payment", "Invoiced")
        flags = set()
        if exists == "NO": flags |= {"SO exists?", "Shipment ID"}
        if st == "Pending" and moved: flags.add("Status now")
        if agree == "NO": flags.add("Labels agree?")
        if canon(kind) == "INTL" and complete != "complete": flags.add("Intl records complete?")
        if not canon(kind): flags.add("Supplier kind")
        rows.append(([K(x.get("shipmentId")), s_, exists, K(x.get("customer")), st, state,
                      K(x.get("mode")), kind or "— none —", label or "— none —", agree,
                      DS(x.get("etd")), DS(x.get("eta")), K(x.get("awb")),
                      "yes" if mrs else "no", duties, vat, ship, deliv, complete,
                      "yes" if ix["inv"].get(s_) else "no",
                      "yes" if ix["col"].get(s_) else "no", "", "", ""], flags))
    ws = sheet(wb, "Shipments", "Every shipment, against the whole chain behind it",
               f"{len(rows)} shipments — the sheet you said matters most. 'What the chain says' is "
               "derived from receiving, invoices, AR and collections. Orange marks a row worth "
               "acting on: a status that has fallen behind, a sales order that does not exist, or "
               "an international shipment with no duties or VAT recorded.",
               cols, rows, "953735", {"ACTION": SHP_ACTIONS, "TRUE STATUS": SHP_STATUS})
    return ws


def sheet_start(wb, d, ix, stats):
    ws = wb.create_sheet("START HERE", 0)
    banner(ws, "Data clean-up — what to fill and what I can actually apply",
           "One sheet per process. GREY is computed from the live book — typing there changes "
           "nothing. YELLOW is yours. Leave a row blank and it stays exactly as it is.", 3)
    for i, w in enumerate([34, 10, 96], 1):
        ws.column_dimensions[G(i)].width = w
    r = 4
    def row(a, b, c, head=False, fill=None):
        nonlocal r
        for i, v in enumerate([a, b, c], 1):
            cell = ws.cell(r, i, v if v != "" else None)
            cell.font = BOLD if head else BASE
            cell.border = BOX if v != "" else None
            cell.alignment = Alignment(wrap_text=True, vertical="top",
                                       horizontal="center" if i == 2 else "left")
            if head: cell.fill = PatternFill("solid", fgColor="D9E1F2")
            elif fill: cell.fill = fill
        ws.row_dimensions[r].height = 42 if not head else 18
        r += 1
    row("SHEET", "ROWS", "WHAT TO DO", head=True)
    row("Quotations", stats["q"], "Every quotation grouped by who raised it. 4 duplicate groups are "
        "pre-flagged in orange (same customer, same total). Mark what to close or delete.")
    row("Sales Orders", stats["so"], "CHECK ONLY — you said to leave these. 'Where it really is' is "
        "derived from the money records, so it tells you the truth even where Status does not.")
    row("Purchase Orders", stats["po"], "'Goods received?' is joined from the receiving records. "
        f"{stats['po_recv']} of {stats['po']} are already received; {stats['po_draft_recv']} is still Draft despite that.")
    row("Payment Requests", stats["pay"], f"{stats['pay_paid']} paid, {stats['pay_appr']} approved with no "
        "payment date, the rest still in approval.")
    row("Shipments", stats["shp"], f"THE IMPORTANT ONE. {stats['shp_stale']} say Pending while the goods are "
        f"received and invoiced. {stats['shp_ghost']} point at a sales order that does not exist. "
        "Type the TRUE STATUS and I will set it.")
    r += 1
    ws.cell(r, 1, "What I can apply when you send this back").font = Font(name=FONT, size=11, bold=True, color="1F3864")
    r += 1
    row("ACTION", "", "WHAT HAPPENS", head=True)
    row("Shipment status", "", "I can set it directly — updateShipment is open to me. No waiting.",
        fill=PatternFill("solid", fgColor="E2EFDA"))
    row("Sales order fields", "", "I can set these directly (label, dates, totals).",
        fill=PatternFill("solid", fgColor="E2EFDA"))
    row("Purchase order fields", "", "I can set these directly.",
        fill=PatternFill("solid", fgColor="E2EFDA"))
    row("Delete a shipment", "", "NO delete function exists anywhere in the system — not even in the "
        "app. I will build one, guarded so it only ever removes a shipment whose sales order does "
        "not exist. Needs one paste from you.", fill=YEL)
    row("Close or delete a quotation", "", "Blocked today: deleteQuotation is secured, and "
        "updateQuotation refuses to set a status on purpose (so a draft cannot be pushed through "
        "approval). I will build a narrow close/delete action. Needs the same paste.", fill=YEL)
    row("Payment request changes", "", "updatePaymentRequest and deletePaymentRequest are both "
        "secured. Same paste, or you do these in the app.", fill=YEL)
    r += 1
    ws.cell(r, 1, "Nothing in this file has changed your data. It is a read-only snapshot taken "
                  f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}.").font = MUTED
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    return ws


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "process-cleanup.xlsx"
    cache = os.environ.get("CLEANUP_CACHE")
    print("Loading ledgers…")
    d = load(cache)
    ix = index(d)

    stale = ghost = 0
    for x in d["getShipments"]:
        s_ = K(x.get("soNo"))
        st, _ = chain_state(s_, ix)
        if s_ not in ix["so"]: ghost += 1
        if K(x.get("status")) == "Pending" and st in ("Collected", "Awaiting payment", "Invoiced"):
            stale += 1
    po_recv = sum(1 for p in d["getPurchaseOrders"]
                  if ix["mrPo"].get(K(p.get("poNo"))) or ix["mr"].get(K(p.get("soNo")), []))
    po_draft_recv = sum(1 for p in d["getPurchaseOrders"]
                        if K(p.get("status")) != "Approved"
                        and (ix["mrPo"].get(K(p.get("poNo"))) or ix["mr"].get(K(p.get("soNo")), [])))
    stats = dict(q=len(d["getQuotations"]), so=len(d["getSalesOrders"]),
                 po=len(d["getPurchaseOrders"]), pay=len(d["getPaymentRequests"]),
                 shp=len(d["getShipments"]), shp_stale=stale, shp_ghost=ghost,
                 po_recv=po_recv, po_draft_recv=po_draft_recv,
                 pay_paid=sum(1 for p in d["getPaymentRequests"] if K(p.get("status")) == "Paid"),
                 pay_appr=sum(1 for p in d["getPaymentRequests"]
                              if K(p.get("status")) == "Approved" and not K(p.get("paidAt"))))

    wb = openpyxl.Workbook(); wb.remove(wb.active)
    sheet_quotations(wb, d, ix)
    sheet_sales_orders(wb, d, ix)
    sheet_purchase_orders(wb, d, ix)
    sheet_payment_requests(wb, d, ix)
    sheet_shipments(wb, d, ix)
    sheet_start(wb, d, ix, stats)
    wb.save(out)

    print(f"\nwrote {out}")
    for k, lab in [("q", "Quotations"), ("so", "Sales Orders"), ("po", "Purchase Orders"),
                   ("pay", "Payment Requests"), ("shp", "Shipments")]:
        print(f"  {lab:20} {stats[k]:>4} rows")
    print(f"\n  shipments stale (Pending but the money moved) : {stale}")
    print(f"  shipments whose SO does not exist            : {ghost}")
    print(f"  POs received but not Approved                : {po_draft_recv}")
    print(f"  duplicate quotation groups                   : "
          f"{len(set(quote_dupes(d['getQuotations']).values()))}")


if __name__ == "__main__":
    main()
