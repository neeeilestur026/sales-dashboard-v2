"""Flow Purchase-Request PDF renderer.

Produces a PR PDF whose layout is IDENTICAL to the legacy generator
(`blueprints/pr.py` `/pr/generate`) by reusing the same `PRDocTemplate` and
replicating the exact item-table / signature element-building. No Apps Script
dependency — the caller passes pr_details + items.
"""

import re
import html
import logging
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Table, TableStyle, Spacer, PageBreak

from pdf_generators.pr_pdf import PRDocTemplate

logger = logging.getLogger(__name__)


_MAX_DESC_CHARS = 1200   # a description longer than this can't fit a page row — truncate with an ellipsis


def _format_description(description, description_style):
    """Format description text, supporting markdown-like bullets (verbatim from blueprints/pr.py)."""
    if not description or not str(description).strip():
        return Paragraph("", description_style)
    text = str(description)
    if len(text) > _MAX_DESC_CHARS:
        text = text[:_MAX_DESC_CHARS].rstrip() + " …"
    lines = text.splitlines()
    out = []
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            out.append("<br/>")
            continue
        stripped = line.lstrip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            out.append(f"&bull; {html.escape(stripped[2:].strip())}")
        elif re.match(r"^\d+\.\s+", stripped):
            m = re.match(r"^(\d+\.)\s+(.*)$", stripped)
            out.append(f"{m.group(1)} {html.escape(m.group(2).strip())}" if m else html.escape(stripped))
        else:
            leading = len(line) - len(stripped)
            prefix = "&nbsp;" * leading if leading else ""
            out.append(f"{prefix}{html.escape(stripped)}")
    return Paragraph("<br/>".join(out), description_style)


def build_pr_pdf_bytes(pr_details, items, desc_mode="short"):
    """Render the Purchase Request PDF and return its bytes (identical layout to the legacy form).

    items: list of dicts with item_no, item_description, model_no, quantity, unit_of_measure, item_remarks.
    """
    normal_style = ParagraphStyle(name="normal", fontName="Helvetica", fontSize=9, leading=12,
                                  textColor=colors.black, alignment=0, wordWrap="CJK")
    header_style = ParagraphStyle(name="header", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=colors.black, alignment=1)
    description_style = ParagraphStyle(name="description", fontName="Helvetica", fontSize=8, leading=10,
                                       textColor=colors.black, alignment=0, leftIndent=8, wordWrap="CJK")
    sig_label_style = ParagraphStyle(name="sig_label", fontName="Helvetica-Bold", fontSize=9,
                                     textColor=colors.black, alignment=0)
    sig_name_style = ParagraphStyle(name="sig_name", fontName="Helvetica", fontSize=9,
                                    textColor=colors.black, alignment=0)
    sig_pos_style = ParagraphStyle(name="sig_pos", fontName="Helvetica-Oblique", fontSize=8,
                                   textColor=colors.black, alignment=0)
    qty_style = ParagraphStyle(name="qty", fontName="Helvetica", fontSize=9,
                               textColor=colors.black, alignment=1)

    buffer = BytesIO()
    doc = PRDocTemplate(buffer, items_count=len(items), pagesize=A4)
    doc.pr_details = pr_details
    elements = []

    pdf_rows = [
        [
            item.get("item_no", ""),
            _format_description(item.get("item_description", ""), description_style),
            item.get("model_no", ""),
            Paragraph(str(item.get("quantity", "")), qty_style),
            item.get("unit_of_measure", ""),
            item.get("item_remarks", ""),
        ]
        for item in items
    ]

    # ── Geometry shared by measurement + table building ──
    BASE_COL_WIDTHS = [32, 140, 105, 56, 58, 109]
    _scale = doc.frame_width / float(sum(BASE_COL_WIDTHS))
    COL_WIDTHS = [w * _scale for w in BASE_COL_WIDTHS]
    DESC_IDX = 1
    DEFAULT_ROW_H = 38.0
    EXTRA_PAD = 6.0
    HEADER_ROW_H = 38.0
    TRAILING_ROW_H = 38.0
    # Space the last page must reserve below the table: the 0.08+0.2+0.25in spacers plus the
    # signature block (0.5in gap + underline + name/position lines) ≈ 115pt.
    SIG_ALLOWANCE = 115.0

    # Usable frame height: PRDocTemplate's Frame keeps ReportLab's default 6pt top/bottom padding.
    FRAME_PAD = 12.0
    SAFETY = 4.0
    usable_height = doc.frame_height - FRAME_PAD - SAFETY

    def _row_height(row, cap=None):
        """Measured height of a data row (description column drives the wrap)."""
        desc_obj = row[DESC_IDX]
        try:
            wrap_w = max(10, COL_WIDTHS[DESC_IDX] - 8)
            _, h = desc_obj.wrap(wrap_w, 10000) if hasattr(desc_obj, "wrap") else (wrap_w, 0)
        except Exception:
            h = 0
        h = max(DEFAULT_ROW_H, h + EXTRA_PAD)
        # Clamp a pathological single row to what a page can hold (clips rather than crashing the build).
        if cap is not None:
            h = min(h, cap)
        return h

    def create_item_table(data_rows, fill_budget):
        """Build one page's item table. Rows are the real items for this page; empty ruled rows are
        added only while they still fit `fill_budget` (the remaining vertical space) — the old code
        blindly padded to a fixed 10 rows, which overflowed the frame whenever descriptions were tall
        and pushed the signature to an extra page."""
        header_row = [
            Paragraph("Item No.", header_style),
            Paragraph("Item Description", header_style),
            Paragraph("Model / Part No.", header_style),
            Paragraph("Quantity", header_style),
            Paragraph("Unit", header_style),
            Paragraph("Remarks", header_style),
        ]
        empty_row = [Paragraph("", normal_style)] * 6

        visible_rows = list(data_rows)
        row_heights = [_row_height(r, cap=fill_budget) for r in visible_rows]
        # Pad with empty form rows only while they fit the remaining budget (keep at least the real rows).
        used = sum(row_heights)
        while used + DEFAULT_ROW_H <= fill_budget:
            visible_rows.append(empty_row)
            row_heights.append(DEFAULT_ROW_H)
            used += DEFAULT_ROW_H

        table_data = [header_row] + visible_rows
        final_heights = [HEADER_ROW_H] + row_heights
        table_data.append([Paragraph("", normal_style)] * 6)
        final_heights.append(TRAILING_ROW_H)

        table = Table(table_data, colWidths=COL_WIDTHS, rowHeights=final_heights)
        table.setStyle(TableStyle([
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("ALIGN", (0, 1), (0, -2), "CENTER"),
            ("ALIGN", (1, 1), (1, -2), "LEFT"),
            ("ALIGN", (2, 1), (-1, -2), "CENTER"),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.black),
        ]))
        outer = Table([[table]], colWidths=[doc.frame_width])
        outer.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return outer

    # Signature block ("Prepared by")
    prepared_by_name = pr_details.get("prepared_by_name", "")
    prepared_by_position = pr_details.get("prepared_by_position", "")
    sig_line_w = 2.5 * inch
    underline = Table([[""]], colWidths=[sig_line_w], rowHeights=[0.5])
    underline.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.black),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    sig_inner = Table([
        [Spacer(1, 0.5 * inch)], [underline], [Spacer(1, 0.04 * inch)],
        [Paragraph(prepared_by_name if prepared_by_name else "&nbsp;", sig_name_style)],
        [Paragraph(prepared_by_position if prepared_by_position else "&nbsp;", sig_pos_style)],
        [Spacer(1, 0.06 * inch)], [Paragraph("<b>Prepared by:</b>", sig_label_style)],
    ], colWidths=[sig_line_w])
    sig_inner.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "LEFT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    sig_row = Table([[sig_inner]], colWidths=[doc.frame_width])
    sig_row.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "LEFT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    # ── Height-aware pagination ──
    # Chunk the real rows by MEASURED height (per_page is only an upper cap on rows/page), so tall
    # multi-line descriptions never overflow the frame or push the signature onto an extra page.
    per_page = 10 if desc_mode == "short" else 3
    page_budget = usable_height - HEADER_ROW_H - TRAILING_ROW_H - (0.08 + 0.2) * inch
    last_page_budget = page_budget - SIG_ALLOWANCE   # the last page must also hold the signature block

    chunks = []
    cur, cur_h = [], 0.0
    for row in pdf_rows:
        h = _row_height(row, cap=last_page_budget)
        # break BEFORE adding when this row wouldn't fit even the tighter last-page budget
        if cur and (len(cur) >= per_page or cur_h + h > last_page_budget):
            chunks.append((cur, cur_h))
            cur, cur_h = [], 0.0
        cur.append(row)
        cur_h += h
    chunks.append((cur, cur_h))     # always at least one (possibly empty) page

    for idx, (chunk, chunk_h) in enumerate(chunks):
        is_last = (idx == len(chunks) - 1)
        budget = last_page_budget if is_last else page_budget
        elements.append(Spacer(1, 0.08 * inch))
        elements.append(create_item_table(chunk, budget))
        elements.append(Spacer(1, 0.2 * inch))
        if is_last:
            elements.append(Spacer(1, 0.25 * inch))
            elements.append(sig_row)
        else:
            elements.append(PageBreak())

    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()
