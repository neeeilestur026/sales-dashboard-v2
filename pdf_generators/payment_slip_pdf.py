"""Payment Slip PDF — auto-generated when a Payment Request is marked Paid."""

import os
import logging
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, PageTemplate,
    Table, TableStyle, Paragraph, Spacer,
)
from reportlab.lib.styles import ParagraphStyle
from dateutil.parser import parse as dateutil_parse

from pdf_generators.utils import get_static_path

logger = logging.getLogger(__name__)

BRAND_BLUE  = colors.HexColor("#1e40af")
BRAND_GREEN = colors.HexColor("#16a34a")
HEADER_BG   = colors.HexColor("#1e3a5f")
HEADER_TEXT = colors.white
ROW_ALT     = colors.HexColor("#f8fafc")
BORDER_COL  = colors.HexColor("#cbd5e1")


def _fmt_date(raw):
    if not raw:
        return ""
    try:
        return dateutil_parse(str(raw)).strftime("%B %d, %Y")
    except Exception:
        return str(raw)


def _fmt_currency(raw):
    if not raw:
        return ""
    try:
        return f"{float(str(raw).replace(',', '')):,.2f}"
    except (ValueError, TypeError):
        return str(raw)


def _lbl():
    return ParagraphStyle(
        "lbl", fontName="Helvetica-Bold", fontSize=8.5,
        textColor=colors.HexColor("#334155"), leading=11,
    )


def _val():
    return ParagraphStyle(
        "val", fontName="Helvetica", fontSize=9,
        textColor=colors.black, leading=12,
    )


def _sec():
    return ParagraphStyle(
        "sec", fontName="Helvetica-Bold", fontSize=10,
        textColor=BRAND_BLUE, leading=14, spaceAfter=4,
    )


def build_payment_slip_pdf(buffer, details: dict, paid_at: str = "", paid_by: str = ""):
    """Build a Payment Slip PDF into the given BytesIO buffer.

    Args:
        buffer:    BytesIO to write into
        details:   dict — same shape as handleGetBillingRecords row
        paid_at:   ISO timestamp of when payment was marked
        paid_by:   name/email of who marked it paid
    """
    PAGE_W, PAGE_H = A4

    doc = BaseDocTemplate(
        buffer, pagesize=A4,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
    )
    frame_w = PAGE_W - doc.leftMargin - doc.rightMargin

    slip_no = details.get("pr_number", "")

    def _on_page(canvas, doc_obj):
        canvas.saveState()

        # PAID watermark (diagonal, large, light)
        canvas.saveState()
        canvas.translate(PAGE_W / 2, PAGE_H / 2)
        canvas.rotate(45)
        canvas.setFont("Helvetica-Bold", 90)
        canvas.setFillColor(colors.HexColor("#bbf7d0"))
        canvas.setFillAlpha(0.35)
        canvas.drawCentredString(0, 0, "PAID")
        canvas.restoreState()

        # Footer
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawCentredString(
            PAGE_W / 2, 0.3 * inch,
            f"Payment Slip {slip_no}  |  Processed {_fmt_date(paid_at) or _fmt_date(details.get('paid_at',''))}"
        )
        canvas.restoreState()

    doc.addPageTemplates([
        PageTemplate(id="Main",
                     frames=[Frame(doc.leftMargin, doc.bottomMargin,
                                   frame_w, PAGE_H - doc.topMargin - doc.bottomMargin,
                                   id="content")],
                     onPage=_on_page)
    ])

    elements = []
    ls = _lbl()
    vs = _val()
    sts = _sec()

    # ── Logo + Title ────────────────────────────────────────────
    logo_path = get_static_path("images", "logo.png")
    logo_cell = Paragraph("", vs)
    if os.path.exists(logo_path):
        try:
            logo_cell = Image(logo_path, width=2.0 * inch, height=0.56 * inch)
        except Exception:
            pass

    title_style = ParagraphStyle(
        "title", fontName="Helvetica-Bold", fontSize=18,
        textColor=BRAND_GREEN, alignment=2, leading=22,
    )
    sub_style = ParagraphStyle(
        "sub", fontName="Helvetica", fontSize=9,
        textColor=colors.HexColor("#475569"), alignment=2, leading=13,
    )

    hdr = Table(
        [[logo_cell, [Paragraph("PAYMENT SLIP", title_style),
                      Paragraph(f"Ref: {slip_no}", sub_style)]]],
        colWidths=[frame_w * 0.45, frame_w * 0.55],
    )
    hdr.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(hdr)
    elements.append(Spacer(1, 0.12 * inch))

    # Green divider
    div = Table([[""]], colWidths=[frame_w], rowHeights=[3])
    div.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 3, BRAND_GREEN),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(div)
    elements.append(Spacer(1, 0.15 * inch))

    # PAID badge box
    paid_style = ParagraphStyle(
        "paid_badge", fontName="Helvetica-Bold", fontSize=13,
        textColor=BRAND_GREEN, alignment=1, leading=18,
    )
    paid_date_style = ParagraphStyle(
        "paid_date", fontName="Helvetica", fontSize=8.5,
        textColor=colors.HexColor("#475569"), alignment=1, leading=12,
    )
    paid_at_display = _fmt_date(paid_at) or _fmt_date(details.get("paid_at", ""))
    paid_by_display = paid_by or details.get("paid_by", "")

    badge = Table([[
        Paragraph("✔ PAYMENT CONFIRMED", paid_style),
        Paragraph(
            f"Date: {paid_at_display}<br/>Processed by: {paid_by_display}",
            paid_date_style
        ),
    ]], colWidths=[frame_w * 0.5, frame_w * 0.5])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ("BOX", (0, 0), (-1, -1), 1.5, BRAND_GREEN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(badge)
    elements.append(Spacer(1, 0.2 * inch))

    # ── Helper: 2-column info section ───────────────────────────
    def _section(title, rows):
        elements.append(Paragraph(title, sts))
        elements.append(Spacer(1, 0.04 * inch))
        table_rows = []
        for idx in range(0, len(rows), 2):
            left  = rows[idx]
            right = rows[idx + 1] if idx + 1 < len(rows) else ("", "")
            table_rows.append([
                Paragraph(left[0],              ls),
                Paragraph(str(left[1] or ""),  vs),
                Paragraph(right[0],             ls),
                Paragraph(str(right[1] or ""), vs),
            ])
        cw = frame_w / 4
        t = Table(table_rows, colWidths=[cw * 0.8, cw * 1.2, cw * 0.8, cw * 1.2])
        cmds = [
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW",     (0, 0), (-1, -1), 0.5, BORDER_COL),
        ]
        for i in range(len(table_rows)):
            if i % 2 == 0:
                cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
        t.setStyle(TableStyle(cmds))
        elements.append(t)
        elements.append(Spacer(1, 0.18 * inch))

    _section("REQUEST DETAILS", [
        ("Request Date:",  _fmt_date(details.get("request_date", ""))),
        ("PR Number:",     details.get("pr_number", "")),
        ("Requested By:",  details.get("requested_by", "")),
        ("Department:",    details.get("department", "")),
        ("Purpose:",       details.get("purpose", "")),
        ("Priority:",      details.get("priority", "")),
    ])

    _section("PAYEE INFORMATION", [
        ("Payee Name:",     details.get("payee_name", "")),
        ("Payee Type:",     details.get("payee_type", "")),
        ("Bank Name:",      details.get("bank_name", "")),
        ("Bank Branch:",    details.get("bank_branch", "")),
        ("Account Name:",   details.get("account_name", "")),
        ("Account Number:", details.get("account_number", "")),
    ])

    _section("PAYMENT INFORMATION", [
        ("Payment Method:", details.get("payment_method", "")),
        ("Currency:",       details.get("currency", "PHP")),
        ("Amount:",         _fmt_currency(details.get("amount", ""))),
        ("Due Date:",       _fmt_date(details.get("due_date", ""))),
    ])

    # Amount highlight
    amt_val  = _fmt_currency(details.get("amount", ""))
    currency = details.get("currency", "PHP")
    if amt_val:
        amt_box = Table([[
            Paragraph("TOTAL AMOUNT PAID", ParagraphStyle(
                "al", fontName="Helvetica-Bold", fontSize=8,
                textColor=BRAND_GREEN, leading=10,
            )),
            Paragraph(f"{currency} {amt_val}", ParagraphStyle(
                "av", fontName="Helvetica-Bold", fontSize=15,
                textColor=BRAND_GREEN, alignment=2, leading=20,
            )),
        ]], colWidths=[frame_w * 0.4, frame_w * 0.6])
        amt_box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#86efac")),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 12),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
            ("TOPPADDING",    (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        elements.append(amt_box)
        elements.append(Spacer(1, 0.25 * inch))

    # ── Remarks ─────────────────────────────────────────────────
    remarks = (details.get("remarks", "") or "").strip()
    if remarks:
        elements.append(Paragraph("REMARKS", sts))
        elements.append(Spacer(1, 0.04 * inch))
        elements.append(Paragraph(remarks, ParagraphStyle(
            "rem", fontName="Helvetica", fontSize=9, textColor=colors.black,
            leading=13, backColor=colors.HexColor("#f8fafc"), borderPadding=8,
        )))
        elements.append(Spacer(1, 0.2 * inch))

    # ── Signatures ───────────────────────────────────────────────
    elements.append(Spacer(1, 0.4 * inch))
    sig_lbl = ParagraphStyle("sl", fontName="Helvetica-Bold", fontSize=8,
                              textColor=colors.HexColor("#475569"))
    sig_nm  = ParagraphStyle("sn", fontName="Helvetica", fontSize=9,
                              textColor=colors.black, alignment=1)
    sig_ps  = ParagraphStyle("sp", fontName="Helvetica-Oblique", fontSize=7.5,
                              textColor=colors.HexColor("#64748b"), alignment=1)

    lw = 1.8 * inch

    def _sig(label, name="", pos=""):
        uline = Table([[""]], colWidths=[lw], rowHeights=[0.5])
        uline.setStyle(TableStyle([
            ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.black),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        t = Table([
            [Spacer(1, 0.35 * inch)],
            [uline],
            [Paragraph(name or "&nbsp;", sig_nm)],
            [Paragraph(pos  or "&nbsp;", sig_ps)],
            [Spacer(1, 0.04 * inch)],
            [Paragraph(f"<b>{label}</b>", sig_lbl)],
        ], colWidths=[lw])
        t.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))
        return t

    sig_row = Table([[
        _sig("Prepared by:", details.get("requested_by", ""), details.get("department", "")),
        _sig("Released by:", paid_by_display, "Accounting"),
        _sig("Received by:"),
    ]], colWidths=[frame_w / 3] * 3)
    sig_row.setStyle(TableStyle([
        ("ALIGN",  (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(sig_row)

    doc.build(elements)
