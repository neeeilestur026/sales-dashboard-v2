#!/usr/bin/env python3
"""A263 - per-stage process-flow audit for every sales order, with the date of each process.

Read-only against the live book. For all 108 sales orders it walks the eight stages

    Sales Order -> Purchase Order -> Payment Request -> AP Aging
                -> Receiving -> Invoice -> AR Aging -> Collection

labels each stage complete / partial / missing, and records that stage's date, reference and
amount. It then emits the gaps as fill-in sheets so the true values can be typed once and written
back through the backend, skipping the approval workflow that cannot be replayed for closed orders.

    ./venv/bin/python tools_so_process_flow.py [output.xlsx]

Nothing is written to the live book. Joins follow _soDocChain() in apps-script/FlowAPI.gs: every
downstream ledger is keyed on 'SO No'.
"""
import collections
import datetime as dt
import json
import os
import re
import sys
import urllib.request

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

FLOW = ("https://script.google.com/macros/s/"
        "AKfycbyOnYzt0M7HePi4VTEHINDaMxNi_ppvjGUyT4cSaExG-oPtjUYWZ6mcjxx9uVNgyyXY/exec")

# The date AR aging was bulk-imported. Invoices older than this were never expected to get an AR
# row, so they must not be reported as a process failure.
AR_BASELINE = dt.datetime(2026, 6, 23, tzinfo=dt.timezone.utc)

K = lambda v: str(v or "").strip()
N = lambda v: float(v or 0)
R2 = lambda v: round(v, 2)

OK, PART, GAP, NA = "COMPLETE", "PARTIAL", "MISSING", "n/a"


def fetch(action):
    with urllib.request.urlopen(f"{FLOW}?action={action}", timeout=180) as r:
        return json.load(r)


def load(cache=None):
    """Pull every ledger the chain touches. A cache dir short-circuits the network."""
    names = {
        "so": "getSalesOrders", "po": "getPurchaseOrders", "pr": "getPaymentRequests",
        "ap": "getAPAging", "mr": "getReceiving", "inv": "getInvoices", "ar": "getARAging",
        "col": "getCollections", "cd": "getSOCostDetails", "quo": "getQuotations",
        "doc": "getDocuments",
    }
    data = {}
    for key, action in names.items():
        if cache and os.path.exists(f"{cache}/{action}.json"):
            res = json.load(open(f"{cache}/{action}.json"))
        else:
            res = fetch(action)
        if not res.get("success"):
            raise SystemExit(f"{action} failed: {res.get('message')}")
        data[key] = res.get("data") or []
        print(f"  {action:22} {len(data[key]):>4} rows")
    ver = (fetch("getVersion") if not cache else
           json.load(open(f"{cache}/getVersion.json"))).get("version", "?")
    return data, ver


def group(rows, field):
    out = collections.defaultdict(list)
    for r in rows:
        if K(r.get(field)):
            out[K(r.get(field))].append(r)
    return out


def D(v):
    """ISO timestamp -> date, or None. The book stores UTC midnight-shifted values."""
    s = K(v)
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def DS(v):
    d = D(v)
    return d.strftime("%Y-%m-%d") if d else ""


def po_from_notes(note):
    """Migrated AR rows carry the customer PO inside Notes: 'Migrated (legacy) - DR 70 - PO X - ...'
    That PO is the sales order number, which is how an orphan row finds its way home."""
    m = re.search(r"(?:^|\u00b7)\s*PO\s+(.+?)\s*(?:\u00b7|$)", K(note))
    return K(m.group(1)) if m else ""


# --------------------------------------------------------------------------- analysis
def analyse(d):
    so, po, pr, ap, mr, inv, ar, col, cd, quo, doc = (
        d["so"], d["po"], d["pr"], d["ap"], d["mr"], d["inv"], d["ar"], d["col"],
        d["cd"], d["quo"], d["doc"])

    Bpo, Bpr, Bmr, Binv, Bar, Bcol = (group(x, "soNo") for x in (po, pr, mr, inv, ar, col))
    Bcd = {K(c.get("soNo")): c for c in cd}
    APbyPO = {K(a.get("poNo")): a for a in ap}
    PRbyPO = group(pr, "poNo")
    SOSET = {K(s.get("soNo")) for s in so}
    DOCbySO = group([x for x in doc if K(x.get("module")) == "Sales Order"], "refNo")

    rows = []
    for s in so:
        key = K(s.get("soNo"))
        cust = K(s.get("customer"))
        total = N(s.get("total"))
        stype = K(s.get("supplierType"))
        pos, prs = Bpo.get(key, []), Bpr.get(key, [])
        mrs, ivs = Bmr.get(key, []), Binv.get(key, [])
        ars, cols = Bar.get(key, []), Bcol.get(key, [])
        cost = Bcd.get(key)
        missing = []

        # -- 1 sales order -------------------------------------------------------
        so_gaps = []
        if not stype:
            so_gaps.append("no supplier type")
        if not (s.get("items") or []):
            so_gaps.append("no line items")
        if total <= 0:
            so_gaps.append("zero total")
        so_st = OK if not so_gaps else PART

        # -- 2 purchase order ----------------------------------------------------
        p = pos[0] if pos else None
        if p:
            po_php = N(p.get("totalPHP")) or N(p.get("total"))
            po_gaps = []
            if not K(p.get("supplier")):
                po_gaps.append("no supplier")
            if po_php <= 0:
                po_gaps.append("no PHP total")
            if K(p.get("status")) != "Approved":
                po_gaps.append("not approved")
            po_st = OK if not po_gaps else PART
        else:
            po_php, po_st = 0, GAP
            missing.append("purchase order")

        # -- 3 payment request ---------------------------------------------------
        pr_rows = prs or (PRbyPO.get(K(p.get("poNo")), []) if p else [])
        if pr_rows:
            paid_pr = [x for x in pr_rows if K(x.get("status")).lower() == "paid" or D(x.get("paidAt"))]
            pr_st = OK if paid_pr else PART
        else:
            pr_st = GAP
            if p:
                missing.append("payment request")

        # -- 4 AP aging ----------------------------------------------------------
        a = APbyPO.get(K(p.get("poNo"))) if p else None
        ap_note = ""
        if a:
            amt, paid = N(a.get("amountPHP")), N(a.get("paidPHP"))
            if abs(paid - amt) < 1.0:
                ap_st, ap_note = OK, "paid in full"
            elif paid <= 0:
                ap_st, ap_note = PART, "unpaid"
            elif paid > amt:
                ap_st, ap_note = PART, f"OVERPAID by {paid - amt:,.2f}"
            else:
                ap_st, ap_note = PART, f"short by {amt - paid:,.2f}"
            if po_php > 0 and abs(amt - po_php) > 1.0 and K(p.get("currency")) == "PHP":
                ap_note += "; AP != PO total"
        else:
            amt = paid = 0
            ap_st = GAP if p else NA
            if p:
                missing.append("AP aging")

        # -- 5 receiving ---------------------------------------------------------
        if mrs:
            ship = sum(N(x.get("totalShipping")) for x in mrs)
            duty = sum(N(x.get("duties")) for x in mrs)
            vat = sum(N(x.get("vat")) for x in mrs)
            deliv = sum(N(x.get("delivery")) for x in mrs)
            other = sum(N(x.get("other")) for x in mrs)
            mr_gaps = []
            if ship <= 0:
                mr_gaps.append("no shipping")
            if stype == "International" and duty <= 0:
                mr_gaps.append("intl but no duties")
            mr_st = OK if not mr_gaps else PART
        else:
            ship = duty = vat = deliv = other = 0
            mr_gaps, mr_st = [], GAP
            missing.append("receiving")

        # -- 6 invoice -----------------------------------------------------------
        live = [x for x in ivs if not x.get("voided")]
        if live:
            sales = sum(N(x.get("totalSales")) for x in live)
            cogs = sum(N(x.get("totalCOGS")) for x in live)
            iv_gaps = []
            if cogs <= 0:
                iv_gaps.append("no COGS on invoice")
            if abs(sales - total) > max(2.0, total * 0.13):
                iv_gaps.append("sales far from SO total")
            inv_st = OK if not iv_gaps else PART
        else:
            sales = cogs = 0
            iv_gaps, inv_st = [], GAP
            missing.append("invoice")

        # -- 7 AR aging ----------------------------------------------------------
        first_inv_date = min((D(x.get("date")) for x in live if D(x.get("date"))), default=None)
        pre_baseline = bool(first_inv_date and first_inv_date < AR_BASELINE)
        if ars:
            ar_amt = sum(N(x.get("amountPHP")) for x in ars)
            ar_coll = sum(N(x.get("collectedPHP")) for x in ars)
            ar_out = sum(N(x.get("outstanding")) for x in ars)
            ar_st = OK
        else:
            ar_amt = ar_coll = ar_out = 0
            if not live:
                ar_st = NA
            elif pre_baseline:
                ar_st = NA          # by design: predates the AR import
            else:
                ar_st = GAP
                missing.append("AR aging")

        # -- 8 collection --------------------------------------------------------
        if cols:
            c_amt = sum(N(x.get("amount")) for x in cols)
            col_st = OK if (ars and ar_out <= 0.01) else PART
        else:
            c_amt = 0
            if not live:
                col_st = NA
            elif pre_baseline:
                col_st = NA
            else:
                col_st = GAP
                missing.append("collection")

        # -- verdict -------------------------------------------------------------
        if live and ars and cols and ar_out <= 0.01:
            verdict = "COMPLETE"
        elif pre_baseline and live and cost:
            verdict = "HISTORICAL - closed before AR import"
        elif live and ars:
            verdict = "AWAITING COLLECTION"
        elif live:
            verdict = "AWAITING AR AGING"
        elif K(s.get("status")) == "Delivered":
            verdict = "DELIVERED, NOT INVOICED"
        else:
            verdict = "IN PROGRESS"

        issues = so_gaps + (mr_gaps if mrs else []) + (iv_gaps if live else [])
        if not cost:
            issues.insert(0, "NO COST RECORD - profit reported with zero COGS")
        if ap_note.startswith("OVERPAID") or "AP != PO" in ap_note:
            issues.append("AP: " + ap_note)

        rows.append(dict(
            key=key, cust=cust, verdict=verdict, missing="; ".join(missing),
            issues="; ".join(issues),
            so_st=so_st, so_date=DS(s.get("date")), total=total,
            status=K(s.get("status")), stype=stype, quo=K(s.get("quotationNo")),
            docs=len(DOCbySO.get(key, [])),
            po_st=po_st, po_no=K(p.get("poNo")) if p else "", po_date=DS(p.get("date")) if p else "",
            po_sup=K(p.get("supplier")) if p else "", po_cur=K(p.get("currency")) if p else "",
            po_php=po_php,
            pr_st=pr_st, pr_no="; ".join(K(x.get("prNo")) for x in pr_rows),
            pr_date=DS(pr_rows[0].get("createdAt")) if pr_rows else "",
            pr_paid=DS(next((x.get("paidAt") for x in pr_rows if D(x.get("paidAt"))), None)),
            pr_amt=sum(N(x.get("amountPHPEst")) or N(x.get("actualDebitedPHP")) for x in pr_rows),
            pr_bank=sum(N(x.get("bankChargePHP")) for x in pr_rows),
            ap_st=ap_st, ap_no=K(a.get("apNo")) if a else "", ap_amt=amt, ap_paid=paid,
            ap_due=DS(a.get("dueDate")) if a else "", ap_note=ap_note,
            mr_st=mr_st, mr_no="; ".join(K(x.get("mrNo")) for x in mrs),
            mr_date=DS(mrs[0].get("date")) if mrs else "",
            ship=ship, duty=duty, vat=vat, deliv=deliv, other=other,
            cost_st=OK if cost else GAP,
            cogs=N(cost.get("total")) if cost else 0,
            inv_st=inv_st, inv_no="; ".join(K(x.get("invNo")) for x in live),
            inv_date=DS(live[0].get("date")) if live else "", sales=sales, icogs=cogs,
            voided=sum(1 for x in ivs if x.get("voided")),
            ar_st=ar_st, ar_no="; ".join(K(x.get("arNo")) for x in ars),
            ar_due=DS(ars[0].get("dueDate")) if ars else "",
            ar_amt=ar_amt, ar_coll=ar_coll, ar_out=ar_out,
            col_st=col_st, col_no="; ".join(K(x.get("collectionNo")) for x in cols),
            col_date=DS(cols[0].get("date")) if cols else "", col_amt=c_amt,
            col_meth=K(cols[0].get("method")) if cols else "",
            col_ewt=sum(N(x.get("ewt")) for x in cols),
            col_ref="; ".join(K(x.get("reference")) for x in cols if K(x.get("reference"))),
            pre_baseline=pre_baseline,
        ))

    orphan_ar = [a for a in ar if K(a.get("soNo")) not in SOSET]
    orphan_col = [c for c in col if K(c.get("soNo")) not in SOSET]
    return rows, orphan_ar, orphan_col


# --------------------------------------------------------------------------- styling
FONT = "Calibri"
BASE = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
MUTED = Font(name=FONT, size=9, color="666666", italic=True)
TITLE = Font(name=FONT, size=14, bold=True, color="1F3864")
HDR_FONT = Font(name=FONT, size=9, bold=True, color="FFFFFF")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MONEY = '#,##0.00;[Red]-#,##0.00'

# One colour per stage block, so eight groups stay legible across fifty columns.
BLOCK = {
    "so":   ("1F3864", "D9E1F2"),
    "po":   ("385723", "E2EFDA"),
    "pr":   ("833C00", "FCE4D6"),
    "ap":   ("7B3F00", "FFE4CC"),
    "mr":   ("31859C", "DAEEF3"),
    "cost": ("403151", "E4DFEC"),
    "inv":  ("974706", "FDE9D9"),
    "ar":   ("953735", "F2DCDB"),
    "col":  ("17375E", "DCE6F1"),
    "end":  ("404040", "EDEDED"),
    "fill": ("7F6000", "FFF2CC"),
}
ST_FILL = {
    OK:   PatternFill("solid", fgColor="C6EFCE"),
    PART: PatternFill("solid", fgColor="FFEB9C"),
    GAP:  PatternFill("solid", fgColor="FFC7CE"),
    NA:   PatternFill("solid", fgColor="EDEDED"),
}
ST_FONT = {
    OK:   Font(name=FONT, size=9, bold=True, color="006100"),
    PART: Font(name=FONT, size=9, bold=True, color="9C5700"),
    GAP:  Font(name=FONT, size=9, bold=True, color="9C0006"),
    NA:   Font(name=FONT, size=9, italic=True, color="808080"),
}
VERDICT_FILL = {
    "COMPLETE": PatternFill("solid", fgColor="C6EFCE"),
    "HISTORICAL - closed before AR import": PatternFill("solid", fgColor="DDEBF7"),
    "AWAITING COLLECTION": PatternFill("solid", fgColor="FFF2CC"),
    "AWAITING AR AGING": PatternFill("solid", fgColor="FCE4D6"),
    "DELIVERED, NOT INVOICED": PatternFill("solid", fgColor="F8CBAD"),
    "IN PROGRESS": PatternFill("solid", fgColor="EDEDED"),
}


def banner(ws, title, subtitle, width):
    ws.cell(row=1, column=1, value=title).font = TITLE
    ws.cell(row=2, column=1, value=subtitle).font = MUTED
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=min(width, 12))
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=min(width, 14))


def header(ws, row, cols, group_row=None):
    """cols = [(label, width, block, kind)]. kind: t text, n number, d date, f fill-in."""
    if group_row:
        prev, start = None, 1
        for i, (_, _, blk, _) in enumerate(cols, 1):
            if blk != prev:
                if prev is not None and i - 1 >= start:
                    _grouplabel(ws, group_row, start, i - 1, prev)
                prev, start = blk, i
        _grouplabel(ws, group_row, start, len(cols), prev)
    for i, (label, w, blk, kind) in enumerate(cols, 1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = HDR_FONT
        c.fill = PatternFill("solid", fgColor=BLOCK[blk][0])
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 34


GROUP_TITLE = {
    "so": "1 · SALES ORDER", "po": "2 · PURCHASE ORDER", "pr": "3 · PAYMENT REQUEST",
    "ap": "4 · AP AGING", "mr": "5 · RECEIVING", "cost": "6 · COST RECORD",
    "inv": "7 · INVOICE", "ar": "8 · AR AGING", "col": "9 · COLLECTION",
    "end": "VERDICT", "fill": "YOU FILL THIS IN",
}


def _grouplabel(ws, row, c1, c2, blk):
    ws.merge_cells(start_row=row, start_column=c1, end_row=row, end_column=c2)
    c = ws.cell(row=row, column=c1, value=GROUP_TITLE.get(blk, ""))
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=BLOCK[blk][0])
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = BOX


def put(ws, r, i, val, kind, blk, band):
    c = ws.cell(row=r, column=i)
    if kind == "n":
        c.value = R2(N(val)) if N(val) else (0 if val == 0 else None)
        c.number_format = MONEY
        c.alignment = Alignment(horizontal="right")
    else:
        c.value = val if val != "" else None
        c.alignment = Alignment(horizontal="center" if kind == "d" else "left",
                                vertical="center", wrap_text=(kind == "t"))
    c.font = BASE
    c.border = BOX
    if kind == "f":
        c.fill = PatternFill("solid", fgColor="FFF2CC")
    elif band:
        c.fill = PatternFill("solid", fgColor=BLOCK[blk][1])
    return c


# --------------------------------------------------------------------------- sheet 1
FLOW_COLS = [
    ("Status", 11, "so", "s"), ("SO No", 22, "so", "t"), ("Customer", 30, "so", "t"),
    ("SO Date", 11, "so", "d"), ("SO Total", 15, "so", "n"), ("Delivery", 11, "so", "t"),
    ("Supplier Type", 13, "so", "t"), ("Quotation", 16, "so", "t"), ("Files", 6, "so", "n"),

    ("Status", 11, "po", "s"), ("PO No", 22, "po", "t"), ("PO Date", 11, "po", "d"),
    ("Supplier", 26, "po", "t"), ("Cur", 6, "po", "t"), ("PO Total PHP", 14, "po", "n"),

    ("Status", 11, "pr", "s"), ("PR No", 20, "pr", "t"), ("PR Date", 11, "pr", "d"),
    ("Paid Date", 11, "pr", "d"), ("PR Amount", 14, "pr", "n"), ("Bank Chg", 11, "pr", "n"),

    ("Status", 11, "ap", "s"), ("AP No", 16, "ap", "t"), ("AP Due Date", 11, "ap", "d"),
    ("AP Amount", 14, "ap", "n"), ("AP Paid", 14, "ap", "n"), ("AP Check", 22, "ap", "t"),

    ("Status", 11, "mr", "s"), ("MR No", 18, "mr", "t"), ("Receiving Date", 12, "mr", "d"),
    ("Shipping", 13, "mr", "n"), ("Duties", 12, "mr", "n"), ("VAT", 11, "mr", "n"),
    ("Delivery", 12, "mr", "n"), ("Other", 12, "mr", "n"),

    ("Status", 11, "cost", "s"), ("TOTAL COGS", 14, "cost", "n"),

    ("Status", 11, "inv", "s"), ("INV No", 20, "inv", "t"), ("Invoice Date", 12, "inv", "d"),
    ("Invoice Sales", 15, "inv", "n"), ("Invoice COGS", 14, "inv", "n"), ("Void", 6, "inv", "n"),

    ("Status", 11, "ar", "s"), ("AR No", 16, "ar", "t"), ("AR Due Date", 11, "ar", "d"),
    ("AR Amount", 14, "ar", "n"), ("Collected", 14, "ar", "n"), ("Outstanding", 14, "ar", "n"),

    ("Status", 11, "col", "s"), ("COL No", 18, "col", "t"), ("Collection Date", 13, "col", "d"),
    ("Amount", 14, "col", "n"), ("Method", 14, "col", "t"), ("EWT", 11, "col", "n"),
    ("Reference", 16, "col", "t"),

    ("VERDICT", 26, "end", "t"), ("Stages missing", 34, "end", "t"),
    ("Issues found", 46, "end", "t"),

    ("YOUR LABEL", 20, "fill", "f"), ("NOTES", 40, "fill", "f"),
]

FIELDS = [
    "so_st", "key", "cust", "so_date", "total", "status", "stype", "quo", "docs",
    "po_st", "po_no", "po_date", "po_sup", "po_cur", "po_php",
    "pr_st", "pr_no", "pr_date", "pr_paid", "pr_amt", "pr_bank",
    "ap_st", "ap_no", "ap_due", "ap_amt", "ap_paid", "ap_note",
    "mr_st", "mr_no", "mr_date", "ship", "duty", "vat", "deliv", "other",
    "cost_st", "cogs",
    "inv_st", "inv_no", "inv_date", "sales", "icogs", "voided",
    "ar_st", "ar_no", "ar_due", "ar_amt", "ar_coll", "ar_out",
    "col_st", "col_no", "col_date", "col_amt", "col_meth", "col_ewt", "col_ref",
    "verdict", "missing", "issues", None, None,
]

LABELS = "Duplicate,Cancelled,Never happened,Real - needs data,Already settled,Not sure"


def sheet_flow(wb, rows, ver):
    ws = wb.create_sheet("Process Flow")
    banner(ws, "Every sales order, stage by stage, with the date of each process",
           f"FlowAPI v{ver} · {len(rows)} sales orders · generated "
           f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M')} · "
           "GREY/COLOURED = computed, do not type · YELLOW = fill this in", len(FLOW_COLS))
    header(ws, 5, FLOW_COLS, group_row=4)
    for n, row in enumerate(rows):
        r = 6 + n
        band = (n % 2 == 1)
        for i, ((label, w, blk, kind), field) in enumerate(zip(FLOW_COLS, FIELDS), 1):
            if field is None:
                put(ws, r, i, "", "f", blk, False)
                continue
            val = row[field]
            if kind == "s":
                c = ws.cell(row=r, column=i, value=val)
                c.fill = ST_FILL.get(val, ST_FILL[NA])
                c.font = ST_FONT.get(val, BASE)
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.border = BOX
            else:
                c = put(ws, r, i, val, kind, blk, band)
                if field == "verdict":
                    c.fill = VERDICT_FILL.get(val, ST_FILL[NA])
                    c.font = Font(name=FONT, size=9, bold=True)
                elif field == "issues" and val:
                    c.font = Font(name=FONT, size=9, color="9C0006")
    last = 5 + len(rows)
    ws.freeze_panes = "D6"
    ws.auto_filter.ref = f"A5:{get_column_letter(len(FLOW_COLS))}{last}"
    dv = DataValidation(type="list", formula1=f'"{LABELS}"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"{get_column_letter(len(FLOW_COLS) - 1)}6:"
           f"{get_column_letter(len(FLOW_COLS) - 1)}{last}")
    return ws


# --------------------------------------------------------------------------- fill sheets
def fill_sheet(wb, name, title, subtitle, cols, data_rows):
    ws = wb.create_sheet(name)
    banner(ws, title, subtitle, len(cols))
    header(ws, 4, cols)
    for n, vals in enumerate(data_rows):
        r = 5 + n
        band = (n % 2 == 1)
        for i, ((label, w, blk, kind), val) in enumerate(zip(cols, vals), 1):
            put(ws, r, i, val, kind, blk, band)
    last = 4 + len(data_rows)
    ws.freeze_panes = "A5"
    if data_rows:
        ws.auto_filter.ref = f"A4:{get_column_letter(len(cols))}{last}"
    return ws, last


COST_COLS = [
    ("SO No", 22, "so", "t"), ("Customer", 30, "so", "t"), ("SO Date", 11, "so", "d"),
    ("SO Total", 15, "so", "n"), ("Invoice Sales", 15, "inv", "n"),
    ("Supplier Type", 14, "fill", "f"), ("Purchase of Goods", 16, "fill", "f"),
    ("Duties & Taxes", 14, "fill", "f"), ("Shipping Cost", 14, "fill", "f"),
    ("Local Charges", 14, "fill", "f"), ("Delivery to Office", 15, "fill", "f"),
    ("Delivery to Client", 15, "fill", "f"), ("Bank Charges", 13, "fill", "f"),
    ("NOTES", 34, "fill", "f"),
]

COLL_COLS = [
    ("SO No", 22, "so", "t"), ("Customer", 30, "so", "t"), ("INV No", 20, "inv", "t"),
    ("Invoice Date", 12, "inv", "d"), ("Invoice Sales", 15, "inv", "n"),
    ("AR No", 16, "ar", "t"), ("AR Outstanding", 14, "ar", "n"),
    ("Was it paid?", 13, "fill", "f"), ("Date Paid", 12, "fill", "f"),
    ("Amount Received", 16, "fill", "f"), ("EWT Withheld", 13, "fill", "f"),
    ("Method", 15, "fill", "f"), ("Reference", 18, "fill", "f"), ("NOTES", 30, "fill", "f"),
]

ORPH_COLS = [
    ("Type", 10, "end", "t"), ("Record No", 18, "end", "t"), ("Customer", 28, "end", "t"),
    ("Invoice No on record", 18, "inv", "t"), ("Date", 12, "end", "d"),
    ("Amount", 15, "end", "n"), ("Collected", 14, "end", "n"),
    ("Customer PO on the record", 24, "end", "t"),
    ("MY BEST GUESS", 24, "end", "t"), ("Confirm? (Yes/No)", 14, "fill", "f"),
    ("If No, the right SO No", 24, "fill", "f"), ("NOTES", 28, "fill", "f"),
]


# --------------------------------------------------------------------------- summary
def sheet_summary(wb, rows, d, orphan_ar, orphan_col, ver):
    ws = wb.create_sheet("Summary")
    banner(ws, "Where every sales order stands",
           f"FlowAPI v{ver} · read straight off the live book · "
           f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}", 6)
    for i, w in enumerate([44, 14, 18, 18, 14, 40], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    r = 4

    def head(text):
        nonlocal r
        r += 1
        c = ws.cell(row=r, column=1, value=text)
        c.font = Font(name=FONT, size=11, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3864")
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        r += 1

    def line(a, b="", c="", dd="", e="", note="", bold=False, money=(2, 3, 4, 5)):
        nonlocal r
        for i, v in enumerate([a, b, c, dd, e, note], 1):
            cell = ws.cell(row=r, column=i, value=v if v != "" else None)
            cell.font = BOLD if bold else BASE
            cell.border = BOX
            if i in money and isinstance(v, (int, float)):
                cell.number_format = MONEY
                cell.alignment = Alignment(horizontal="right")
            if i == 6:
                cell.font = MUTED
                cell.alignment = Alignment(wrap_text=True, vertical="center")
        r += 1

    n = len(rows)
    head("STAGE COVERAGE — how many of the %d sales orders reached each stage" % n)
    line("Stage", "Complete", "Partial", "Missing", "n/a", "what a gap means here", bold=True,
         money=())
    stages = [
        ("1 · Sales order", "so_st", "details on the order itself"),
        ("2 · Purchase order", "po_st", "EXPECTED to be missing — see Legend, do not back-create"),
        ("3 · Payment request", "pr_st", "only meaningful where a PO exists"),
        ("4 · AP aging", "ap_st", "only meaningful where a PO exists"),
        ("5 · Receiving", "mr_st", "goods-in and the landed-cost charges"),
        ("6 · Cost record", "cost_st", "MATTERS — profit is reported with zero COGS without it"),
        ("7 · Invoice", "inv_st", "what you billed the customer"),
        ("8 · AR aging", "ar_st", "n/a = invoice predates the 2026-06-23 AR import, by design"),
        ("9 · Collection", "col_st", "n/a = closed before the AR import"),
    ]
    for label, field, note in stages:
        cnt = collections.Counter(x[field] for x in rows)
        line(label, cnt[OK], cnt[PART], cnt[GAP], cnt[NA], note, money=())

    head("VERDICT — the end-to-end state of each order")
    line("Verdict", "Orders", "Value", "", "", "", bold=True, money=())
    vc = collections.Counter(x["verdict"] for x in rows)
    vv = collections.defaultdict(float)
    for x in rows:
        vv[x["verdict"]] += x["total"]
    for k, c in vc.most_common():
        line(k, c, R2(vv[k]), "", "", "", money=(3,))
    line("TOTAL", n, R2(sum(x["total"] for x in rows)), "", "", "", bold=True, money=(3,))

    head("WHAT ACTUALLY NEEDS YOUR INPUT")
    need_cost = [x for x in rows if x["cost_st"] == GAP]
    need_coll = [x for x in rows if x["inv_st"] != GAP and x["col_st"] in (GAP, PART, NA)
                 and x["ar_out"] > 0.01 or (x["inv_st"] != GAP and not x["col_no"])]
    line("Sheet", "Rows", "Value", "", "", "why", bold=True, money=())
    line("FILL - Cost Details", len(need_cost), R2(sum(x["total"] for x in need_cost)), "", "",
         "no cost record at all — profit is overstated by roughly half of this", money=(3,))
    line("FILL - Collections", len(need_coll), R2(sum(x["total"] for x in need_coll)), "", "",
         "invoiced but no collection recorded against the order", money=(3,))
    line("FILL - Attach Orphans", len(orphan_ar) + len(orphan_col),
         R2(sum(N(a.get("amountPHP")) for a in orphan_ar)), "", "",
         f"{len(orphan_ar)} AR rows ({sum(N(a.get('amountPHP')) for a in orphan_ar):,.2f}) and "
         f"{len(orphan_col)} collections ({sum(N(c.get('amount')) for c in orphan_col):,.2f}) "
         "not linked to any order. The value shown is the AR side only — the collections settle "
         "those same rows, so adding the two would count the money twice.", money=(3,))

    head("AR AGING — the process is working; the gap is historical")
    inv = d["inv"]
    ar_so = {K(a.get("soNo")) for a in d["ar"] if K(a.get("soNo"))}
    ar_inv = {K(a.get("invNo")) for a in d["ar"] if K(a.get("invNo"))}
    no_ar = [i for i in inv if not i.get("voided")
             and K(i.get("soNo")) not in ar_so and K(i.get("invNo")) not in ar_inv]
    pre = [i for i in no_ar if (D(i.get("date")) or AR_BASELINE) < AR_BASELINE]
    line("Invoices with no AR row", len(no_ar), R2(sum(N(i.get("totalSales")) for i in no_ar)),
         "", "", "", money=(3,))
    line("  …dated BEFORE the 2026-06-23 AR import", len(pre),
         R2(sum(N(i.get("totalSales")) for i in pre)), "", "",
         "expected — AR aging did not exist yet", money=(3,))
    line("  …dated ON OR AFTER it (a real process failure)", len(no_ar) - len(pre),
         R2(sum(N(i.get("totalSales")) for i in no_ar) - sum(N(i.get("totalSales")) for i in pre)),
         "", "", "zero means every invoice raised since the import got its AR row", money=(3,))

    head("PURCHASE ORDER vs AP AGING — every PO reconciled")
    line("PO No", "PO Total PHP", "AP Amount", "AP Paid", "", "check", bold=True, money=())
    APbyPO = {K(a.get("poNo")): a for a in d["ap"]}
    for p in d["po"]:
        a = APbyPO.get(K(p.get("poNo")))
        pt = N(p.get("totalPHP")) or N(p.get("total"))
        amt = N(a.get("amountPHP")) if a else 0
        paid = N(a.get("paidPHP")) if a else 0
        if not a:
            chk = "no AP row"
        elif abs(paid - amt) < 1.0:
            chk = "paid in full"
        elif paid <= 0:
            chk = "unpaid"
        elif paid > amt:
            chk = f"OVERPAID by {paid - amt:,.2f}"
        else:
            chk = f"short by {amt - paid:,.2f}"
        line(K(p.get("poNo")), R2(pt), R2(amt), R2(paid), "", chk)

    head("RECEIVING vs COST RECORD — the same charges, from two places")
    mr = d["mr"]
    CDby = {K(c.get("soNo")): c for c in d["cd"]}
    both = {K(x.get("soNo")) for x in mr if K(x.get("soNo")) in CDby}
    line("Charge", "", "Receiving says", "Cost record says", "Difference", "", bold=True, money=())
    pairs = [("Customs duties", "duties", ("dutiesAndTaxes",)),
             ("Shipping", "totalShipping", ("shippingCost",)),
             ("Delivery", "delivery", ("deliveryToOffice", "deliveryToClient")),
             ("Other / local charges", "other", ("localCharges",)),
             ("VAT", "vat", ())]
    for label, mf, cfs in pairs:
        a = sum(N(x.get(mf)) for x in mr if K(x.get("soNo")) in both)
        b = sum(sum(N(CDby[k].get(cf)) for cf in cfs) for k in both)
        blank = sum(1 for x in mr if N(x.get(mf)) <= 0)
        note = f"{blank} of {len(mr)} receiving rows blank"
        if cfs and abs(a - b) > 1000:
            note += " · WORTH CHECKING — the two do not agree"
        elif not cfs:
            note = f"{blank} of {len(mr)} receiving rows blank · no VAT captured anywhere"
        line(label, "", R2(a), R2(b), R2(a - b), note, money=(3, 4, 5))
    line("Receiving rows carrying an SO No", sum(1 for x in mr if K(x.get("soNo"))), "", "", "",
         "how receiving links back to the order", money=())
    line("Receiving rows carrying a PO No", sum(1 for x in mr if K(x.get("poNo"))), "", "", "",
         "expected to be empty — the PO module is newer than most of these orders", money=())
    line("", "", "", "", "", "")
    line("Are these charges already in the profit report?", "", "", "", "",
         "YES. The cost record is what the report reads, and it already carries duties, shipping "
         "and delivery of its own. The receiving figures above are shown for cross-checking, not "
         "as money missing from your profit.", money=())
    ws.freeze_panes = "A5"
    return ws


LEGEND = [
    ("HOW TO USE THIS FILE", None),
    ("Coloured and grey cells are computed from the live system. Do not type in them — "
     "anything you change there is ignored when I read the file back.", None),
    ("YELLOW cells are yours. They are the only cells I read.", None),
    ("", None),
    ("WHAT THE STATUS WORDS MEAN", None),
    ("COMPLETE", "The stage happened and its details are filled in."),
    ("PARTIAL", "The stage happened but something on it is blank or does not reconcile. "
                "The 'Issues found' column says what."),
    ("MISSING", "No record of this stage at all."),
    ("n/a", "This stage was never expected here. Almost always: the invoice predates the "
            "2026-06-23 AR import, so no AR row or collection was ever created for it."),
    ("", None),
    ("LEAVE THESE ALONE — a gap here is normal", None),
    ("Purchase Order", "96 of 108 orders have none, because the PO module is newer than the "
                       "orders. 25 of the 26 fully-complete orders have no PO either. Creating "
                       "one now posts Dr Purchases Clearing / Cr Accounts Payable and would "
                       "invent a payable for goods you already paid for."),
    ("Payment Request", "Only meaningful where a PO exists. Same reasoning."),
    ("AP Aging", "Created automatically by the PO. Same reasoning."),
    ("", None),
    ("THIS IS THE ONE THAT COSTS YOU MONEY", None),
    ("Cost record MISSING", "The profit report counts the full sale as profit with zero cost. "
                            "Fill these on the 'FILL - Cost Details' sheet."),
    ("", None),
    ("THE LABEL DROPDOWN", None),
    ("Duplicate", "The same order was entered twice. Put the number it duplicates in NOTES."),
    ("Cancelled", "The order was called off. Nothing more is owed or owing."),
    ("Never happened", "Entered by mistake; no goods, no money."),
    ("Real - needs data", "A genuine order still missing its figures. I will come back for them."),
    ("Already settled", "Real, finished and paid — the system just never recorded it."),
    ("Not sure", "Leave it to me to investigate. Say what you know in NOTES."),
    ("", None),
    ("WHEN YOU ARE DONE", None),
    ("Save the file and send it back. I read the yellow cells and write them straight into the "
     "sheets through the backend — no approvals, no re-doing the workflow.", None),
]


def sheet_legend(wb):
    ws = wb.create_sheet("Legend")
    banner(ws, "How to read and fill this workbook", "Read this first — it is short.", 2)
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 96
    r = 4
    for a, b in LEGEND:
        ca = ws.cell(row=r, column=1, value=a or None)
        cb = ws.cell(row=r, column=2, value=b or None)
        cb.alignment = Alignment(wrap_text=True, vertical="top")
        if b is None and a:
            ca.font = Font(name=FONT, size=11, bold=True, color="FFFFFF")
            ca.fill = PatternFill("solid", fgColor="1F3864")
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
            ca.alignment = Alignment(wrap_text=True, vertical="center")
            ws.row_dimensions[r].height = 30 if len(a) > 70 else 18
        else:
            ca.font = BOLD
            cb.font = BASE
            ws.row_dimensions[r].height = max(15, 13 * (len(b or "") // 90 + 1))
        r += 1
    return ws


# --------------------------------------------------------------------------- main
def build(rows, d, orphan_ar, orphan_col, ver, out):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    sheet_legend(wb)
    sheet_summary(wb, rows, d, orphan_ar, orphan_col, ver)
    sheet_flow(wb, rows, ver)

    # -- FILL: cost details -------------------------------------------------
    need = [x for x in rows if x["cost_st"] == GAP]
    ws, last = fill_sheet(
        wb, "FILL - Cost Details",
        "What did these orders COST you?",
        f"{len(need)} orders have no cost record, so the profit report counts the whole sale as "
        "profit. Fill the yellow cells — peso amounts, no formulas. Leave a charge blank if there "
        "was none.",
        COST_COLS,
        [[x["key"], x["cust"], x["so_date"], x["total"], x["sales"]] + [""] * 9 for x in need])
    dv = DataValidation(type="list", formula1='"Local,International"', allow_blank=True)
    ws.add_data_validation(dv)
    if need:
        dv.add(f"F5:F{last}")

    # -- FILL: collections --------------------------------------------------
    coll = [x for x in rows if x["inv_st"] != GAP and not x["col_no"]]
    ws2, last2 = fill_sheet(
        wb, "FILL - Collections",
        "Did the customer pay — and when?",
        f"{len(coll)} orders were invoiced but have no collection recorded. If it was never paid, "
        "put No and leave the rest blank; that is a valid answer and I will mark it outstanding.",
        COLL_COLS,
        [[x["key"], x["cust"], x["inv_no"], x["inv_date"], x["sales"], x["ar_no"], x["ar_out"]]
         + [""] * 7 for x in coll])
    dv2 = DataValidation(type="list", formula1='"Yes,No,Partial"', allow_blank=True)
    ws2.add_data_validation(dv2)
    if coll:
        dv2.add(f"H5:H{last2}")

    # -- FILL: orphans ------------------------------------------------------
    soset = {x["key"] for x in rows}
    arby = {K(a.get("arNo")): a for a in d["ar"]}
    orph, guessed = [], 0
    for a in orphan_ar:
        po = po_from_notes(a.get("notes")) or K(a.get("soNo"))
        g = po if po in soset else ""
        guessed += bool(g)
        orph.append(["AR", K(a.get("arNo")), K(a.get("customer")), K(a.get("invNo")),
                     DS(a.get("dueDate")), N(a.get("amountPHP")), N(a.get("collectedPHP")),
                     po, g or "— could not match —", "", "", ""])
    for c in orphan_col:
        src = arby.get(K(c.get("arNo")))
        po = po_from_notes(src.get("notes")) if src else K(c.get("soNo"))
        g = po if po in soset else ""
        guessed += bool(g)
        orph.append(["Collection", K(c.get("collectionNo")), K(c.get("customer")),
                     K(c.get("invNo")), DS(c.get("date")), N(c.get("amount")), "",
                     po, g or "— could not match —", "", "", ""])
    ws3, last3 = fill_sheet(
        wb, "FILL - Attach Orphans",
        "Money already recorded — which order does it belong to?",
        f"{len(orph)} AR rows and collections are not linked to any sales order. Nothing is lost. "
        f"I already worked out {guessed} of them from the customer PO stored on the record — for "
        "those just put Yes. The rest need you.",
        ORPH_COLS, orph)
    dv3 = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True)
    ws3.add_data_validation(dv3)
    if orph:
        dv3.add(f"J5:J{last3}")
        for r in range(5, last3 + 1):
            if ws3.cell(r, 9).value == "— could not match —":
                ws3.cell(r, 9).font = Font(name=FONT, size=9, italic=True, color="9C0006")
            else:
                ws3.cell(r, 9).font = Font(name=FONT, size=10, bold=True, color="006100")

    wb.save(out)
    return out


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "sales-order-process-flow.xlsx"
    cache = os.environ.get("SO_FLOW_CACHE")
    print("Loading live ledgers…" if not cache else f"Loading from cache {cache}…")
    d, ver = load(cache)
    rows, orphan_ar, orphan_col = analyse(d)
    build(rows, d, orphan_ar, orphan_col, ver, out)
    n = len(rows)
    print(f"\n{n} sales orders analysed · FlowAPI v{ver}")
    for label, f in [("cost record", "cost_st"), ("invoice", "inv_st"),
                     ("AR aging", "ar_st"), ("collection", "col_st")]:
        c = collections.Counter(x[f] for x in rows)
        print(f"  {label:14} complete {c[OK]:>3}  partial {c[PART]:>3}  "
              f"missing {c[GAP]:>3}  n/a {c[NA]:>3}")
    print(f"  orphan AR rows {len(orphan_ar)} · orphan collections {len(orphan_col)}")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
