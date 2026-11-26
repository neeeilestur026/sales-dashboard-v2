"""A403 — the Sales plan as Neil's "Individual Sales Strategy Workbook" (sales-plan.html → Download Excel).

Neil, 23 Nov 2026: his 2027 workbook (50 customer accounts, a ₱25M year) adapted to the portal. The page's Download Excel
rebuilds the same nine sheets, the same columns and the same live formulas as his file, filled in from the portal:
FlowAPI 202's getSalesPlan (accounts, sales, pipeline, quotations, months) and getSalesActivity (the daily reports). The
formulas stay formulas, so the file can still be edited and re-totals itself in Excel.

Two choices made here so the formulas keep working:
- a sale on one of the rep's accounts is written under the ACCOUNT's spelling in the Sales Log (the order's own spelling goes
  in Notes), because the account sheet totals the Sales Log with SUMIF on the name;
- cost and gross profit are written only when the reply carries them (the director and management); a rep's file leaves
  the Cost of Sales column empty and says so.
"""
from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

NAVY, BLUE, INK, GREY, RED = "0F2643", "1F68AA", "25303C", "64748B", "C22D34"
BAND, INPUT, CALC = "F8FAFC", "FFF2CC", "EAF2F8"
PESO = '₱#,##0;[Red](₱#,##0)'
PESO2 = '₱#,##0.00;[Red](₱#,##0.00)'
PCT = '0.0%'
DAY = 'dd-mmm-yyyy'
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
THIN = Side(style="thin", color="D9E1EA")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

ACTIVITY_TYPES = ["Customer Visit", "Phone Call", "Email", "Online Meeting", "Technical Meeting", "Site Survey", "Quotation Follow-up",
                  "Collection Follow-up", "Sales Order", "Other Task"]
_ACT_MAP = {"customer visit": "Customer Visit", "phone call": "Phone Call", "email": "Email", "online meeting": "Online Meeting",
            "technical meeting": "Technical Meeting", "site survey": "Site Survey", "quotation follow-up": "Quotation Follow-up",
            "collection follow-up": "Collection Follow-up", "sales order": "Sales Order", "other task": "Other Task"}
STAGES = ["Lead", "Qualified", "Technical Review", "Quotation", "Negotiation", "Closed Won", "Closed Lost"]
Q_STATES = ["Draft", "Submitted", "Under Review", "Negotiation", "Won", "Lost", "Expired"]
PAYMENTS = ["Unpaid", "Partially Paid", "Paid", "Overdue", "Not invoiced"]
STATUSES = ["Active", "Prospect", "Dormant", "On Hold"]


def _s(v):
    return "" if v is None else str(v).strip()


def _n(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _d(v):
    """'2026-11-23…' → a date (Excel shows it as a date), else None."""
    t = _s(v)[:10]
    try:
        return datetime.strptime(t, "%Y-%m-%d").date()
    except ValueError:
        return None


def _title(ws, text, sub, last_col):
    ws["A1"] = text
    ws["A1"].font = Font(name="Aptos Display", size=18, bold=True, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor=NAVY)
    ws["A1"].alignment = Alignment(vertical="center")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
    ws["A2"] = sub
    ws["A2"].font = Font(name="Aptos", size=10, color=GREY)
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=last_col)
    ws.row_dimensions[1].height = 32
    ws.row_dimensions[2].height = 30


def _widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _header(ws, row, names):
    for i, h in enumerate(names, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = Font(name="Aptos", size=10, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=BLUE)
        c.alignment = Alignment(wrap_text=True, vertical="center")
        c.border = BOX
    ws.row_dimensions[row].height = 30


def _cell(ws, row, col, value, fmt=None, band=False, bold=False, color=INK):
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name="Aptos", size=10, bold=bold, color=color)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    c.border = BOX
    if fmt:
        c.number_format = fmt
    if band:
        c.fill = PatternFill("solid", fgColor=BAND)
    return c


def _table(ws, name, ref):
    t = Table(displayName=name, ref=ref)
    t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(t)


def _list(ws, values, ref):
    dv = DataValidation(type="list", formula1='"' + ",".join(values) + '"', allow_blank=True)
    dv.add(ref)
    ws.add_data_validation(dv)


def build_sales_plan_xlsx(plan, activity=None, prepared_by="", today=None):
    """plan = a getSalesPlan reply (one rep); activity = a getSalesActivity reply or None. Returns the .xlsx bytes."""
    plan = plan or {}
    activity = activity or {}
    year = int(plan.get("year") or date.today().year)
    who = _s(plan.get("user"))
    today = today or _s(plan.get("today")) or date.today().isoformat()
    p = plan.get("plan") or {}
    annual = _n(p.get("annual")) or 0
    shares = [(_n(x) or 0) / 100 for x in (p.get("months") or [])] or [1 / 12] * 12
    may = plan.get("may") or {}
    cost = bool(may.get("cost"))
    accounts = plan.get("accounts") or []
    book = _s((plan.get("lists") or {}).get("tierFrom")) == "book"   # A407 — the tiers are the Client Book's labels
    sales = plan.get("sales") or []
    pipe = [o for o in (plan.get("pipeline") or []) if not o.get("archived")]
    quotes = plan.get("quotes") or []
    acts = activity.get("rows") or []
    by_no = {a.get("clientNo"): a for a in accounts}
    stage_of = {o.get("recordNo"): o for o in pipe if o.get("source") == "quotation"}

    n_acc = max(50, len(accounts))
    n_sales = max(500, len(sales))
    n_pipe = max(300, len(pipe))
    n_act = max(300, len(acts))
    n_q = max(300, len(quotes))
    acc_end, sales_end, pipe_end, act_end, q_end = 4 + n_acc, 4 + n_sales, 4 + n_pipe, 4 + n_act, 4 + n_q

    wb = Workbook()

    # ── Start Here ───────────────────────────────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "Start Here"
    _title(ws, f"HI-ESCORP | {year} Individual Sales Strategy Workbook — {who}",
           f"{len(accounts)} customer accounts • ₱{annual:,.0f} annual sales goal • Filled in from the portal on {today}"
           + (f" for {prepared_by}" if prepared_by else ""), 8)
    _widths(ws, [28, 22, 18, 18, 18, 18, 18, 18])
    ws["A4"] = "HOW THIS FILE WAS FILLED"
    ws["A4"].font = Font(name="Aptos", size=12, bold=True, color=RED)
    steps = [
        ("1. The accounts", ("The live clients in the rep's Client Book, Major first, then Minor and Developing. The tier is the client's Client Book label "
                             "(A Major, B Minor, C Developing); " if book else
                             "The live clients in the rep's Client Book, in follow-up rank order. Tier from the rank (1–10 A, 11–25 B, 26–50 C) unless changed by hand; ")
                            + "the target from the tier; the main contact from the Client Book; visits from the visit plans and the daily reports."),
        ("2. The annual target", f"₱{annual:,.0f}, split over the months on the Monthly Targets sheet"
                                 + (" as set on the Sales plan." if p.get("set") else " (the default: not yet set by the director).")),
        ("3. The sales", "Every sales order of the year on its date, at its total as recorded — before VAT (VAT is added on the invoice). An order counts for the rep "
                         "whose quotation it names; with no quotation, for the rep whose Client Book has the customer."),
        ("4. The pipeline", "Open quotations (sent or approved, not won or closed) at their value after discount, purchase requests not yet quoted, and leads typed on "
                            "the Sales plan, plus this year's closed quotations. Odds, close dates and next actions as on the Sales plan."),
        ("5. Quotations and activity", "Quotation Tracker: the year's quotations and where each stands. Daily Activity: the daily reports' lines "
                                       f"from {_s(activity.get('from')) or '—'} to {_s(activity.get('to')) or '—'}, each day's sent emails, visits marked done and the older call log."),
        ("6. Review monthly", "KPI Dashboard and Monthly Targets total themselves from the other sheets. Action Tracker is left for the review's commitments."),
        ("Planning assumptions", "The targets are planning figures, not past performance. Edit the light yellow cells; the formulas update."
                                 + ("" if cost else " Cost of sales and gross profit are not included in a rep's copy.")),
    ]
    for i, (k, v) in enumerate(steps):
        r = 6 + i
        ws.cell(row=r, column=1, value=k).font = Font(name="Aptos", size=11, bold=True, color=NAVY)
        c = ws.cell(row=r, column=2, value=v)
        c.font = Font(name="Aptos", size=10, color=INK)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        ws.row_dimensions[r].height = 42
    ws["A15"] = "COLOR GUIDE"
    ws["A15"].font = Font(name="Aptos", size=12, bold=True, color=RED)
    for i, (k, v, fill) in enumerate([("Blue headers", "Column headings", BLUE), ("Light yellow cells", "Editable assumptions", INPUT), ("Formula cells", "Calculated; avoid overwriting", CALC)]):
        a = ws.cell(row=16 + i, column=1, value=k)
        a.font = Font(name="Aptos", size=10, bold=True, color="FFFFFF" if fill == BLUE else INK)
        a.fill = PatternFill("solid", fgColor=fill)
        ws.cell(row=16 + i, column=2, value=v).font = Font(name="Aptos", size=10, color=INK)
    ws.freeze_panes = "A4"

    # ── KPI Dashboard ────────────────────────────────────────────────────────────────────────────
    kd = wb.create_sheet("KPI Dashboard")
    _title(kd, f"{year} Individual Sales KPI Dashboard — {who}", "Live summary from the Sales Log, 50 Customer Accounts, Sales Pipeline and Quotation Tracker.", 8)
    _widths(kd, [34, 20, 18, 18, 18, 15, 15, 15])
    SL, AC, SP, QT = "'Sales Log'", "'50 Customer Accounts'", "'Sales Pipeline'", "'Quotation Tracker'"
    rows = [
        ("Annual Sales Target", annual, PESO, CALC),
        ("Annual Target (editable input)", "=B4", PESO, INPUT),
        None,
        ("Actual Sales YTD", f"=SUM({SL}!E5:E{sales_end})", PESO, CALC),
        ("Sales Achievement", "=IFERROR(B7/B5,0)", PCT, CALC),
        ("Remaining Sales Target", "=B5-B7", PESO, CALC),
        ("Open Weighted Pipeline", f'=SUMIFS({SP}!H5:H{pipe_end},{SP}!F5:F{pipe_end},"<>Closed Won",{SP}!F5:F{pipe_end},"<>Closed Lost")', PESO, CALC),
        ("Unweighted Open Pipeline", f'=SUMIFS({SP}!E5:E{pipe_end},{SP}!F5:F{pipe_end},"<>Closed Won",{SP}!F5:F{pipe_end},"<>Closed Lost")', PESO, CALC),
        ("Pipeline Coverage (unweighted)", "=IFERROR(B11/B5,0)", PCT, CALC),
        ("Gross Profit", f"=SUM({SL}!G5:G{sales_end})" if cost else "Not shown", PESO, CALC),
        ("Gross Margin", f'=IFERROR(B13/SUMIFS({SL}!E5:E{sales_end},{SL}!F5:F{sales_end},">0"),0)' if cost else "Not shown", PCT, CALC),
        ("Quotations Submitted", "=" + "+".join(f'COUNTIF({QT}!F5:F{q_end},"{s}")' for s in ["Submitted", "Under Review", "Negotiation", "Won", "Lost"]), "0", CALC),
        ("Quotation Value", f'=SUMIFS({QT}!E5:E{q_end},{QT}!F5:F{q_end},"<>Draft")', PESO, CALC),
        ("Decided Quotations", f'=COUNTIF({QT}!F5:F{q_end},"Won")+COUNTIF({QT}!F5:F{q_end},"Lost")', "0", CALC),
        ("Quotation Win Rate", f'=IFERROR(COUNTIF({QT}!F5:F{q_end},"Won")/B17,0)', PCT, CALC),
        ("Number of Active Accounts", f'=COUNTIF({AC}!M5:M{acc_end},"Active")', "0", CALC),
        ("Accounts with Sales", f'=COUNTIF({AC}!F5:F{acc_end},">0")', "0", CALC),
    ]
    for i, row in enumerate(rows):
        if not row:
            continue
        r = 4 + i
        label, val, fmt, fill = row
        a = kd.cell(row=r, column=1, value=label)
        a.font = Font(name="Aptos", size=11, bold=True, color=NAVY)
        b = kd.cell(row=r, column=2, value=val)
        b.font = Font(name="Aptos", size=11, bold=True, color=INK)
        b.fill = PatternFill("solid", fgColor=fill)
        b.number_format = fmt
    kd["A22"] = "Sales target by account tier" + (" (A Major, B Minor, C Developing)" if book else "")
    kd["A22"].font = Font(name="Aptos", size=12, bold=True, color=RED)
    _header(kd, 23, ["Tier", "Accounts", "Target", "Actual", "Achievement"])
    for i, t in enumerate(["A", "B", "C"]):
        r = 24 + i
        _cell(kd, r, 1, t, bold=True)
        _cell(kd, r, 2, f"=COUNTIF({AC}!D5:D{acc_end},A{r})", "0")
        _cell(kd, r, 3, f"=SUMIF({AC}!D5:D{acc_end},A{r},{AC}!E5:E{acc_end})", PESO)
        _cell(kd, r, 4, f"=SUMIF({AC}!D5:D{acc_end},A{r},{AC}!F5:F{acc_end})", PESO)
        _cell(kd, r, 5, f"=IFERROR(D{r}/C{r},0)", PCT)
    kd["A28"] = "Dashboard note"
    kd["A28"].font = Font(name="Aptos", size=10, bold=True, color=NAVY)
    kd["B28"] = ("Sales are the portal's sales orders, before VAT, on their order date. Cost and gross profit come from the cost sheets."
                 if cost else "Sales are the portal's sales orders, before VAT, on their order date.")
    kd["B28"].font = Font(name="Aptos", size=10, color=INK)
    kd["B28"].alignment = Alignment(wrap_text=True, vertical="top")
    kd.merge_cells("B28:H28")
    kd.row_dimensions[28].height = 34
    kd.freeze_panes = "A4"

    # ── 50 Customer Accounts ─────────────────────────────────────────────────────────────────────
    ac = wb.create_sheet("50 Customer Accounts")
    _title(ac, f"{len(accounts)} Customer Account Plan — {who}",
           ("From the Client Book, Major first (tier A), then Minor (B) and Developing (C). Target as on the Sales plan; change the yellow cells if a customer's potential differs."
            if book else "From the Client Book, in follow-up rank order. Tier and target as on the Sales plan; change the yellow cells if a customer's potential differs."), 13)
    _widths(ac, [15, 30, 22, 10, 18, 18, 18, 13, 28, 14, 14, 36, 14])
    _header(ac, 4, ["Account ID", "Customer Name", "Industry / Sector", "Account Tier", "Annual Sales Target", "Actual Sales YTD", "Remaining Target",
                    "Achievement %", "Primary Contact", "Last Visit", "Next Visit", "Products / Opportunity Focus", "Account Status"])
    for i in range(n_acc):
        r, band = 5 + i, i % 2 == 1
        a = accounts[i] if i < len(accounts) else None
        c = (a or {}).get("contact") or {}
        contact = ", ".join(x for x in [_s(c.get("name")), _s(c.get("position")), _s(c.get("phone")) or _s(c.get("email"))] if x)
        focus = _s((a or {}).get("focus")) or ("Suggested: " + "; ".join((a or {}).get("focusHints") or []) if (a or {}).get("focusHints") else "")
        _cell(ac, r, 1, _s(a.get("clientNo")) if a else f"CUST-{i + 1:03d}", band=band)
        _cell(ac, r, 2, _s(a.get("company")) if a else None, band=band)
        _cell(ac, r, 3, _s(a.get("sector")) if a else None, band=band)
        t = _cell(ac, r, 4, _s(a.get("tier")) or None if a else None, band=band)
        t.fill = PatternFill("solid", fgColor=INPUT)
        g = _cell(ac, r, 5, (_n(a.get("target")) or 0) if a else None, PESO, band=band)
        g.fill = PatternFill("solid", fgColor=INPUT)
        _cell(ac, r, 6, f"=SUMIF({SL}!$B$5:$B${sales_end},B{r},{SL}!$E$5:$E${sales_end})", PESO, band=band)
        _cell(ac, r, 7, f"=E{r}-F{r}", PESO, band=band)
        _cell(ac, r, 8, f"=IFERROR(F{r}/E{r},0)", PCT, band=band)
        _cell(ac, r, 9, contact or None, band=band)
        _cell(ac, r, 10, _d(a.get("lastVisit")) if a else None, DAY, band=band)
        _cell(ac, r, 11, _d(a.get("nextVisit")) if a else None, DAY, band=band)
        _cell(ac, r, 12, focus or None, band=band)
        _cell(ac, r, 13, _s(a.get("status")) if a else None, band=band)
    _list(ac, ["A", "B", "C"], f"D5:D{acc_end}")
    _list(ac, STATUSES, f"M5:M{acc_end}")
    _table(ac, "CustomerAccounts", f"A4:M{acc_end}")
    ac.freeze_panes = "A5"

    # ── Monthly Targets ──────────────────────────────────────────────────────────────────────────
    mt = wb.create_sheet("Monthly Targets")
    _title(mt, f"{year} Monthly Sales Targets — {who}",
           "The month split as set on the Sales plan (edit the yellow cells; they should add up to 100%). Actual sales are the Sales Log by order date.", 6)
    _widths(mt, [15, 20, 20, 20, 20, 18])
    _header(mt, 4, ["Month", "Target Allocation %", "Sales Target", "Actual Sales", "Variance", "Achievement %"])
    for m in range(12):
        r, band = 5 + m, m % 2 == 1
        _cell(mt, r, 1, MONTHS[m], band=band)
        s = _cell(mt, r, 2, shares[m] if m < len(shares) else 0, PCT, band=band)
        s.fill = PatternFill("solid", fgColor=INPUT)
        _cell(mt, r, 3, f"=B{r}*'KPI Dashboard'!$B$5", PESO, band=band)
        _cell(mt, r, 4, f'=SUMIFS({SL}!$E$5:$E${sales_end},{SL}!$A$5:$A${sales_end},">="&DATE({year},{m + 1},1),{SL}!$A$5:$A${sales_end},"<"&DATE({year},{m + 2},1))', PESO, band=band)
        _cell(mt, r, 5, f"=D{r}-C{r}", PESO, band=band)
        _cell(mt, r, 6, f"=IFERROR(D{r}/C{r},0)", PCT, band=band)
    for col, f, fmt in [(1, "TOTAL", None), (2, "=SUM(B5:B16)", PCT), (3, "=SUM(C5:C16)", PESO), (4, "=SUM(D5:D16)", PESO), (5, "=D17-C17", PESO), (6, "=IFERROR(D17/C17,0)", PCT)]:
        _cell(mt, 17, col, f, fmt, bold=True)
    mt.freeze_panes = "A5"

    # ── Sales Log ────────────────────────────────────────────────────────────────────────────────
    sl = wb.create_sheet("Sales Log")
    _title(sl, f"Sales Log — {who}, {year}",
           "Every sales order of the year on its date, at its total before VAT, as the portal credits it. A sale on one of the accounts carries the account's name "
           "(so the account sheet totals it); the order's own spelling is in Notes." + ("" if cost else " Cost of sales is not included in a rep's copy."), 10)
    _widths(sl, [15, 30, 26, 34, 17, 17, 17, 14, 18, 40])
    _header(sl, 4, ["Order Date", "Customer Name", "Invoice / PO No.", "Product / Service", "Sales Amount", "Cost of Sales", "Gross Profit", "Gross Margin %",
                    "Payment Status", "Notes"])
    for i in range(n_sales):
        r, band = 5 + i, i % 2 == 1
        s = sales[i] if i < len(sales) else None
        if s:
            acct = by_no.get(s.get("clientNo"))
            name = _s(acct.get("company")) if acct else _s(s.get("customer"))
            refs = " · ".join(x for x in ["SO " + _s(s.get("soNo")), ("PO " + _s(s.get("poNo"))) if _s(s.get("poNo")) and _s(s.get("poNo")) != _s(s.get("soNo")) else "",
                                          ("INV " + ", ".join(s.get("invNos") or [])) if s.get("invNos") else ""] if x)
            notes = "; ".join(x for x in [
                ("Order to " + _s(s.get("customer"))) if acct and _s(s.get("customer")) != name else "",
                ("Quotation " + _s(s.get("quotationNo"))) if _s(s.get("quotationNo")) else ("Credited through the Client Book" if s.get("via") == "client book" else ""),
                "Customer in two reps' books; credited by the last quotation" if s.get("shared") else "",
                (f"₱{_n(s.get('outstanding')):,.2f} to collect") if _n(s.get("outstanding")) else ""] if x)
        _cell(sl, r, 1, _d(s.get("date")) if s else None, DAY, band=band)
        _cell(sl, r, 2, name if s else None, band=band)
        _cell(sl, r, 3, refs if s else None, band=band)
        _cell(sl, r, 4, _s(s.get("products")) or None if s else None, band=band)
        _cell(sl, r, 5, _n(s.get("amount")) if s else None, PESO2, band=band)
        _cell(sl, r, 6, (_n(s.get("cost")) if cost and s and s.get("cost") is not None else None), PESO2, band=band)
        _cell(sl, r, 7, f'=IF(OR(E{r}="",F{r}=""),"",E{r}-F{r})', PESO2, band=band)
        _cell(sl, r, 8, f'=IFERROR(G{r}/E{r},0)', PCT, band=band)
        _cell(sl, r, 9, _s(s.get("payment")) or None if s else None, band=band)
        _cell(sl, r, 10, notes or None if s else None, band=band)
    _list(sl, PAYMENTS, f"I5:I{sales_end}")
    _table(sl, "SalesLog", f"A4:J{sales_end}")
    sl.freeze_panes = "A5"

    # ── Sales Pipeline ───────────────────────────────────────────────────────────────────────────
    pp = wb.create_sheet("Sales Pipeline")
    _title(pp, f"Sales Pipeline — {who}",
           "Open quotations and purchase requests from the portal, leads typed on the Sales plan, and this year's closed quotations. Weighted value = value × probability.", 12)
    _widths(pp, [24, 30, 34, 20, 19, 18, 13, 19, 16, 22, 34, 16])
    _header(pp, 4, ["Opportunity ID", "Customer Name", "Opportunity / Project", "Product Category", "Opportunity Value", "Stage", "Probability %", "Weighted Value",
                    "Expected Close Date", "Decision Maker", "Next Action", "Next Action Date"])
    for i in range(n_pipe):
        r, band = 5 + i, i % 2 == 1
        o = pipe[i] if i < len(pipe) else None
        closed = o and _s(o.get("stage")).startswith("Closed")
        _cell(pp, r, 1, _s(o.get("recordNo")) if o else f"OPP-{i + 1:03d}", band=band)
        _cell(pp, r, 2, _s(o.get("company")) or None if o else None, band=band)
        _cell(pp, r, 3, (_s(o.get("project")) or ("Purchase request" if o.get("source") == "request" else None)) if o else None, band=band)
        _cell(pp, r, 4, _s(o.get("category")) or None if o else None, band=band)
        _cell(pp, r, 5, _n(o.get("value")) if o else None, PESO, band=band)
        _cell(pp, r, 6, _s(o.get("stage")) or None if o else None, band=band)
        _cell(pp, r, 7, (_n(o.get("probability")) or 0) / 100 if o else None, PCT, band=band)
        _cell(pp, r, 8, f'=IF(OR(E{r}="",G{r}=""),"",E{r}*G{r})', PESO, band=band)
        _cell(pp, r, 9, (_d(o.get("closedAt")) if closed else _d(o.get("expectedClose"))) if o else None, DAY, band=band)
        _cell(pp, r, 10, _s(o.get("decisionMaker")) or None if o else None, band=band)
        _cell(pp, r, 11, _s(o.get("nextAction")) or None if o else None, band=band)
        _cell(pp, r, 12, _d(o.get("nextActionDate")) if o else None, DAY, band=band)
    _list(pp, STAGES, f"F5:F{pipe_end}")
    dv = DataValidation(type="decimal", operator="between", formula1="0", formula2="1", allow_blank=True)
    dv.add(f"G5:G{pipe_end}")
    pp.add_data_validation(dv)
    _table(pp, "SalesPipeline", f"A4:L{pipe_end}")
    pp.freeze_panes = "A5"

    # ── Daily Activity ───────────────────────────────────────────────────────────────────────────
    da = wb.create_sheet("Daily Activity")
    _title(da, f"Daily Sales Activity Report — {who}",
           f"The daily reports from {_s(activity.get('from')) or '—'} to {_s(activity.get('to')) or '—'}: calls, visits, meetings, surveys and follow-ups with their outcome "
           "and next action, each day's sent emails, visits marked done and the older call log.", 10)
    _widths(da, [15, 22, 28, 22, 36, 30, 30, 16, 18, 30])
    _header(da, 4, ["Date", "Sales Executive", "Customer Name", "Activity Type", "Purpose / Customer Need", "Outcome", "Next Action", "Next Action Date",
                    "Opportunity Value", "Notes"])
    for i in range(n_act):
        r, band = 5 + i, i % 2 == 1
        x = acts[i] if i < len(acts) else None
        purpose = " · ".join(y for y in [_s(x.get("purpose")), _s(x.get("person"))] if y) if x else ""
        note = " · ".join(y for y in [_s(x.get("source")) if x and x.get("source") != "Daily report" else "", _s(x.get("linkLabel")) or _s(x.get("linkId"))] if y) if x else ""
        _cell(da, r, 1, _d(x.get("date")) if x else None, DAY, band=band)
        _cell(da, r, 2, who if x else None, band=band)
        _cell(da, r, 3, _s(x.get("company")) or None if x else None, band=band)
        _cell(da, r, 4, _ACT_MAP.get(_s(x.get("type")).lower(), "Other Task") if x else None, band=band)
        _cell(da, r, 5, purpose or None, band=band)
        _cell(da, r, 6, _s(x.get("outcome")) or None if x else None, band=band)
        _cell(da, r, 7, _s(x.get("nextAction")) or None if x else None, band=band)
        _cell(da, r, 8, _d(x.get("nextDate")) if x else None, DAY, band=band)
        _cell(da, r, 9, _n(x.get("value")) if x and x.get("value") is not None else None, PESO, band=band)
        _cell(da, r, 10, note or None, band=band)
    _list(da, ACTIVITY_TYPES, f"D5:D{act_end}")
    _table(da, "DailyActivity", f"A4:J{act_end}")
    da.freeze_panes = "A5"

    # ── Quotation Tracker ────────────────────────────────────────────────────────────────────────
    qt = wb.create_sheet("Quotation Tracker")
    _title(qt, f"Quotation Tracker — {who}, {year}",
           "The year's quotations from the portal and where each stands. Days open counts to the decision date, else to today. The opportunity ID matches the Sales Pipeline.", 11)
    _widths(qt, [15, 30, 30, 34, 18, 16, 15, 15, 12, 24, 34])
    _header(qt, 4, ["Quotation Date", "Quotation No.", "Customer Name", "Product / Scope", "Quotation Value", "Status", "Follow-up Date", "Decision Date", "Days Open",
                    "Sales Opportunity ID", "Reason / Next Step"])
    for i in range(n_q):
        r, band = 5 + i, i % 2 == 1
        q = quotes[i] if i < len(quotes) else None
        o = stage_of.get(_s(q.get("quotationNo"))) if q else None
        state = _s(q.get("state")) if q else ""
        if o and o.get("stage") == "Negotiation" and state in ("Submitted", "Under Review"):
            state = "Negotiation"
        follow = (_d(o.get("nextActionDate")) if o and o.get("nextActionDate") else _d(q.get("lastFollowUp"))) if q else None
        reason = (_s(q.get("reason")) or (_s(o.get("nextAction")) if o else "") or (("SO " + _s(q.get("soNo"))) if _s(q.get("soNo")) else "")) if q else ""
        _cell(qt, r, 1, _d(q.get("date")) if q else None, DAY, band=band)
        _cell(qt, r, 2, _s(q.get("quotationNo")) if q else None, band=band)
        _cell(qt, r, 3, _s(q.get("customer")) or None if q else None, band=band)
        _cell(qt, r, 4, _s(q.get("subject")) or None if q else None, band=band)
        _cell(qt, r, 5, _n(q.get("value")) if q else None, PESO, band=band)
        _cell(qt, r, 6, state or None, band=band)
        _cell(qt, r, 7, follow, DAY, band=band)
        _cell(qt, r, 8, _d(q.get("decidedAt")) if q else None, DAY, band=band)
        _cell(qt, r, 9, f'=IF(A{r}="","",IF(H{r}="",TODAY()-A{r},H{r}-A{r}))', "0", band=band)
        _cell(qt, r, 10, (_s(q.get("quotationNo")) if o or state in ("Won", "Lost") else None) if q else None, band=band)
        _cell(qt, r, 11, reason or None, band=band)
    _list(qt, Q_STATES, f"F5:F{q_end}")
    _table(qt, "QuotationTracker", f"A4:K{q_end}")
    qt.freeze_panes = "A5"

    # ── Action Tracker (left for the review's commitments) ──────────────────────────────────────
    at = wb.create_sheet("Action Tracker")
    _title(at, "Sales Action Tracker", "Record management commitments and follow-up actions from weekly and monthly reviews.", 8)
    _widths(at, [12, 15, 28, 40, 18, 15, 16, 36])
    _header(at, 4, ["Action ID", "Date Raised", "Customer / Topic", "Action Required", "Owner", "Due Date", "Status", "Comments / Result"])
    for i in range(100):
        r, band = 5 + i, i % 2 == 1
        _cell(at, r, 1, f"ACT-{i + 1:03d}", band=band)
        for col in range(2, 9):
            _cell(at, r, col, None, DAY if col in (2, 6) else None, band=band)
    _list(at, ["Not Started", "In Progress", "Waiting", "Completed", "Cancelled"], "G5:G104")
    _table(at, "ActionTracker", "A4:H104")
    at.freeze_panes = "A5"

    wb.calculation.fullCalcOnLoad = True
    out = BytesIO()
    wb.save(out)
    return out.getvalue()
