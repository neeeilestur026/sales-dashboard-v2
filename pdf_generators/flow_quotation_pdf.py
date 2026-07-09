"""Flow quotation PDF renderer — modern flat layout (Addendum 85).

Implements the red-accent reference design: logo + light "QUOTATION" title, seller
address + Date/RFQ/Sales-Person meta, CUSTOMER + SUBJECT blocks, brands strip,
red-header items table with product thumbnails, VAT-aware totals with a highlighted
grand-total box, 4-column terms strip, bank details + signature columns, disclaimer,
and a full-bleed accent footer band on every page.

Standalone (ReportLab only): no Google Apps Script / Excel / legacy-template
dependency. The legacy `/quotation/` generator is untouched. The spec is written in
px on an 820px sheet — every dimension is scaled to A4 via the PX factor so the
proportions match the reference exactly. ACCENT is the single theming constant.
"""

import logging
import os
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, KeepTogether,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus import Image as RLImage
from PIL import Image as PILImage

logger = logging.getLogger(__name__)

# ── Theme ─────────────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4                          # 595.27 x 841.89 pt
PX = PAGE_W / 820.0                          # spec px (820px sheet) → pt
ACCENT = HexColor("#C0392B")                 # the single theming variable
TEXT = HexColor("#333333")
SECONDARY = HexColor("#555555")
MUTED = HexColor("#888888")
LABEL = HexColor("#999999")
SUBLINE = HexColor("#777777")
TITLE_DARK = HexColor("#222222")
HAIRLINE = HexColor("#ececec")
HAIRLINE2 = HexColor("#eeeeee")
TOTAL_FILL = HexColor("#faf0ee")
TOTAL_BORDER = HexColor("#f0d8d3")
STRIP_FILL = HexColor("#f6f4f2")
STRIPE_A = HexColor("#f4f4f4")
STRIPE_B = HexColor("#ececec")
LINK = HexColor("#2b5fb8")

MARGIN = 48 * PX                             # 48px side inset
TOP_MARGIN = 44 * PX                         # 44px top padding
FOOTER_BAND_H = (16 * 2 + 14) * PX           # 16px vert padding × 2 + one text line
BOTTOM_MARGIN = FOOTER_BAND_H + 18 * PX
CONTENT_W = PAGE_W - 2 * MARGIN

COMPANY_NAME = "H.O ESTUR CORPORATION"
COMPANY_ADDRESS = ("Blk 90 Lot 2 & 4 Ph 1 University Heights, Brgy Kaypian,\n"
                   "District 1, San Jose Del Monte, Bulacan,\nPhilippines, 3023")
BRANDS = ("Authorized brands:  Cejn | Snap-on Bluepoint | Hydraulic Technologies | "
          "Chicago Pneumatics | RAD Torque Solutions")
BANK_LINES = [
    ("Bank Branch", "Metrobank / SJDM-Quirino Highway Branch"),
    ("SWIFT Code", "MBTCPHMM"),
    ("Account Name", "H.O ESTUR CORPORATION"),
    ("Account No", "329-7-32952086-9"),
    ("Beneficiary's TIN", "010-460-862-000"),
    ("Registration Number", "CS202001160"),
]
DISCLAIMER = ("This quotation was prepared electronically and is valid without a signature. "
              "Prices are quoted in Philippine Pesos unless otherwise stated.")
_LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "static", "images", "logo.png")


def _fmt(n):
    try:
        return f"{float(n):,.2f}"
    except Exception:
        return str(n)


def _esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _ps(name, size_px, color=TEXT, font="Helvetica", align=0, leading_mult=1.45, **kw):
    """ParagraphStyle from spec px sizes."""
    size = size_px * PX
    return ParagraphStyle(name=name, fontName=font, fontSize=size, textColor=color,
                          alignment=align, leading=size * leading_mult, **kw)


# ── Thumbnail flowable: real product image, or the striped placeholder ───────
class _Thumb(Flowable):
    SIZE = 64 * PX

    def __init__(self, img_bytes=None):
        super().__init__()
        self.img_bytes = img_bytes
        self.width = self.height = self.SIZE

    def draw(self):
        c = self.canv
        s = self.SIZE
        c.saveState()
        c.setStrokeColor(HAIRLINE)
        c.setLineWidth(1)
        if self.img_bytes:
            try:
                pil = PILImage.open(BytesIO(self.img_bytes))
                if pil.mode not in ("RGB", "RGBA"):
                    pil = pil.convert("RGB")
                iw, ih = pil.size
                scale = min(s / iw, s / ih) if iw and ih else 1
                w, h = iw * scale, ih * scale
                c.drawImage(ImageReader(pil), (s - w) / 2, (s - h) / 2, w, h,
                            preserveAspectRatio=True, mask="auto")
                c.rect(0, 0, s, s)
                c.restoreState()
                return
            except Exception:
                logger.warning("thumbnail decode failed; using placeholder")
        # 45° repeating-stripe placeholder + monospace caption
        c.setFillColor(STRIPE_A)
        c.rect(0, 0, s, s, stroke=0, fill=1)
        # clip to the box so the diagonal stripes never bleed outside
        p = c.beginPath()
        p.rect(0, 0, s, s)
        c.clipPath(p, stroke=0, fill=0)
        c.setStrokeColor(STRIPE_B)
        c.setLineWidth(2.2)
        stripes = c.beginPath()
        step = 7 * PX
        x = -s
        while x < s:
            stripes.moveTo(x, 0)
            stripes.lineTo(x + s, s)
            x += step
        c.drawPath(stripes, stroke=1, fill=0)
        c.setFillColor(colors.white)
        cap_w = s * 0.9
        c.rect((s - cap_w) / 2, s * 0.37, cap_w, s * 0.26, stroke=0, fill=1)
        c.setFillColor(MUTED)
        c.setFont("Courier", 6.5 * PX)
        c.drawCentredString(s / 2, s * 0.45, "product shot")
        c.setStrokeColor(HAIRLINE)
        c.rect(0, 0, s, s)
        c.restoreState()


# ── Page template: white sheet + full-bleed accent footer band every page ────
class _QuoTemplate(BaseDocTemplate):
    def __init__(self, buf, footer_left, footer_right, **kw):
        super().__init__(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN, **kw)
        self._footer_left = footer_left
        self._footer_right = footer_right
        frame = Frame(MARGIN, BOTTOM_MARGIN, CONTENT_W, PAGE_H - TOP_MARGIN - BOTTOM_MARGIN,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="quo", frames=[frame], onPage=self._on_page)])

    def _on_page(self, canvas, doc):
        canvas.saveState()
        # footer band (full bleed, every page)
        canvas.setFillColor(ACCENT)
        canvas.rect(0, 0, PAGE_W, FOOTER_BAND_H, stroke=0, fill=1)
        y = FOOTER_BAND_H / 2 - (13 * PX) / 2 + 2
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 13 * PX)
        canvas.drawString(MARGIN, y, self._footer_left)
        canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.92))
        canvas.setFont("Helvetica", 11 * PX)
        canvas.drawRightString(PAGE_W - MARGIN, y, self._footer_right)
        canvas.restoreState()


# ── Public API (route contract unchanged) ─────────────────────────────────────
def build_summary_table(total_ex_vat, vat_option):
    """Totals for the summary block. Returns a dict the renderer interprets."""
    opt = (vat_option or "inclusive").strip().lower()
    vat = total_ex_vat * 0.12 if opt == "inclusive" else 0.0
    return {"total_ex_vat": total_ex_vat, "vat": vat,
            "total": total_ex_vat + vat, "vat_option": opt}


def build_quotation_pdf_bytes(items, images, client_details, terms_and_conditions,
                              summary_table_data, desc_mode="short", note=""):
    """Render the quotation PDF (modern layout) and return its bytes.

    items: dicts with item_no, product_name, product_code, quantity,
           total_amount (unit price), total_unit_price (line total), description.
    images: {item_no: image-bytes}. summary_table_data: dict from build_summary_table.
    desc_mode is accepted for compatibility (single unified layout).
    """
    cd = client_details or {}
    terms = terms_and_conditions or {}
    if isinstance(summary_table_data, dict):
        summary = summary_table_data
    else:  # defensive: recompute from items if an old-style list sneaks in
        total = sum(float(i.get("total_unit_price") or 0) for i in (items or []))
        summary = build_summary_table(total, "inclusive")

    sig_name = str(cd.get("signature_name") or "").strip()
    footer_right = " · ".join(x for x in [str(cd.get("signature_mobile") or "").strip(),
                                          str(cd.get("signature_email") or "").strip()] if x)

    buf = BytesIO()
    doc = _QuoTemplate(buf, COMPANY_NAME, footer_right)
    story = []

    # ── Header row 1: logo | QUOTATION + ref ──
    try:
        pil = PILImage.open(_LOGO_PATH)
        iw, ih = pil.size
        h = 74 * PX
        w = h * (iw / ih) if ih else h
        logo_cell = RLImage(_LOGO_PATH, width=w, height=h)
    except Exception:
        logo_cell = Paragraph(f"<b>{_esc(COMPANY_NAME)}</b>",
                              _ps("logoFallback", 16, TITLE_DARK, "Helvetica-Bold"))
    title_cell = [
        Paragraph("QUOTATION", _ps("quoTitle", 44, ACCENT, "Helvetica", align=2, leading_mult=1.05)),
        Spacer(1, 4 * PX),
        Paragraph(f"# {_esc(cd.get('reference_no'))}",
                  _ps("quoRef", 14, SECONDARY, "Helvetica-Bold", align=2)),
    ]
    row1 = Table([[logo_cell, title_cell]], colWidths=[CONTENT_W * 0.45, CONTENT_W * 0.55])
    row1.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("ALIGN", (0, 0), (0, 0), "LEFT"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(row1)
    story.append(Spacer(1, 22 * PX))

    # ── Header row 2: seller address | Date / RFQ / Sales Person ──
    seller = Paragraph(
        f"<b><font size={14 * PX:.1f}>{_esc(COMPANY_NAME)}</font></b><br/>"
        + "<br/>".join(_esc(l) for l in COMPANY_ADDRESS.split("\n")),
        _ps("seller", 12.5, SECONDARY))
    meta_rows = []
    label_st = _ps("metaLabel", 12, MUTED)
    value_st = _ps("metaValue", 12, TEXT, "Helvetica-Bold", align=2)
    for label, value in [("Date", cd.get("quotation_date")),
                         ("RFQ No.", cd.get("reference_rfq_no") or "—"),
                         ("Sales Person", sig_name)]:
        meta_rows.append([Paragraph(label, label_st), Paragraph(_esc(value), value_st)])
    meta = Table(meta_rows, colWidths=[110 * PX, 190 * PX])
    meta.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 2 * PX),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * PX)]))
    row2 = Table([[seller, meta]], colWidths=[CONTENT_W - 300 * PX, 300 * PX])
    row2.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(row2)
    story.append(Spacer(1, 20 * PX))

    # ── Header row 3: CUSTOMER | SUBJECT (hairline top border) ──
    cust_parts = ["<font size={:.1f} color='#999999'><b>C U S T O M E R</b></font><br/>".format(11 * PX),
                  f"<b><font size={15 * PX:.1f} color='#222222'>{_esc(cd.get('client_name'))}</font></b>"]
    if cd.get("client_address"):
        cust_parts.append("<br/>" + "<br/>".join(
            _esc(l) for l in str(cd["client_address"]).splitlines() if l.strip()))
    att = " · ".join(x for x in [str(cd.get("attention") or "").strip(),
                                 str(cd.get("designation") or "").strip()] if x)
    if att:
        cust_parts.append(f"<br/><b>Attention:</b> {_esc(att)}")
    if cd.get("email"):
        cust_parts.append(f"<br/><font color='#2b5fb8'>{_esc(cd['email'])}</font>")
    customer = Paragraph("".join(cust_parts), _ps("customer", 12.5, SECONDARY))
    subject = Paragraph(
        "<font size={:.1f} color='#999999'><b>S U B J E C T</b></font><br/>".format(11 * PX)
        + f"<b>{_esc(cd.get('subject') or ('Quotation for ' + str(cd.get('client_name') or '')))}</b>",
        _ps("subject", 13, TEXT, align=2))
    row3 = Table([[customer, subject]], colWidths=[CONTENT_W - 250 * PX, 250 * PX])
    row3.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, 0), 1, HAIRLINE2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 16 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(row3)
    story.append(Spacer(1, 14 * PX))

    # ── Brands strip ──
    strip = Table([[Paragraph(_esc(BRANDS), _ps("brands", 11, MUTED))]], colWidths=[CONTENT_W])
    strip.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), STRIP_FILL),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 14 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 14 * PX),
        ("TOPPADDING", (0, 0), (-1, -1), 9 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 9 * PX)]))
    story.append(strip)
    story.append(Spacer(1, 12 * PX))

    # ── Items table ──
    col_w = [34 * PX, 0, 70 * PX, 110 * PX, 120 * PX]
    col_w[1] = CONTENT_W - col_w[0] - col_w[2] - col_w[3] - col_w[4]
    head_st = _ps("thead", 12, colors.white, "Helvetica-Bold")
    head_r = _ps("theadR", 12, colors.white, "Helvetica-Bold", align=2)
    rows = [[Paragraph("#", head_st), Paragraph("Item &amp; Description", head_st),
             Paragraph("Qty", head_r), Paragraph("Unit Price", head_r), Paragraph("Amount", head_r)]]
    title_st = _ps("itTitle", 13, TITLE_DARK, "Helvetica-Bold", leading_mult=1.3)
    sub_st = _ps("itSub", 11.5, SUBLINE, leading_mult=1.35)
    num_st = _ps("itNum", 12.5, SECONDARY)
    qty_st = _ps("itQty", 12.5, TEXT, align=2)
    uom_st = _ps("itUom", 10, MUTED, align=2)
    price_st = _ps("itPrice", 12.5, TEXT, align=2)
    amt_st = _ps("itAmt", 12.5, TEXT, "Helvetica-Bold", align=2)

    for it in items:
        no = it.get("item_no")
        name = str(it.get("product_name") or "").strip()
        code = str(it.get("product_code") or "").strip()
        desc = str(it.get("description") or "").strip()
        sub_lines = []
        if code and code.lower() != "n/a" and code != name:
            sub_lines.append(f"Model No.: {_esc(code)}")
        if desc and desc != name:
            for ln in desc.splitlines():
                ln = ln.strip()
                if not ln or ln == name:
                    continue
                sub_lines.append(("• " + _esc(ln.lstrip("-*• ").strip()))
                                 if ln[:1] in "-*•" else _esc(ln))
        text_col = [Paragraph(_esc(name), title_st)]
        if sub_lines:
            text_col.append(Spacer(1, 2 * PX))
            text_col.append(Paragraph("<br/>".join(sub_lines), sub_st))
        img_bytes = (images or {}).get(no)
        desc_cell = Table([[_Thumb(img_bytes), text_col]],
                          colWidths=[_Thumb.SIZE + 10 * PX,
                                     col_w[1] - _Thumb.SIZE - 10 * PX - 12 * PX])
        desc_cell.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                       ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                       ("TOPPADDING", (0, 0), (-1, -1), 0),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        qty_txt = f"{float(it.get('quantity') or 0):g}"
        qty_cell = [Paragraph(qty_txt, qty_st), Paragraph(str(it.get("uom") or "pc(s)"), uom_st)]
        rows.append([Paragraph(str(no), num_st), desc_cell, qty_cell,
                     Paragraph(_fmt(it.get("total_amount")), price_st),
                     Paragraph(_fmt(it.get("total_unit_price")), amt_st)])

    items_tbl = Table(rows, colWidths=col_w, repeatRows=1)
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 1, HAIRLINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 6 * PX),
        ("TOPPADDING", (0, 0), (-1, 0), 9 * PX), ("BOTTOMPADDING", (0, 0), (-1, 0), 9 * PX),
        ("TOPPADDING", (0, 1), (-1, -1), 14 * PX), ("BOTTOMPADDING", (0, 1), (-1, -1), 14 * PX)]))
    story.append(items_tbl)
    story.append(Spacer(1, 14 * PX))

    # ── Totals block (right-aligned, 320px) ──
    tot_label = _ps("totLabel", 12.5, HexColor("#666666"))
    tot_value = _ps("totValue", 12.5, TEXT, "Helvetica-Bold", align=2)
    grand_label = _ps("grandLabel", 13, ACCENT, "Helvetica-Bold")
    grand_value = _ps("grandValue", 13, ACCENT, "Helvetica-Bold", align=2)
    opt = summary.get("vat_option", "inclusive")
    tot_rows = []
    if opt == "inclusive":
        tot_rows = [[Paragraph("Total Amount (VAT Exclusive)", tot_label),
                     Paragraph("PHP " + _fmt(summary["total_ex_vat"]), tot_value)],
                    [Paragraph("VAT (12%)", tot_label),
                     Paragraph("PHP " + _fmt(summary["vat"]), tot_value)]]
        grand_text = "Total (VAT Inclusive)"
    elif opt == "zero":
        grand_text = "Total (Zero-Rated)"
    else:
        grand_text = "Total (VAT Exclusive)"

    tot_w = [200 * PX, 120 * PX]
    blocks = []
    if tot_rows:
        t = Table(tot_rows, colWidths=tot_w)
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, HAIRLINE),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 7 * PX),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 7 * PX)]))
        blocks.append(t)
        blocks.append(Spacer(1, 6 * PX))
    g = Table([[Paragraph(grand_text, grand_label),
                Paragraph("PHP " + _fmt(summary["total"]), grand_value)]],
              colWidths=[tot_w[0] - 14 * PX, tot_w[1] + 14 * PX])
    g.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TOTAL_FILL),
                           ("BOX", (0, 0), (-1, -1), 1, TOTAL_BORDER),
                           ("LEFTPADDING", (0, 0), (0, 0), 14 * PX),
                           ("RIGHTPADDING", (-1, 0), (-1, 0), 14 * PX),
                           ("TOPPADDING", (0, 0), (-1, -1), 11 * PX),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 11 * PX)]))
    blocks.append(g)
    totals_wrap = Table([[blocks]], colWidths=[CONTENT_W])
    totals_wrap.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), CONTENT_W - 320 * PX),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                     ("TOPPADDING", (0, 0), (-1, -1), 0),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(totals_wrap))
    story.append(Spacer(1, 16 * PX))

    # ── Terms strip: 4 equal columns ──
    term_label = _ps("termLabel", 10, LABEL, "Helvetica-Bold")
    term_value = _ps("termValue", 12, TEXT, leading_mult=1.35)
    term_cells = []
    for label, key in [("V A L I D I T Y", "validity"), ("D E L I V E R Y", "delivery"),
                       ("P A Y M E N T", "payment"), ("W A R R A N T Y", "warranty")]:
        term_cells.append([Paragraph(label, term_label), Spacer(1, 3 * PX),
                           Paragraph(_esc(terms.get(key.replace(" ", "").lower()) or "—"), term_value)])
    terms_tbl = Table([term_cells], colWidths=[CONTENT_W / 4.0] * 4)
    terms_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, HAIRLINE),
        ("INNERGRID", (0, 0), (-1, -1), 1, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 12 * PX),
        ("TOPPADDING", (0, 0), (-1, -1), 10 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 10 * PX)]))
    story.append(KeepTogether(terms_tbl))
    story.append(Spacer(1, 20 * PX))

    # ── Bank details | signature ──
    bank_head = _ps("bankHead", 11, ACCENT, "Helvetica-Bold")
    kv_line = _ps("kv", 12, SECONDARY, leading_mult=1.7)
    bank_body = "<br/>".join(
        f"<font color='#999999'>{_esc(k)}:</font>  {_esc(v)}" for k, v in BANK_LINES)
    bank_col = [Paragraph("B A N K &nbsp; D E T A I L S", bank_head), Spacer(1, 6 * PX),
                Paragraph(bank_body, kv_line)]
    sig_lines = [f"<b><font size={14 * PX:.1f} color='#222222'>{_esc(sig_name)}</font></b>"]
    if cd.get("signature_designation"):
        sig_lines.append(f"<font color='#777777'>{_esc(cd['signature_designation'])}</font>")
    extra = []
    if cd.get("signature_viber"):
        extra.append(f"<font color='#999999'>Viber:</font> {_esc(cd['signature_viber'])}")
    if cd.get("signature_mobile"):
        extra.append(f"<font color='#999999'>Mobile:</font> {_esc(cd['signature_mobile'])}")
    if cd.get("signature_email"):
        extra.append(f"<font color='#2b5fb8'>{_esc(cd['signature_email'])}</font>")
    sig_col = [Paragraph("S I N C E R E L Y &nbsp; Y O U R S", bank_head), Spacer(1, 6 * PX),
               Paragraph("<br/>".join(sig_lines), _ps("sigName", 12.5, TEXT, leading_mult=1.5))]
    if extra:
        sig_col += [Spacer(1, 5 * PX), Paragraph("<br/>".join(extra), kv_line)]
    bank_sig = Table([[bank_col, sig_col]],
                     colWidths=[CONTENT_W - 250 * PX - 40 * PX, 250 * PX + 40 * PX])
    bank_sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                  ("RIGHTPADDING", (0, 0), (0, 0), 40 * PX),
                                  ("RIGHTPADDING", (1, 0), (1, 0), 0),
                                  ("LEFTPADDING", (1, 0), (1, 0), 40 * PX),
                                  ("TOPPADDING", (0, 0), (-1, -1), 0),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(bank_sig))
    story.append(Spacer(1, 10 * PX))

    # ── Optional note + disclaimer ──
    note = (note or "").strip()
    if note:
        story.append(Paragraph(f"<b>Note:</b> {_esc(note)}", _ps("note", 11.5, SECONDARY)))
        story.append(Spacer(1, 6 * PX))
    story.append(Paragraph(DISCLAIMER, _ps("disclaimer", 11, LABEL)))

    doc.build(story)
    return buf.getvalue()
