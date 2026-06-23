"""Flow quotation PDF renderer.

Produces a quotation PDF whose layout is IDENTICAL to the legacy generator
(`blueprints/quotation.py` `/generate`) by reusing the same `QuotationDocTemplate`
and replicating the exact item-table / terms / pagination element-building.

This is a standalone renderer so the legacy generator is never touched. It has NO
dependency on Google Apps Script, Excel data, freight/forex, or numbering — the
caller passes already-final prices and a precomputed summary table.
"""

import logging
from io import BytesIO

from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, Table, TableStyle, Image, Spacer, PageBreak
from PIL import Image as PILImage

from pdf_generators.quotation_pdf import QuotationDocTemplate
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)


def _format_number(n):
    try:
        return f"{float(n):,.2f}"
    except Exception:
        return str(n)


def build_quotation_pdf_bytes(items, images, client_details, terms_and_conditions,
                              summary_table_data, desc_mode="short", note=""):
    """Render the quotation PDF and return its bytes.

    items: list of dicts with item_no, product_name, product_code, quantity,
           total_amount (unit price), total_unit_price (line total), description.
    images: dict {item_no: image-bytes}.
    client_details / terms_and_conditions / summary_table_data: as consumed by
           QuotationDocTemplate (mirrors the legacy route).
    desc_mode: "short" (6 items/page) or "long" (1 item/page, with images).
    """
    note = (note or "").strip()
    desc_mode = (desc_mode or "short").strip().lower()

    header_style = ParagraphStyle(name="header", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=colors.black, alignment=1)
    product_name_style = ParagraphStyle(name="product_name", fontName="Helvetica", fontSize=9,
                                        textColor=colors.black, alignment=0, leading=10,
                                        wordWrap="CJK", spaceShrinkage=0.05)

    # ── Item rows (verbatim layout from the legacy generator) ──
    pdf_quotation_df = []
    def _multiline(text):
        """Render a text block as bulleted/multiple lines (newlines → <br/>)."""
        return "<br/>".join(
            f"&#8226; {ln.lstrip('*- ')}" if ln.strip().startswith(('*', '-')) else ln
            for ln in str(text or "").splitlines()
        )

    for item in items:
        pname = str(item.get("product_name") or "")
        pdesc = str(item.get("description") or "")
        name_html = _multiline(pname) or pname           # multi-line item name/description
        if not pdesc or pdesc.strip() == pname.strip():
            description_text = name_html                  # avoid showing the same text twice
        else:
            size = 8 if desc_mode == "long" else 9
            description_text = f"{name_html}<br/><font size={size}>{_multiline(pdesc)}</font>"
        description_paragraph = Paragraph(description_text, product_name_style)

        cell_content = description_paragraph
        if item["item_no"] in images:
            try:
                img = PILImage.open(BytesIO(images[item["item_no"]]))
                img_w, img_h = img.size
                max_image_width = 80
                aspect = (img_w / img_h) if img_h else 1
                img_w_pt = min(max_image_width, img_w)
                img_h_pt = img_w_pt / aspect if aspect else img_h
                img_reader = ImageReader(BytesIO(images[item["item_no"]]))
                nested_table = Table(
                    [[description_paragraph, Image(img_reader, width=img_w_pt, height=img_h_pt)]],
                    colWidths=[126, 80],
                )
                nested_table.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ]))
                cell_content = nested_table
            except Exception as e:
                logger.warning("Failed to include image for item %s: %s", item["item_no"], e)
                cell_content = description_paragraph

        pdf_quotation_df.append([
            item["item_no"],
            cell_content,
            item["product_code"],
            item["quantity"],
            Paragraph(_format_number(item["total_amount"]),
                      ParagraphStyle(name="normal_item", fontName="Helvetica", fontSize=10, alignment=1)),
            Paragraph(_format_number(item["total_unit_price"]),
                      ParagraphStyle(name="normal_item_total", fontName="Helvetica", fontSize=10, alignment=1)),
        ])

    intro_style = ParagraphStyle(name="intro", fontName="Helvetica", fontSize=9, leading=12,
                                 textColor=colors.black, alignment=0)
    intro_paragraph = Paragraph(
        "<b>Dear Ma'am/Sir,</b><br/>We are pleased to submit the following quotation for your requirements:",
        intro_style)

    def create_terms_table():
        terms_style_local = ParagraphStyle(name="terms", fontName="Helvetica", fontSize=9,
                                           textColor=colors.black, alignment=1, wordWrap="CJK")
        terms_table_data = [
            [Paragraph("Validity", header_style), Paragraph("Delivery", header_style),
             Paragraph("Payment", header_style), Paragraph("Warranty", header_style)],
            [
                Paragraph(terms_and_conditions.get("validity", ""), terms_style_local),
                Paragraph(terms_and_conditions.get("delivery", ""), terms_style_local),
                Paragraph(terms_and_conditions.get("payment", ""), terms_style_local),
                Paragraph(terms_and_conditions.get("warranty", "1 year warranty against factory defect"), terms_style_local),
            ],
        ]
        tbl = Table(terms_table_data, colWidths=[85, 85, 140, 200])
        tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        centered_table = Table([[tbl]], colWidths=[510])
        centered_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return centered_table

    terms_centered_table = create_terms_table()

    def create_item_table(data_rows):
        item_header_row = [
            Paragraph("Item No.", header_style),
            Paragraph("Description", header_style),
            Paragraph("Model No.", header_style),
            Paragraph("QTY (UOM)", header_style),
            Paragraph("Unit Price (PHP)", header_style),
            Paragraph("Total Amount (PHP)", header_style),
        ]
        table_data = [item_header_row] + data_rows
        table = Table(table_data, colWidths=[40, 200, 80, 35, 80, 75])
        table.setStyle(TableStyle([
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ("ALIGN", (1, 1), (1, -1), "LEFT"),
            ("ALIGN", (2, 1), (2, -1), "CENTER"),
            ("ALIGN", (3, 1), (3, -1), "CENTER"),
            ("ALIGN", (4, 1), (4, -1), "CENTER"),
            ("ALIGN", (5, 1), (5, -1), "CENTER"),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 10),
            ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
            ("VALIGN", (0, 1), (0, -1), "MIDDLE"),
            ("VALIGN", (1, 1), (1, -1), "TOP"),
            ("VALIGN", (2, 1), (5, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("GRID", (0, 0), (-1, 0), 0.5, colors.black),
        ]))
        centered_table = Table([[table]], colWidths=[510])
        centered_table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return centered_table

    # ── Assemble pages (identical pagination to the legacy generator) ──
    elements = []
    if desc_mode == "short":
        items_per_page = 6
        total_items_count = len(pdf_quotation_df)
        if total_items_count == 0:
            elements += [Spacer(1, 0.4 * inch), intro_paragraph, Spacer(1, 0.2 * inch),
                         terms_centered_table, Spacer(1, 0.05 * inch)]
        else:
            pages = (total_items_count + items_per_page - 1) // items_per_page
            for p in range(pages):
                chunk = pdf_quotation_df[p * items_per_page:(p + 1) * items_per_page]
                elements += [Spacer(1, 0.4 * inch), intro_paragraph, Spacer(1, 0.2 * inch),
                             terms_centered_table, Spacer(1, 0.05 * inch), create_item_table(chunk)]
                if p < pages - 1:
                    elements.append(PageBreak())
    else:
        for idx_item, row in enumerate(pdf_quotation_df):
            if idx_item > 0:
                elements.append(PageBreak())
            elements += [Spacer(1, 0.4 * inch), intro_paragraph, Spacer(1, 0.2 * inch),
                         terms_centered_table, Spacer(1, 0.05 * inch), create_item_table([row])]

    if note and desc_mode == "long":
        elements += [PageBreak(), Spacer(1, 2 * inch)]

    if desc_mode == "long":
        total_pages = len(items) + (1 if note else 0)
    else:
        total_pages = (len(items) + 5) // 6

    buffer = BytesIO()
    doc = QuotationDocTemplate(
        buffer, items_count=len(items), move_summary_to_last_page=True, pagesize=A4,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch, topMargin=1.5 * inch, bottomMargin=0.1 * inch,
    )
    doc.client_details = client_details
    doc.terms_and_conditions = terms_and_conditions
    doc.summary_table_data = summary_table_data
    doc.note = note
    doc.total_pages = total_pages
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


def build_summary_table(total_ex_vat, vat_option):
    """Build the summary-table Paragraphs (same labels/format as the legacy generator)."""
    normal_style = ParagraphStyle(name="normal", fontName="Helvetica", fontSize=9,
                                  textColor=colors.black, alignment=1)
    header_style = ParagraphStyle(name="header", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=colors.black, alignment=1)
    data = [[Paragraph("Total Amount VAT Exclusive", header_style),
             Paragraph(f"PHP {_format_number(total_ex_vat)}", normal_style)]]
    if (vat_option or "").lower() == "inclusive":
        vat = total_ex_vat * 0.12
        data.append([Paragraph("VAT Inclusive (12%)", header_style),
                     Paragraph(f"PHP {_format_number(vat)}", normal_style)])
        data.append([Paragraph("Total Amount VAT Inclusive (12%)", header_style),
                     Paragraph(f"PHP {_format_number(total_ex_vat + vat)}", normal_style)])
    return data
