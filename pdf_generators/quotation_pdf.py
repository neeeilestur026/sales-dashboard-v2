"""Quotation PDF generator -- ports the original CustomDocTemplate into the unified app.

Uses ReportLab BaseDocTemplate with a branded header/footer, watermark, logo,
client header table, bank details, signature block, summary table, brands footer,
and optional note.
"""

import os
import logging
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Table,
    TableStyle,
    Image,
)
from PIL import Image as PILImage

from pdf_generators.utils import get_static_path

logger = logging.getLogger(__name__)


class QuotationDocTemplate(BaseDocTemplate):
    """Custom BaseDocTemplate for quotation PDFs with branded header/footer."""

    def __init__(self, filename, items_count=0, move_summary_to_last_page=False, **kwargs):
        """Initialize custom PDF document with page template."""
        BaseDocTemplate.__init__(self, filename, **kwargs)
        self.items_count = items_count
        self.move_summary_to_last_page = move_summary_to_last_page
        # These are set by the blueprint before build()
        self.client_details = getattr(self, "client_details", {})
        self.terms_and_conditions = getattr(self, "terms_and_conditions", {})
        self.summary_table_data = getattr(self, "summary_table_data", None)
        self.note = getattr(self, "note", "")
        # total_pages is set by the blueprint before build()
        self.addPageTemplates([
            PageTemplate(
                id="MainPage",
                frames=[
                    Frame(
                        self.leftMargin,
                        self.bottomMargin + 1.5 * inch,
                        self.width,
                        self.height - 2.5 * inch,
                        id="content"
                    )
                ],
                onPage=self.add_header_footer
            )
        ])

    def add_common_elements(self, canvas, doc, include_summary=False):
        """Add common elements to all pages (header, footer, watermark, etc.)."""
        canvas.saveState()

        # Watermark
        try:
            watermark_path = get_static_path("images", "bg1.png")
            if os.path.exists(watermark_path):
                with PILImage.open(watermark_path) as img:
                    img_width, img_height = img.size
                target_area = 500990 * 0.6
                aspect_ratio = img_width / img_height
                target_width = (target_area * aspect_ratio) ** 0.5
                target_height = target_width / aspect_ratio
                watermark_x = (A4[0] - target_width) / 2
                watermark_y = (A4[1] - target_height) / 2
                canvas.setFillAlpha(0.20)
                canvas.drawImage(watermark_path, watermark_x, watermark_y, width=target_width, height=target_height, mask="auto")
                canvas.setFillAlpha(1.0)
            else:
                logger.warning(f"Watermark image {watermark_path} not found. Skipping watermark.")
        except Exception as e:
            logger.error(f"Error loading watermark: {str(e)}")

        # Logo
        logo_path = get_static_path("images", "logo.png")
        if os.path.exists(logo_path):
            logo = Image(logo_path, width=3.5 * inch, height=1.2 * inch)
            logo_x = doc.leftMargin
            logo_y = A4[1] - 1.2 * inch
            logo.drawOn(canvas, logo_x, logo_y)
        else:
            logo_x = doc.leftMargin
            logo_y = A4[1] - 1.2 * inch
            logger.warning(f"Logo image {logo_path} not found.")

        # Date
        date_text = self.client_details.get("quotation_date", "")
        formatted_date = ""
        if date_text:
            for fmt in ("%B %d, %Y", "%Y-%m-%d"):
                try:
                    parsed_date = datetime.strptime(date_text.strip(), fmt)
                    formatted_date = parsed_date.strftime("%B %d, %Y")
                    break
                except ValueError:
                    continue
            if not formatted_date:
                logger.warning(f"Could not parse date '{date_text}'. Using current date.")
                formatted_date = datetime.now().strftime("%B %d, %Y")
        else:
            logger.warning("No quotation date provided. Using current date.")
            formatted_date = datetime.now().strftime("%B %d, %Y")

        if formatted_date:
            canvas.setFont("Helvetica", 10)
            date_label = "Date: "
            date_x = doc.leftMargin + doc.width - 1.3 * inch - canvas.stringWidth(formatted_date, "Helvetica", 10)
            date_y = logo_y + 0.4 * inch
            canvas.drawString(date_x, date_y, f"{date_label}{formatted_date}")

        # Header Table
        normal_style = ParagraphStyle(
            name="normal",
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.black,
            alignment=0,
            wordWrap="CJK"
        )
        right_style = ParagraphStyle(
            name="right",
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.black,
            alignment=0,
            wordWrap="CJK"
        )
        header_data = [
            [
                Paragraph(
                    f"<b><font size=10>{self.client_details.get('client_name', '')}</font></b><br/>"
                    f"{self.client_details.get('client_address', '')}<br/>"
                    "<br/>"
                    f"<b>Attention: </b>{self.client_details.get('attention', '')}<br/>"
                    f"<b>Designation: </b>{self.client_details.get('designation', '')}<br/>"
                    f"<b>Email: </b>{self.client_details.get('email', '')}<br/>"
                    "<br/>"
                    f"<b>Subject: </b>{self.client_details.get('subject', '')}",
                    normal_style
                ),
                Paragraph(
                    "<b><font size=10>QUOTATION</font></b><br/>"
                    f"<b>Ref No: </b>{self.client_details.get('reference_no', '')}<br/>"
                    "<br/>"
                    "<b>Office Address:</b><br/>"
                    "<b>H.O ESTUR CORPORATION</b><br/>"
                    "Blk 90 Lot 2 & 4 Ph 1 University Heights, Brgy Kaypian,<br/>"
                    "District 1, San Jose Del Monte, Bulacan,<br/>"
                    "Philippines, 3023,<br/><br/>"
                    f"<b>RFQ No: </b>{self.client_details.get('reference_rfq_no', '')}",
                    right_style
                )
            ]
        ]
        header_table = Table(header_data, colWidths=[3 * inch, 4.25 * inch])
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (0, 0), "LEFT"),
            ("ALIGN", (1, 0), (1, 0), "CENTER"),
            ("LEFTPADDING", (1, 0), (1, 0), 20),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("BACKGROUND", (0, 0), (-1, -1), colors.transparent),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
            ("ROUNDEDCORNERS", [10, 10, 10, 10]),
        ]))
        max_table_height = 1.7 * inch
        table_width, table_height = header_table.wrap(doc.width, max_table_height)
        table_height = min(table_height, max_table_height)
        header_table_y = logo_y - table_height - 0.2 * inch
        header_table.drawOn(canvas, doc.leftMargin, header_table_y)

        # Render optional note as a bulleted list directly under the header (only on the final page)
        note_text = getattr(self, "note", None)
        if include_summary and note_text:
            try:
                lines = [ln.strip() for ln in str(note_text).splitlines() if ln.strip()]
                if lines:
                    note_bulleted = "<br/>".join(f"&#8226; {ln}" for ln in lines)
                    note_style = ParagraphStyle(
                        name="note_header",
                        fontName="Helvetica",
                        fontSize=9,
                        leading=12,
                        textColor=colors.black,
                        alignment=0,
                        wordWrap="CJK"
                    )
                    note_para = Paragraph(note_bulleted, note_style)
                    note_w, note_h = note_para.wrap(doc.width, 2 * inch)
                    note_x = doc.leftMargin
                    note_y = header_table_y - note_h - 6  # 6pt gap
                    if note_y < doc.bottomMargin + 0.5 * inch:
                        note_y = doc.bottomMargin + 0.5 * inch
                    note_para.drawOn(canvas, note_x, note_y)
            except Exception as e:
                logger.warning(f"Failed to render note under header: {e}")

        # Brands footer (visible on all pages)
        brands_style = ParagraphStyle(
            name="brands",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=colors.black,
            alignment=1,
            leading=12
        )
        brands_text = "Cejn | Snap-on Bluepoint | Hydraulic Technologies | Chicago Pneumatics | RAD Torque Solutions"
        brands = Paragraph(brands_text, brands_style)
        brands_w, brands_h = brands.wrap(doc.width, 0.5 * inch)
        brands_x = doc.leftMargin + (doc.width - brands_w) / 2
        brands_y = doc.bottomMargin
        brands.drawOn(canvas, brands_x, brands_y)

        # Bank Details and Signature: only render when include_summary is True (last page)
        if include_summary:
            # Bank Details
            bank_style = ParagraphStyle(
                name="bank",
                fontName="Helvetica",
                fontSize=9,
                textColor=colors.black,
                alignment=0,
                leading=12,
                wordWrap="CJK"
            )
            bank_details_text = (
                "<font name='Helvetica-Bold'>Bank Details</font><br/>"
                "<font name='Helvetica-Bold'>Bank Branch: </font><font name='Helvetica'>Metrobank/SJDM-Quirino HIGHWAY BRANCH</font><br/>"
                "<font name='Helvetica-Bold'>SWIFT Code: </font><font name='Helvetica'>MBTCPHMM</font><br/>"
                "<font name='Helvetica-Bold'>Account Name: </font><font name='Helvetica'>H.O ESTUR CORPORATION</font><br/>"
                "<font name='Helvetica-Bold'>Account No: </font><font name='Helvetica'>329-7-32952086-9</font><br/>"
                "<font name='Helvetica-Bold'>Beneficiary's TIN: </font><font name='Helvetica'>010-460-862-000</font><br/>"
                "<font name='Helvetica-Bold'>Beneficiary's Registration Number: </font><font name='Helvetica'>CS202001160</font>"
            )
            bank_paragraph = Paragraph(bank_details_text, bank_style)
            bank_table_data = [[bank_paragraph]]
            bank_table = Table(bank_table_data, colWidths=[280])
            bank_table.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ]))
            bank_x = doc.leftMargin + 3.5 * inch
            bank_y = doc.bottomMargin + 0.45 * inch
            bank_w, bank_h = bank_table.wrap(280, 1.5 * inch)
            bank_table.drawOn(canvas, bank_x, bank_y)

            # Signature
            signature_style = ParagraphStyle(
                name="signature",
                fontName="Helvetica-BoldOblique",
                fontSize=9,
                textColor=colors.black,
                alignment=0,
                leading=12
            )
            signature_text = (
                "<font name='Helvetica-BoldOblique'>Sincerely Yours,</font><br/>"
                f"<font name='Helvetica-Oblique'>{self.client_details.get('signature_name', '')}</font><br/>"
                f"<font name='Helvetica-Oblique'>{self.client_details.get('signature_designation', '')}</font><br/>"
                "<br/>"
                f"<font name='Helvetica-Bold'>Viber: </font><font name='Helvetica'>{self.client_details.get('signature_viber', '')}</font><br/>"
                f"<font name='Helvetica-Bold'>Mobile: </font><font name='Helvetica'>{self.client_details.get('signature_mobile', '')}</font><br/>"
                f"<font name='Helvetica-Bold'>Email: </font><font name='Helvetica'>{self.client_details.get('signature_email', '')}</font><br/>"
                "<font name='Helvetica-Bold'>Website: </font><font name='Helvetica'>www.hiescorp.com</font><br/>"
            )
            signature = Paragraph(signature_text, signature_style)
            sig_w, sig_h = signature.wrap(doc.width, 1.5 * inch)
            signature_x = doc.leftMargin
            signature_y = doc.bottomMargin + 0.3 * inch
            signature.drawOn(canvas, signature_x, signature_y)

        # Summary Table (only if include_summary is True)
        if include_summary and self.summary_table_data:
            header_style = ParagraphStyle(
                name="header",
                fontName="Helvetica-Bold",
                fontSize=9,
                textColor=colors.black,
                alignment=0
            )
            normal_style_summary = ParagraphStyle(
                name="normal_summary",
                fontName="Helvetica",
                fontSize=9,
                textColor=colors.black,
                alignment=2
            )

            table = Table(self.summary_table_data, colWidths=[190, 90])
            table.setStyle(TableStyle([
                ("TEXTCOLOR", (0, 0), (0, -1), colors.black),
                ("TEXTCOLOR", (1, 0), (1, -1), colors.black),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            table_width_val = 280
            table_h = table.wrap(table_width_val, 100)[1]
            table_x = doc.leftMargin + 3.5 * inch
            table_y = doc.bottomMargin + 1.8 * inch
            # draw separator line above the table
            canvas.setLineWidth(0.5)
            canvas.setStrokeColor(colors.black)
            canvas.line(table_x, table_y + table_h + 5, table_x + table_width_val, table_y + table_h + 5)
            # draw the summary table
            table.drawOn(canvas, table_x, table_y)

    def add_header_footer(self, canvas, doc):
        """Add header and footer elements, conditionally including summary table."""
        if getattr(self, "move_summary_to_last_page", False):
            total = getattr(doc, "total_pages", None)
            include_summary = (total is not None and doc.page == total)
        else:
            include_summary = self.items_count <= 6 or doc.page > 1
        self.add_common_elements(canvas, doc, include_summary=include_summary)
        canvas.restoreState()

    def build_pdf(self, elements=None):
        """Build the PDF document. Elements should be passed by the blueprint."""
        if elements is not None:
            self.build(elements)
