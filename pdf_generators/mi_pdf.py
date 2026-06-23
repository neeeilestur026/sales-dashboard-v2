"""MIDocTemplate -- ReportLab BaseDocTemplate for Materials Issuance documents.

Mirrors MRODocTemplate with title changed to MATERIALS ISSUANCE and
terminology adapted (Receiving → Issuance, Vendor → Recipient).
"""

import os
import html
import logging

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from PIL import Image as PILImage
from dateutil.parser import parse

from pdf_generators.utils import get_static_path, format_bullet_description

logger = logging.getLogger(__name__)


class MIDocTemplate(BaseDocTemplate):
    """Custom BaseDocTemplate for Materials Issuance documents."""

    def __init__(self, filename, client_details=None, items=None,
                 items_per_page=10, pagesize=A4, **kwargs):
        kwargs.update({
            'leftMargin':   0.5  * inch,
            'rightMargin':  0.5  * inch,
            'topMargin':    2.6  * inch,
            'bottomMargin': 0.25 * inch,
        })
        super().__init__(filename, **kwargs)

        self.client_details = client_details or {}
        self.items = items or []
        self.items_per_page = items_per_page

        if not isinstance(pagesize, tuple) or len(pagesize) != 2 or None in pagesize:
            raise ValueError(f"Invalid pagesize: {pagesize}")
        self.page_width, self.page_height = pagesize
        self.frame_width  = self.page_width  - self.leftMargin - self.rightMargin
        self.frame_height = self.page_height - self.topMargin  - self.bottomMargin

        self.addPageTemplates([
            PageTemplate(
                id="MainPage",
                frames=[Frame(
                    self.leftMargin, self.bottomMargin,
                    self.frame_width, self.frame_height,
                    id="content"
                )],
                onPage=self.add_header_footer
            )
        ])

    # ── Header / footer drawn on every page ───────────────────────────────
    def add_header_footer(self, canvas, doc):
        canvas.saveState()

        PAGE_W = self.page_width
        PAGE_H = self.page_height
        L      = self.leftMargin

        # ── Watermark ─────────────────────────────────────────────────────
        try:
            wm_path = get_static_path("images", "bg1.png")
            if os.path.exists(wm_path):
                with PILImage.open(wm_path) as img:
                    iw, ih = img.size
                aspect = iw / ih
                target_h = PAGE_H * 0.55
                target_w = target_h * aspect
                wm_x = (PAGE_W - target_w) / 2
                wm_y = (PAGE_H - target_h) / 2
                canvas.setFillAlpha(0.20)
                canvas.drawImage(wm_path, wm_x, wm_y,
                                 width=target_w, height=target_h, mask="auto")
                canvas.setFillAlpha(1.0)
        except Exception as e:
            logger.error(f"Watermark error: {e}")

        # ── Title ─────────────────────────────────────────────────────────
        title_y = PAGE_H - 0.45 * inch
        canvas.setFont("Helvetica-Bold", 14)
        title = "MATERIALS ISSUANCE"
        tw = canvas.stringWidth(title, "Helvetica-Bold", 14)
        canvas.drawString((PAGE_W - tw) / 2, title_y, title)

        # ── Logo (left column, below title) ───────────────────────────────
        logo_path = get_static_path("images", "logo.png")
        logo_bottom = title_y - 0.85 * inch
        if os.path.exists(logo_path):
            try:
                logo = Image(logo_path, width=2.3 * inch, height=0.65 * inch)
                logo.drawOn(canvas, L, logo_bottom)
            except Exception as e:
                logger.error(f"Logo error: {e}")

        # ── Two-column info block ─────────────────────────────────────────
        info_top = logo_bottom - 0.12 * inch

        def draw_label(x, y, text):
            canvas.setFont("Helvetica-Bold", 8.5)
            canvas.drawString(x, y, text)

        def draw_value(x, y, text, max_width=None):
            canvas.setFont("Helvetica", 8.5)
            if max_width:
                while canvas.stringWidth(text, "Helvetica", 8.5) > max_width and len(text) > 4:
                    text = text[:-2] + "\u2026"
            canvas.drawString(x, y, text)

        LINE = 0.175 * inch

        # ── LEFT column: recipient info ────────────────────────────────────
        vx = L
        vy = info_top

        cd = self.client_details
        vendor_name    = cd.get("vendor_name", "")
        vendor_address = cd.get("vendor_address", "")
        contact_person = cd.get("vendor_contact_person", "")
        vendor_email   = cd.get("vendor_email", "")
        vendor_tin     = cd.get("vendor_tin", "")

        draw_label(vx, vy, "RECIPIENT INFORMATION:")
        vy -= LINE
        draw_label(vx, vy, vendor_name)
        vy -= LINE
        draw_value(vx, vy, vendor_address, max_width=3.5 * inch)
        vy -= LINE
        draw_label(vx, vy, "Contact Person: ")
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(vx + canvas.stringWidth("Contact Person: ", "Helvetica-Bold", 8.5), vy, contact_person)
        vy -= LINE
        draw_label(vx, vy, "Email: ")
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(vx + canvas.stringWidth("Email: ", "Helvetica-Bold", 8.5), vy, vendor_email)
        vy -= LINE
        draw_label(vx, vy, "TIN: ")
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(vx + canvas.stringWidth("TIN: ", "Helvetica-Bold", 8.5), vy, vendor_tin)

        # ── RIGHT column: 2-column grid ──────────────────────────────────
        rx  = L + 3.8 * inch
        ry  = info_top
        rx2 = rx + 1.7 * inch

        sales_invoice     = cd.get("sales_invoice", "")
        purchase_order_no = cd.get("purchase_order_no", "")
        po_date           = cd.get("po_date", "")
        if po_date:
            try:
                formatted_date = parse(po_date).strftime("%B %d, %Y")
            except Exception:
                formatted_date = po_date
        else:
            formatted_date = ""

        rc_name     = cd.get("received_checked_name", "")
        rc_position = cd.get("received_checked_position", "")

        # Row 1 labels
        draw_label(rx,  ry, "Issuance No.:")
        draw_label(rx2, ry, "Issuance Date:")
        ry -= LINE

        # Row 1 values
        draw_value(rx,  ry, sales_invoice,  max_width=1.6 * inch)
        draw_value(rx2, ry, formatted_date, max_width=1.6 * inch)
        ry -= LINE * 1.1

        # Row 2 labels
        draw_label(rx,  ry, "Recipient:")
        draw_label(rx2, ry, "Issued by:")
        ry -= LINE

        # Row 2 values
        draw_value(rx, ry, vendor_name, max_width=1.6 * inch)
        if rc_name:
            draw_value(rx2, ry, rc_name, max_width=1.6 * inch)
            ry -= LINE
        if rc_position:
            canvas.setFont("Helvetica-Oblique", 8)
            canvas.drawString(rx2, ry, rc_position)
        ry -= LINE * 1.1

        # Row 3 labels
        draw_label(rx, ry, "Requisition No.:")
        ry -= LINE

        # Row 3 values
        draw_value(rx, ry, purchase_order_no, max_width=1.6 * inch)

        canvas.restoreState()

    # ── Build complete PDF ────────────────────────────────────────────────
    def build_pdf(self):
        """Construct the full story and call ``self.build()`` to emit the PDF."""

        normal_style = ParagraphStyle(
            name="normal", fontName="Helvetica", fontSize=9,
            leading=12, textColor=colors.black, alignment=0, wordWrap="CJK"
        )
        header_style = ParagraphStyle(
            name="header", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.black, alignment=1
        )
        description_style = ParagraphStyle(
            name="description", fontName="Helvetica", fontSize=8,
            leading=10, textColor=colors.black, alignment=0,
            leftIndent=8, wordWrap="CJK"
        )
        vendor_terms_style = ParagraphStyle(
            name="vendor_terms", fontName="Helvetica", fontSize=7.5,
            leading=9.5, textColor=colors.black, alignment=0,
            spaceBefore=4, spaceAfter=4, wordWrap="CJK"
        )

        elements = []
        frame_width = self.frame_width

        pdf_rows = [
            [
                item["item_no"],
                item["model_no"],
                format_bullet_description(item["item_description"], description_style),
                item["quantity"],
                item.get("item_remarks", ""),
            ]
            for item in self.items
        ]

        def create_item_table(data_rows, per_page):
            header_row = [
                Paragraph("Item No.",        header_style),
                Paragraph("Model No.",       header_style),
                Paragraph("Item Description", header_style),
                Paragraph("Quantity",        header_style),
                Paragraph("Remarks",         header_style),
            ]

            empty_row = [Paragraph("", normal_style)] * 5

            BASE_COL_WIDTHS = [40, 80, 260, 60, 110]
            total_base = sum(BASE_COL_WIDTHS)
            scale      = frame_width / float(total_base)
            COL_WIDTHS = [w * scale for w in BASE_COL_WIDTHS]

            DESC_IDX      = 2
            DEFAULT_ROW_H = 25.0
            EXTRA_PAD     = 6.0
            desc_col_w    = COL_WIDTHS[DESC_IDX]

            visible_rows = list(data_rows[:per_page])
            while len(visible_rows) < per_page:
                visible_rows.append(empty_row)

            row_heights = []
            for row in visible_rows:
                desc_obj = row[DESC_IDX]
                try:
                    wrap_w = max(10, desc_col_w - 8)
                    _, h = desc_obj.wrap(wrap_w, 10000) if hasattr(desc_obj, "wrap") else (wrap_w, 0)
                except Exception:
                    h = 0
                row_heights.append(max(DEFAULT_ROW_H, h + EXTRA_PAD))

            table_data    = [header_row] + visible_rows
            final_heights = [30.0] + row_heights

            table_data.append([Paragraph("", normal_style)] * 5)
            final_heights.append(25.0)

            table = Table(table_data, colWidths=COL_WIDTHS, rowHeights=final_heights)
            table.setStyle(TableStyle([
                ("TEXTCOLOR",    (0, 0),  (-1, -1), colors.black),
                ("ALIGN",        (0, 0),  (-1,  0), "CENTER"),
                ("ALIGN",        (0, 1),  ( 1, -2), "CENTER"),
                ("ALIGN",        (2, 1),  ( 2, -2), "LEFT"),
                ("ALIGN",        (3, 1),  (-1, -2), "CENTER"),
                ("FONTNAME",     (0, 0),  (-1,  0), "Helvetica-Bold"),
                ("FONTNAME",     (0, 1),  (-1, -1), "Helvetica"),
                ("FONTSIZE",     (0, 0),  (-1, -1), 9),
                ("VALIGN",       (0, 0),  (-1, -1), "MIDDLE"),
                ("LEFTPADDING",  (0, 0),  (-1, -1), 4),
                ("RIGHTPADDING", (0, 0),  (-1, -1), 4),
                ("TOPPADDING",   (0, 0),  (-1, -1), 6),
                ("BOTTOMPADDING",(0, 0),  (-1, -1), 6),
                ("BOX",          (0, 0),  (-1, -1), 0.5, colors.black),
                ("LINEBELOW",    (0, 0),  (-1,  0), 0.5, colors.black),
            ]))

            outer = Table([[table]], colWidths=[frame_width])
            outer.setStyle(TableStyle([
                ("ALIGN",  (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            return outer

        # ── Special Notes footer box ──────────────────────────────────────
        special_notes_text = self.client_details.get("special_notes", "").strip()
        sn_body = Paragraph(
            f"<b>SPECIAL NOTES:</b><br/>{html.escape(special_notes_text).replace(chr(10), '<br/>')}",
            vendor_terms_style
        )
        sn_table = Table([[sn_body]], colWidths=[frame_width - 2])
        sn_table.setStyle(TableStyle([
            ("BOX",          (0, 0), (-1, -1), 0.5, colors.black),
            ("LEFTPADDING",  (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
            ("ALIGN",        (0, 0), (-1, -1), "LEFT"),
            ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ]))
        outer_sn = Table([[sn_table]], colWidths=[frame_width])
        outer_sn.setStyle(TableStyle([
            ("ALIGN",  (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))

        # ── Prepared by signatory block ───────────────────────────────────
        sig_label_style = ParagraphStyle(
            name="sig_label", fontName="Helvetica-Bold", fontSize=9,
            textColor=colors.black, alignment=0
        )
        sig_name_style = ParagraphStyle(
            name="sig_name", fontName="Helvetica", fontSize=9,
            textColor=colors.black, alignment=0
        )
        sig_pos_style = ParagraphStyle(
            name="sig_pos", fontName="Helvetica-Oblique", fontSize=8,
            textColor=colors.black, alignment=0
        )

        prepared_by_name     = self.client_details.get("prepared_by_name", "")
        prepared_by_position = self.client_details.get("prepared_by_position", "")

        sig_line_w = 2.5 * inch
        underline = Table([[""]], colWidths=[sig_line_w], rowHeights=[0.5])
        underline.setStyle(TableStyle([
            ("LINEABOVE",     (0, 0), (-1, 0), 0.5, colors.black),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        sig_inner = Table(
            [
                [Spacer(1, 0.5 * inch)],
                [underline],
                [Spacer(1, 0.04 * inch)],
                [Paragraph(prepared_by_name     if prepared_by_name     else "&nbsp;", sig_name_style)],
                [Paragraph(prepared_by_position if prepared_by_position else "&nbsp;", sig_pos_style)],
                [Spacer(1, 0.06 * inch)],
                [Paragraph("<b>Prepared by:</b>", sig_label_style)],
            ],
            colWidths=[sig_line_w]
        )
        sig_inner.setStyle(TableStyle([
            ("ALIGN",        (0, 0), (-1, -1), "LEFT"),
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",   (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))

        sig_row = Table([[sig_inner]], colWidths=[frame_width])
        sig_row.setStyle(TableStyle([
            ("ALIGN",        (0, 0), (-1, -1), "LEFT"),
            ("VALIGN",       (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",   (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))

        # ── Paginate rows ─────────────────────────────────────────────────
        per_page = self.items_per_page
        chunks   = [pdf_rows[i:i+per_page] for i in range(0, len(pdf_rows), per_page)]

        for idx, chunk in enumerate(chunks):
            is_last = (idx == len(chunks) - 1)

            elements.append(Spacer(1, 0.3 * inch))
            elements.append(create_item_table(chunk, per_page))
            elements.append(Spacer(1, 0.2 * inch))

            if is_last:
                elements.append(outer_sn)
                elements.append(Spacer(1, 0.25 * inch))
                elements.append(sig_row)

            if not is_last:
                elements.append(PageBreak())

        self.build(elements)
