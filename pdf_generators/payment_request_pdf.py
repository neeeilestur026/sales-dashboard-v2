"""PaymentRequestDocTemplate -- ReportLab BaseDocTemplate for Payment Request PDFs."""

import os
import logging

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, PageTemplate,
    Table, TableStyle, Paragraph, Spacer,
)
from reportlab.lib.styles import ParagraphStyle
from PIL import Image as PILImage

from pdf_generators.utils import get_static_path, ph_date_long

logger = logging.getLogger(__name__)


# ── Shared styles ────────────────────────────────────────────────────
BRAND_BLUE = colors.HexColor("#1e40af")
BRAND_BLUE_LIGHT = colors.HexColor("#dbeafe")
HEADER_BG = colors.HexColor("#1e3a5f")
HEADER_TEXT = colors.white
ROW_ALT = colors.HexColor("#f8fafc")
BORDER_COLOR = colors.HexColor("#cbd5e1")


def _fmt_date(raw):
    """A179 — one shared formatter. The local copy parsed with dateutil but never converted the zone,
    so a Manila-midnight timestamp ('…T16:00Z') printed the day BEFORE. A bare YYYY-MM-DD from the
    legacy form resolves identically, so that output is unchanged."""
    return ph_date_long(raw, default=("" if not raw else str(raw)))


def _fmt_currency(raw):
    if not raw:
        return ""
    try:
        val = float(str(raw).replace(",", ""))
        return f"{val:,.2f}"
    except (ValueError, TypeError):
        return str(raw)


# A180 — the portion a payment request covers. 'Custom' reads as "Partial" on the document: the payer
# does not care that it was hand-typed, only that it is not the whole PO.
_PORTION_LABELS = {
    "50% DP": "50% Down Payment",
    "Balance": "Balance Payment",
    "Full": "Full Payment",
    "Custom": "Partial Payment",
}


def _to_float(raw):
    """A180 — a number from a form field, or 0.0. Never raises: an unreadable snapshot must degrade to
    'print the label without figures', not to a 500 on a document someone is waiting for."""
    if raw is None or raw == "":
        return 0.0
    try:
        return float(str(raw).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _label_style():
    return ParagraphStyle(
        "label", fontName="Helvetica-Bold", fontSize=8.5,
        textColor=colors.HexColor("#334155"), leading=11,
    )


def _value_style():
    return ParagraphStyle(
        "value", fontName="Helvetica", fontSize=9,
        textColor=colors.black, leading=12,
    )


def _section_title_style():
    return ParagraphStyle(
        "section_title", fontName="Helvetica-Bold", fontSize=10,
        textColor=BRAND_BLUE, leading=14, spaceAfter=4,
    )


def build_payment_request_pdf(buffer, details, supporting_docs=None):
    """Build a Payment Request PDF into the given BytesIO buffer.

    Args:
        buffer: BytesIO object to write PDF into
        details: dict with all payment request fields
        supporting_docs: list of dicts with 'filename' and 'data' (bytes) keys
    """
    PAGE_W, PAGE_H = A4

    doc = BaseDocTemplate(
        buffer, pagesize=A4,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
    )

    frame_w = PAGE_W - doc.leftMargin - doc.rightMargin

    frame = Frame(
        doc.leftMargin, doc.bottomMargin,
        frame_w, PAGE_H - doc.topMargin - doc.bottomMargin,
        id="content",
    )

    def _header_footer(canvas, doc_obj):
        canvas.saveState()
        # Footer
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawCentredString(
            PAGE_W / 2, 0.3 * inch,
            f"Payment Request — Generated {_fmt_date(details.get('request_date', ''))}"
        )
        canvas.restoreState()

    doc.addPageTemplates([
        PageTemplate(id="Main", frames=[frame], onPage=_header_footer)
    ])

    elements = []
    ls = _label_style()
    vs = _value_style()
    sts = _section_title_style()

    # ── Watermark ────────────────────────────────────────────────
    # (handled in onPage if needed, but we keep it simple)

    # ── Logo + Title Header ──────────────────────────────────────
    logo_path = get_static_path("images", "logo.png")
    header_parts = []

    if os.path.exists(logo_path):
        try:
            logo = Image(logo_path, width=2.0 * inch, height=0.56 * inch)
            header_parts.append(logo)
        except Exception:
            header_parts.append(Paragraph("", vs))
    else:
        header_parts.append(Paragraph("", vs))

    title_style = ParagraphStyle(
        "title", fontName="Helvetica-Bold", fontSize=16,
        textColor=HEADER_BG, alignment=2, leading=20,
    )
    header_parts.append(Paragraph("PAYMENT REQUEST", title_style))

    header_table = Table(
        [header_parts],
        colWidths=[frame_w * 0.5, frame_w * 0.5],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 0.15 * inch))

    # ── Divider line ─────────────────────────────────────────────
    div_table = Table([[""]], colWidths=[frame_w], rowHeights=[2])
    div_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 2, BRAND_BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(div_table)
    elements.append(Spacer(1, 0.2 * inch))

    # ── Helper: key-value info rows ──────────────────────────────
    def _info_section(title, rows):
        """Build a section with title and key-value pairs.
        rows: list of (label, value) tuples; 2 per row displayed side by side.
        """
        elements.append(Paragraph(title, sts))
        elements.append(Spacer(1, 0.05 * inch))

        # Build 2-column layout
        table_rows = []
        for i in range(0, len(rows), 2):
            left = rows[i]
            right = rows[i + 1] if i + 1 < len(rows) else ("", "")

            row_data = [
                Paragraph(left[0], ls),
                Paragraph(str(left[1]) if left[1] else "", vs),
                Paragraph(right[0], ls),
                Paragraph(str(right[1]) if right[1] else "", vs),
            ]
            table_rows.append(row_data)

        col_w = frame_w / 4
        t = Table(table_rows, colWidths=[col_w * 0.8, col_w * 1.2, col_w * 0.8, col_w * 1.2])

        style_cmds = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ]
        # Alternate row shading
        for idx in range(len(table_rows)):
            if idx % 2 == 0:
                style_cmds.append(("BACKGROUND", (0, idx), (-1, idx), ROW_ALT))

        t.setStyle(TableStyle(style_cmds))
        elements.append(t)
        elements.append(Spacer(1, 0.2 * inch))

    # ── 1. Request Details ───────────────────────────────────────
    _info_section("REQUEST DETAILS", [
        ("Request Date:", _fmt_date(details.get("request_date", ""))),
        ("PR Number:", details.get("pr_number", "")),
        ("Requested By:", details.get("requested_by", "")),
        ("Department:", details.get("department", "")),
        ("Purpose:", details.get("purpose", "")),
        ("Priority:", details.get("priority", "")),
    ])

    # ── 2. Payee Information ─────────────────────────────────────
    _info_section("PAYEE INFORMATION", [
        ("Payee Name:", details.get("payee_name", "")),
        ("Payee Type:", details.get("payee_type", "")),
        ("Bank Name:", details.get("bank_name", "")),
        ("Bank Branch:", details.get("bank_branch", "")),
        ("Account Name:", details.get("account_name", "")),
        ("Account Number:", details.get("account_number", "")),
    ])

    # ── 3. Payment Information ───────────────────────────────────
    amt_style = ParagraphStyle(
        "amount", fontName="Helvetica-Bold", fontSize=11,
        textColor=BRAND_BLUE, leading=14,
    )

    _info_section("PAYMENT INFORMATION", [
        ("Payment Method:", details.get("payment_method", "")),
        ("Currency:", details.get("currency", "PHP")),
        ("Amount:", _fmt_currency(details.get("amount", ""))),
        ("Due Date:", _fmt_date(details.get("due_date", ""))),
    ])

    # Amount highlight box
    amt_val = _fmt_currency(details.get("amount", ""))
    currency = details.get("currency", "PHP")
    if amt_val:
        amt_box_data = [[
            Paragraph("TOTAL AMOUNT", ParagraphStyle(
                "amt_label", fontName="Helvetica-Bold", fontSize=8,
                textColor=colors.HexColor("#1e40af"), leading=10,
            )),
            Paragraph(f"{currency} {amt_val}", ParagraphStyle(
                "amt_value", fontName="Helvetica-Bold", fontSize=14,
                textColor=colors.HexColor("#1e40af"), alignment=2, leading=18,
            )),
        ]]
        amt_box = Table(amt_box_data, colWidths=[frame_w * 0.4, frame_w * 0.6])
        amt_box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eff6ff")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#93c5fd")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        elements.append(amt_box)

        # ── A222: the peso ESTIMATE beneath a foreign obligation ──
        # The box above now prints the real obligation — "USD 202.00" — because a foreign purchase is
        # owed in the supplier's currency. The peso figure that used to stand in its place was an
        # estimate derived from a rate typed when the order was raised, and printing it as though it
        # were the amount is what let an estimate be mistaken for a cost all the way to the ledger.
        # Printed only when there IS an estimate and the request is genuinely foreign: a PHP request
        # is unchanged, down to the byte.
        est_php = _to_float(details.get("amount_php_est"))
        if est_php > 0 and str(currency).upper() != "PHP":
            elements.append(Paragraph(
                f"Estimated cost &asymp; PHP {est_php:,.2f} &mdash; an estimate only. "
                f"The peso figure is set by the bank on the day of the transfer.",
                ParagraphStyle(
                    "fx_est", fontName="Helvetica-Oblique", fontSize=8.5,
                    textColor=colors.HexColor("#1e40af"), leading=11, alignment=2,
                )))

        # ── A180: which slice of the PO this payment is ───────────
        # Deliberately NOT a fifth tuple in the PAYMENT INFORMATION section above: that list is
        # consumed two-at-a-time, so a fifth entry would add a shaded table row even when blank and
        # would move the legacy /payment-request/ output. A gated paragraph adds nothing when the
        # keys are absent, which is exactly the state of every pre-A180 record and every non-PO
        # payable. Inside `if amt_val:` because a portion without an amount says nothing, and before
        # the Spacer so the section's spacing is unchanged.
        portion = str(details.get("payment_portion", "") or "").strip()
        if portion:
            label = _PORTION_LABELS.get(portion, portion)
            po_total = _to_float(details.get("po_total"))
            po_paid = _to_float(details.get("po_paid_before"))
            this_amt = _to_float(details.get("amount"))
            # Gate on the SNAPSHOT, not just the portion: a legacy row or an 'Other' payable carries
            # 0 here, and printing "PO total 0.00" would be worse than printing nothing.
            if po_total > 0:
                balance = max(0.0, po_total - po_paid - this_amt)
                label += (f" — PO total {currency} {po_total:,.2f}, "
                          f"balance {currency} {balance:,.2f}")
            elements.append(Paragraph(label, ParagraphStyle(
                "portion", fontName="Helvetica-Oblique", fontSize=8.5,
                textColor=colors.HexColor("#1e40af"), leading=11, alignment=2,
                spaceBefore=3,
            )))

        elements.append(Spacer(1, 0.2 * inch))

    # ── 4. Remarks / Notes ───────────────────────────────────────
    remarks = details.get("remarks", "").strip()
    if remarks:
        elements.append(Paragraph("REMARKS", sts))
        elements.append(Spacer(1, 0.05 * inch))
        remarks_style = ParagraphStyle(
            "remarks", fontName="Helvetica", fontSize=9,
            textColor=colors.black, leading=13,
            borderPadding=8, backColor=colors.HexColor("#f8fafc"),
        )
        elements.append(Paragraph(remarks, remarks_style))
        elements.append(Spacer(1, 0.2 * inch))

    # ── 5. Supporting Documents List ─────────────────────────────
    if supporting_docs:
        elements.append(Paragraph("SUPPORTING DOCUMENTS", sts))
        elements.append(Spacer(1, 0.05 * inch))
        doc_rows = [[
            Paragraph("#", ParagraphStyle("dh", fontName="Helvetica-Bold", fontSize=8, textColor=HEADER_TEXT)),
            Paragraph("Document Name", ParagraphStyle("dh2", fontName="Helvetica-Bold", fontSize=8, textColor=HEADER_TEXT)),
        ]]
        for idx, sd in enumerate(supporting_docs, 1):
            doc_rows.append([
                Paragraph(str(idx), vs),
                Paragraph(sd.get("filename", "Untitled"), vs),
            ])
        doc_table = Table(doc_rows, colWidths=[frame_w * 0.1, frame_w * 0.9])
        doc_style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), HEADER_TEXT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ]
        for idx in range(1, len(doc_rows)):
            if idx % 2 == 0:
                doc_style_cmds.append(("BACKGROUND", (0, idx), (-1, idx), ROW_ALT))
        doc_table.setStyle(TableStyle(doc_style_cmds))
        elements.append(doc_table)
        elements.append(Spacer(1, 0.3 * inch))

    # ── 6. Approval Signatures ───────────────────────────────────
    elements.append(Spacer(1, 0.4 * inch))

    sig_label = ParagraphStyle("sig_l", fontName="Helvetica-Bold", fontSize=8, textColor=colors.HexColor("#475569"))
    sig_name = ParagraphStyle("sig_n", fontName="Helvetica", fontSize=9, textColor=colors.black, alignment=1)
    sig_pos = ParagraphStyle("sig_p", fontName="Helvetica-Oblique", fontSize=7.5, textColor=colors.HexColor("#64748b"), alignment=1)

    line_w = 1.8 * inch

    def _sig_block(label_text, name_text="", pos_text=""):
        underline = Table([[""]], colWidths=[line_w], rowHeights=[0.5])
        underline.setStyle(TableStyle([
            ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.black),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        parts = [
            [Spacer(1, 0.35 * inch)],
            [underline],
            [Paragraph(name_text or "&nbsp;", sig_name)],
            [Paragraph(pos_text or "&nbsp;", sig_pos)],
            [Spacer(1, 0.04 * inch)],
            [Paragraph(f"<b>{label_text}</b>", sig_label)],
        ]
        t = Table(parts, colWidths=[line_w])
        t.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        return t

    requested_by_name = details.get("requested_by", "")
    requested_by_pos = details.get("department", "")

    sig_data = [[
        _sig_block("Requested by:", requested_by_name, requested_by_pos),
        _sig_block("Approved by:"),
        _sig_block("Received by:"),
    ]]
    sig_table = Table(sig_data, colWidths=[frame_w / 3] * 3)
    sig_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(sig_table)

    doc.build(elements)
