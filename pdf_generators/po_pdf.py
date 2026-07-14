"""Purchase Order PDF generator ported from the original PO app.

Provides PODocTemplate (renamed from CustomDocTemplate) which extends
ReportLab BaseDocTemplate to produce paginated PO documents with a branded
header (company info + vendor details), six-column items table, currency
formatting, vendor terms box, and watermark background.
"""

import os
import locale
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
    Spacer,
    Image,
    PageBreak,
)
from PIL import Image as PILImage

from pdf_generators.utils import get_static_path, format_bullet_description

logger = logging.getLogger(__name__)

# Currency mapping
CURRENCY_SYMBOLS = {
    "USD": "USD", "PHP": "PHP", "EUR": "EUR", "JPY": "JPY",
    "GBP": "GBP", "AUD": "AUD", "CAD": "CAD", "SGD": "SGD", "AED": "AED",
}


class PODocTemplate(BaseDocTemplate):
    """Custom BaseDocTemplate for Purchase Order PDFs with branded header/footer.

    Supports two pagination modes controlled by *description_type* in
    :meth:`build_pdf`:

    * ``"short"`` -- 10 items per page; vendor terms appended on last page only.
    * ``"long"``  -- 3 items per page with detailed (multi-line) descriptions;
      vendor terms box is repeated on every page via the header/footer callback.
    """

    def __init__(self, filename, client_details=None, items=None,
                 items_per_page=10, currency_symbol="PHP", pagesize=A4, **kwargs):
        """Initialize custom PDF document with explicit margins and page template."""
        kwargs.update({
            'leftMargin': 0.5 * inch,
            'rightMargin': 0.5 * inch,
            'topMargin': 2.5 * inch,
            'bottomMargin': 0.25 * inch,
        })
        super().__init__(filename, **kwargs)

        self.client_details = client_details or {}
        self.items = items or []
        self.items_per_page = items_per_page
        self.currency_symbol = currency_symbol
        self.items_count = len(self.items)

        if not isinstance(pagesize, tuple) or len(pagesize) != 2 or None in pagesize:
            raise ValueError(f"Invalid pagesize: {pagesize}")
        self.page_width, self.page_height = pagesize
        self.frame_width = self.page_width - self.leftMargin - self.rightMargin
        self.frame_height = self.page_height - self.topMargin - self.bottomMargin
        if self.frame_width <= 0 or self.frame_height <= 0:
            raise ValueError(
                f"Invalid frame dimensions: width={self.frame_width}, height={self.frame_height}"
            )
        logger.info(
            f"PODocTemplate initialized: page_width={self.page_width}, page_height={self.page_height}, "
            f"frame_width={self.frame_width}, frame_height={self.frame_height}"
        )

        self.repeat_vendor_terms = False

        self.addPageTemplates([
            PageTemplate(
                id="MainPage",
                frames=[
                    Frame(
                        self.leftMargin,
                        self.bottomMargin,
                        self.frame_width,
                        self.frame_height,
                        id="content",
                    )
                ],
                onPage=self.add_header_footer,
            )
        ])

    # ------------------------------------------------------------------
    # Header / Footer
    # ------------------------------------------------------------------
    def add_header_footer(self, canvas, doc):
        """Add header elements to each page."""
        logger.info("Adding header")
        self.add_common_elements(canvas, doc)

    def add_common_elements(self, canvas, doc):
        """Add header elements (title, logo, watermark, invoice, vendor, PO details) to each page."""
        canvas.saveState()
        logger.info("Starting add_common_elements")

        # -- Watermark --
        try:
            watermark_path = get_static_path("images", "bg1.png")
            if os.path.exists(watermark_path):
                with PILImage.open(watermark_path) as img:
                    img_width, img_height = img.size
                if img_width <= 0 or img_height <= 0:
                    raise ValueError("Invalid watermark image dimensions")
                target_area = 500990 * 0.6
                aspect_ratio = img_width / img_height
                target_width = (target_area * aspect_ratio) ** 0.5
                target_height = target_width / aspect_ratio
                watermark_x = (self.page_width - target_width) / 2
                watermark_y = (self.page_height - target_height) / 2
                canvas.setFillAlpha(0.20)
                canvas.drawImage(
                    watermark_path,
                    watermark_x,
                    watermark_y,
                    width=target_width,
                    height=target_height,
                    mask="auto",
                )
                canvas.setFillAlpha(1.0)
                logger.info("Watermark added successfully")
            else:
                logger.warning(f"Watermark image {watermark_path} not found. Skipping.")
        except Exception as e:
            logger.error(f"Error adding watermark: {str(e)}")

        # -- Logo --
        try:
            logo_path = get_static_path("images", "logo.png")
            if os.path.exists(logo_path):
                logo = Image(logo_path, width=2.5 * inch, height=0.8 * inch)
                logo_x = self.leftMargin
                logo_y = self.page_height - 1.3 * inch
                logo.drawOn(canvas, logo_x, logo_y)
                logger.info("Logo added successfully")
            else:
                logger.warning(f"Logo image {logo_path} not found. Skipping.")
        except Exception as e:
            logger.error(f"Error adding logo: {str(e)}")

        # -- Title: PURCHASE ORDER --
        try:
            canvas.setFont("Helvetica-Bold", 14)
            title_text = "PURCHASE ORDER"
            title_width = canvas.stringWidth(title_text, "Helvetica-Bold", 14)
            title_x = (self.page_width - title_width) / 2
            title_y = self.page_height - 0.7 * inch
            canvas.drawString(title_x, title_y, title_text)
            logger.info("Title added successfully")
        except Exception as e:
            logger.error(f"Error adding title: {str(e)}")

        # -- Invoice To --
        try:
            normal_style = ParagraphStyle(
                name="normal",
                fontName="Helvetica",
                fontSize=9,
                leading=12,
                textColor=colors.black,
                alignment=0,
                wordWrap="CJK",
            )
            invoice_to_text = (
                "<b>INVOICE TO:</b><br/>"
                "<b>H.O ESTUR CORPORATION</b><br/>"
                "Block 90 Lots 2 and 4, University Heights, Kaypian,<br/>"
                "San Jose Del Monte,<br/>"
                "Philippines, 3023<br/>"
                f"<b>Contact Person:</b> {self.client_details.get('invoice_contact_person', '')}<br/>"
                f"<b>Email:</b> {self.client_details.get('invoice_email', '')}"
            )
            invoice_to = Paragraph(invoice_to_text, normal_style)
            invoice_to.wrap(3.0 * inch, 2.0 * inch)
            invoice_to_x = self.leftMargin
            invoice_to_y = self.page_height - 2.65 * inch
            invoice_to.drawOn(canvas, invoice_to_x, invoice_to_y)
            logger.info("Invoice To added successfully")
        except Exception as e:
            logger.error(f"Error adding Invoice To: {str(e)}")

        # -- Vendor Information --
        try:
            vendor_info_text = (
                "<b>VENDOR INFORMATION:</b><br/>"
                f"<b>{self.client_details.get('vendor_name', '')}</b><br/>"
                f"{self.client_details.get('vendor_address', '')}<br/>"
                f"<b>Contact Person:</b> {self.client_details.get('vendor_contact_person', '')}<br/>"
                f"<b>Email:</b> {self.client_details.get('vendor_email', '')}<br/>"
                f"<b>TIN:</b> {self.client_details.get('vendor_tin', '')}"
            )
            vendor_info = Paragraph(vendor_info_text, normal_style)
            vendor_info.wrap(3.0 * inch, 2.0 * inch)
            vendor_info_x = self.leftMargin
            vendor_info_y = self.page_height - 3.9 * inch
            vendor_info.drawOn(canvas, vendor_info_x, vendor_info_y)
            logger.info("Vendor Information added successfully")
        except Exception as e:
            logger.error(f"Error adding Vendor Information: {str(e)}")

        # -- PO Number, PO Date, Payment Terms, Ship To, Date Needed --
        try:
            canvas.setFont("Helvetica", 10)
            po_number = self.client_details.get("po_number", "")
            po_date = self.client_details.get("po_date", "")
            formatted_date = ""
            if po_date:
                try:
                    parsed_date = datetime.strptime(po_date.strip(), "%Y-%m-%d")
                    formatted_date = parsed_date.strftime("%B %d, %Y")
                except ValueError:
                    formatted_date = datetime.now().strftime("%B %d, %Y")
            else:
                formatted_date = datetime.now().strftime("%B %d, %Y")
            # Left-aligned with the Payment Terms / Ship To / Date Needed column below
            # (same x as payment_terms_x), so the right header reads as one clean block.
            label_x = self.leftMargin + self.frame_width - 3.0 * inch
            po_number_y = self.page_height - 1.0 * inch
            po_date_y = self.page_height - 1.2 * inch
            canvas.drawString(label_x, po_number_y, f"PO No: {po_number}")
            canvas.drawString(label_x, po_date_y, f"PO Date: {formatted_date}")
            logger.info("PO No. and PO Date labels left-aligned at fixed x-coordinate")

            payment_terms_text = (
                f"<b>Payment Terms:</b> {self.client_details.get('payment_terms', '')}<br/>"
                "<br/>"
                "<b>Ship To: H.O ESTUR CORPORATION</b><br/>"
                "Block 90 Lots 2 and 4, University Heights, Kaypian,<br/>"
                "San Jose Del Monte, Philippines, 3023<br/>"
                "<br/>"
                f"<b>Date Needed:</b> {self.client_details.get('date_needed', '')}"
                "<br/>"
                "<b>TIN</b>: 010460862"
            )
            payment_terms = Paragraph(payment_terms_text, normal_style)
            payment_terms.wrap(3.0 * inch, 2.0 * inch)
            payment_terms_x = self.leftMargin + self.frame_width - 3.0 * inch
            payment_terms_y = self.page_height - 2.65 * inch
            payment_terms.drawOn(canvas, payment_terms_x, payment_terms_y)
            logger.info("Payment Terms, Ship To, Date Needed added successfully")
        except Exception as e:
            logger.error(f"Error adding PO details or Payment Terms: {str(e)}")

        # -- Vendor terms box (repeated on every page in long description mode) --
        try:
            if getattr(self, "repeat_vendor_terms", False):
                vt_style = ParagraphStyle(
                    name="vendor_terms_header",
                    fontName="Helvetica",
                    fontSize=8,
                    leading=10,
                    textColor=colors.black,
                    alignment=0,
                    leftIndent=4,
                    wordWrap="CJK",
                )
                vendor_terms_text = (
                    "<b>TO OUR VENDORS:</b><br/>"
                    "(1) Goods will be subject to our inspection on arrival, notwithstanding "
                    "prior payments to obtain cash discount.<br/>"
                    "(2) Goods rejected on account of inferior quality, workmanship or hidden "
                    "defect will be returned and are not to be replaced unless instructed to "
                    "do so. If defective goods have been paid in cash, purchase price shall be "
                    "refunded to us immediately upon return.<br/>"
                    "(3) Please notify us of any delay in supplying the items beyond the agreed "
                    "delivery date otherwise, PO is automatically considered cancelled.<br/>"
                    "(4) The vendor shall submit the original copy of Delivery Receipt (DR) "
                    "along with the copy of this P.O. upon delivery.<br/>"
                    "<b>NOTE: PAYMENTS WILL BE MADE ONLY UPON PRESENTATION OF ORIGINAL INVOICE "
                    "ALONG WITH YOUR DELIVERY RECEIPT AND COPY OF THIS PO</b>"
                )
                vt_par = Paragraph(vendor_terms_text, vt_style)
                box_width = min(530, self.frame_width)
                w, h = vt_par.wrap(box_width - 12, self.page_height)
                # fixed position from bottom so it stays identical across pages
                vt_x = self.leftMargin
                vt_y = self.bottomMargin + 0.25 * inch
                # draw box and paragraph inside it
                canvas.setLineWidth(0.5)
                canvas.rect(vt_x, vt_y, box_width, h + 8, stroke=1, fill=0)
                vt_par.drawOn(canvas, vt_x + 6, vt_y + 4)
                logger.info("Vendor terms box added to header/footer area for repeated pages")
        except Exception as e:
            logger.error(f"Error adding repeated vendor terms: {str(e)}")

        canvas.restoreState()
        logger.info("Completed add_common_elements")

    # ------------------------------------------------------------------
    # build_pdf  --  generate the complete Purchase Order PDF
    # ------------------------------------------------------------------
    def build_pdf(self):
        """Generate the complete Purchase Order PDF.

        Uses instance attributes set during ``__init__``:
        ``self.items``, ``self.client_details``, ``self.items_per_page``,
        ``self.currency_symbol``, and ``self.repeat_vendor_terms``.
        """
        items = self.items
        client_details = self.client_details
        description_type = client_details.get("description_type", "short")
        self.items_count = len(items)

        # Validate currency
        currency = client_details.get("currency", "PHP").upper()
        if currency not in CURRENCY_SYMBOLS:
            currency = "PHP"
        currency_code = CURRENCY_SYMBOLS[currency]

        # Number formatting — thread-safe, no locale dependency
        def format_number(n):
            return f"{n:,.2f}"

        # ---- Paragraph styles ----
        normal_style = ParagraphStyle(
            name="normal",
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.black,
            alignment=0,
            wordWrap="CJK",
        )
        header_style = ParagraphStyle(
            name="header",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=colors.black,
            alignment=1,
        )
        description_style = ParagraphStyle(
            name="description",
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=colors.black,
            alignment=0,
            leftIndent=8,
            wordWrap="CJK",
        )
        subtext_style = ParagraphStyle(
            name="subtext",
            fontName="Helvetica-Oblique",
            fontSize=8,
            leading=10,
            textColor=colors.black,
            alignment=0,
            leftIndent=10,
            spaceBefore=4,
            wordWrap="CJK",
        )
        vendor_terms_style = ParagraphStyle(
            name="vendor_terms",
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=colors.black,
            alignment=0,
            spaceBefore=4,
            spaceAfter=4,
            wordWrap="CJK",
        )

        # ---- Build item rows ----
        total_amount = sum(item["total_amount"] for item in items)

        pdf_po_rows = [
            [
                item["item_no"],
                item["item_code"],
                format_bullet_description(item["item_description"], description_style),
                item["quantity"],
                Paragraph(
                    f"{currency_code} {format_number(item['unit_price'])}",
                    normal_style,
                ),
                Paragraph(
                    f"{currency_code} {format_number(item['total_amount'])}",
                    normal_style,
                ),
            ]
            for item in items
        ]
        logger.info(
            f"PDF table data prepared with currency: {currency_code} (rows={len(pdf_po_rows)})"
        )

        # Reference to self for use inside the nested helper
        doc = self

        def create_item_table(
            data_rows,
            row_total_amount,
            reference_no,
            fixed_rows=10,
            show_summary=True,
            reference_only=False,
        ):
            """Create table with dynamic number of item rows (padded to
            *fixed_rows*), optional summary and reference."""
            header_row = [
                Paragraph("Item No.", header_style),
                Paragraph("Item Code", header_style),
                Paragraph("Item Description", header_style),
                Paragraph("Quantity", header_style),
                Paragraph(
                    f"Unit Price ({client_details.get('currency', 'PHP')})",
                    header_style,
                ),
                Paragraph(
                    f"Total Amount ({client_details.get('currency', 'PHP')})",
                    header_style,
                ),
            ]
            reference_row = [
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph(f"<i>Reference No: {reference_no}</i>", subtext_style)
                if (reference_no and not reference_only)
                else Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
            ]
            # Summary row is shown only when show_summary is True
            summary_row = [
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("Total Amount", header_style)
                if show_summary
                else Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph(
                    f"{currency_code} {format_number(row_total_amount)}",
                    normal_style,
                )
                if show_summary
                else Paragraph("", normal_style),
            ]
            empty_row = [
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
                Paragraph("", normal_style),
            ]

            # Layout parameters (base widths used historically)
            BASE_COL_WIDTHS = [40, 80, 200, 50, 80, 80]  # sums to 530
            DESC_COL_INDEX = 2
            DEFAULT_ROW_HEIGHT = 25.0
            EXTRA_DESC_PADDING = 6.0  # slightly reduced padding to match smaller font

            # Scale base column widths to the actual frame width so wrap() uses correct width
            total_base = sum(BASE_COL_WIDTHS)
            scale = doc.frame_width / float(total_base) if total_base > 0 else 1.0
            COL_WIDTHS = [w * scale for w in BASE_COL_WIDTHS]

            # Ensure data_rows has at most fixed_rows entries (it may have fewer)
            visible_rows = list(data_rows[:fixed_rows])
            # Append empty rows so we always have fixed_rows rows (keeps table structure consistent)
            while len(visible_rows) < fixed_rows:
                visible_rows.append(empty_row)

            # Measure required heights for each visible row based on description paragraph
            desc_col_width = COL_WIDTHS[DESC_COL_INDEX]
            measured_heights = []
            for row in visible_rows:
                desc_obj = row[DESC_COL_INDEX]
                try:
                    # subtract left+right paddings used in table style (4 + 4)
                    wrap_width = max(10, desc_col_width - 8)
                    w, h = (
                        desc_obj.wrap(wrap_width, 10000)
                        if hasattr(desc_obj, "wrap")
                        else (wrap_width, 0)
                    )
                except Exception:
                    w, h = (desc_col_width, 0)
                # allow rows to expand to fit content (no global cap)
                row_h = max(DEFAULT_ROW_HEIGHT, h + EXTRA_DESC_PADDING)
                measured_heights.append(row_h)

            # Use measured heights directly so rows expand and push later rows down
            row_heights_data = measured_heights

            # Build table data using visible_rows (already padded)
            table_data = [header_row] + visible_rows
            # assemble row_heights with header first
            row_heights = [30.0] + row_heights_data

            if reference_no and not reference_only:
                table_data.append(reference_row)
                row_heights.append(20.0)
            table_data.append(summary_row)
            row_heights.append(25.0)

            table = Table(table_data, colWidths=COL_WIDTHS, rowHeights=row_heights)
            table.setStyle(TableStyle([
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("ALIGN", (0, 1), (1, -2), "CENTER"),
                ("ALIGN", (2, 1), (2, -2), "LEFT"),
                ("ALIGN", (3, 1), (5, -2), "CENTER"),
                ("ALIGN", (2, -1), (2, -1), "RIGHT"),
                # ensure the total amount value (last column of summary row) is centered
                ("ALIGN", (5, -1), (5, -1), "CENTER"),
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
                # span label across description -> unit price columns,
                # leave last column for the amount
                ("SPAN", (2, -1), (4, -1)),
            ]))
            table_width = doc.frame_width
            centered_table = Table([[table]], colWidths=[table_width])
            centered_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            return centered_table

        # ---- Vendor Terms Box (for short mode, appended on last page only) ----
        vendor_terms_text = (
            "<b>TO OUR VENDORS:</b><br/>"
            "(1) Goods will be subject to our inspection on arrival, notwithstanding "
            "prior payments to obtain cash discount.<br/>"
            "(2) Goods rejected on account of inferior quality, workmanship or hidden "
            "defect will be returned and are not to be replaced unless instructed to "
            "do so. If defective goods have been paid in cash, purchase price shall be "
            "refunded to us immediately upon return.<br/>"
            "(3) Please notify us of any delay in supplying the items beyond the agreed "
            "delivery date otherwise, PO is automatically considered cancelled.<br/>"
            "(4) The vendor shall submit the original copy of Delivery Receipt (DR) "
            "along with the copy of this P.O. upon delivery.<br/>"
            "<b>NOTE: PAYMENTS WILL BE MADE ONLY UPON PRESENTATION OF ORIGINAL INVOICE "
            "ALONG WITH YOUR DELIVERY RECEIPT AND COPY OF THIS PO</b>"
        )
        vendor_terms_paragraph = Paragraph(vendor_terms_text, vendor_terms_style)
        vendor_terms_table = Table([[vendor_terms_paragraph]], colWidths=[530])
        vendor_terms_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        centered_vendor_terms_table = Table(
            [[vendor_terms_table]], colWidths=[doc.frame_width]
        )
        centered_vendor_terms_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))

        # ---- Build elements depending on description type ----
        elements = []
        table_offset = 1.4 * inch

        per_page = 10 if description_type == "short" else 3
        # split rows into fixed-size pages so table height stays constant
        chunks = [
            pdf_po_rows[i:i + per_page]
            for i in range(0, len(pdf_po_rows), per_page)
        ]
        for idx, chunk in enumerate(chunks):
            is_last = (idx == len(chunks) - 1)
            reference_for_page = (
                client_details.get("reference_no", "") if idx == 0 else ""
            )
            elements.append(Spacer(1, table_offset))
            elements.append(create_item_table(
                chunk,
                total_amount if is_last else 0,
                reference_for_page,
                fixed_rows=per_page,
                show_summary=is_last,
                reference_only=(not bool(reference_for_page)),
            ))
            elements.append(Spacer(1, 0.25 * inch))
            # For long description, vendor terms are drawn in the page
            # header/footer (repeat_vendor_terms=True).  For short description,
            # append vendor terms only on the last page.
            if description_type == "short" and is_last:
                elements.append(centered_vendor_terms_table)
                logger.info("Short description: vendor terms appended on last page only")
            logger.info(
                f"{description_type.title()} description: page {idx + 1}/{len(chunks)} "
                f"added (is_last={is_last})"
            )
            if not is_last:
                elements.append(PageBreak())

        # Build the PDF
        self.build(elements)
        logger.info("PDF built successfully")
