"""PRDocTemplate -- ReportLab BaseDocTemplate for Purchase Request PDFs."""

import os
import logging

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, Frame, Image, PageTemplate
from PIL import Image as PILImage
from dateutil.parser import parse as dateutil_parse

from pdf_generators.utils import get_static_path

logger = logging.getLogger(__name__)


class PRDocTemplate(BaseDocTemplate):
    """Custom document template for Purchase Request forms.

    Draws a branded header/footer on every page:
      - Watermark (bg1.png at 20% opacity)
      - "PURCHASE REQUEST FORM" title centred
      - Logo (logo.png, 2.3 x 0.65 in) left-aligned below title
      - Two-column info block: Request Details (left) and Company Information (right)

    The caller must set ``doc.pr_details`` (a dict) before calling ``doc.build()``.
    """

    def __init__(self, filename, items_count=0, pagesize=A4, **kwargs):
        kwargs.update({
            "leftMargin":   0.5  * inch,
            "rightMargin":  0.5  * inch,
            "topMargin":    3.1  * inch,
            "bottomMargin": 0.25 * inch,
        })
        super().__init__(filename, pagesize=pagesize, **kwargs)

        self.items_count = items_count

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
                    id="content",
                )],
                onPage=self.add_header_footer,
            )
        ])

    # ------------------------------------------------------------------
    # Header / footer callback
    # ------------------------------------------------------------------
    def add_header_footer(self, canvas, doc):
        canvas.saveState()

        PAGE_W = self.page_width
        PAGE_H = self.page_height
        L      = self.leftMargin

        # ── Watermark ────────────────────────────────────────────────
        try:
            wm_path = get_static_path("images", "bg1.png")
            if os.path.exists(wm_path):
                with PILImage.open(wm_path) as img:
                    iw, ih = img.size
                aspect   = iw / ih
                target_h = PAGE_H * 0.55
                target_w = target_h * aspect
                wm_x = (PAGE_W - target_w) / 2
                wm_y = (PAGE_H - target_h) / 2
                canvas.setFillAlpha(0.20)
                canvas.drawImage(wm_path, wm_x, wm_y,
                                 width=target_w, height=target_h, mask="auto")
                canvas.setFillAlpha(1.0)
        except Exception as e:
            logger.error("Watermark error: %s", e)

        # ── Title ────────────────────────────────────────────────────
        title_y = PAGE_H - 0.45 * inch
        canvas.setFont("Helvetica-Bold", 14)
        title = "PURCHASE REQUEST FORM"
        tw = canvas.stringWidth(title, "Helvetica-Bold", 14)
        canvas.drawString((PAGE_W - tw) / 2, title_y, title)

        # ── Logo (left, below title) ─────────────────────────────────
        logo_path = get_static_path("images", "logo.png")
        logo_bottom = title_y - 0.85 * inch
        if os.path.exists(logo_path):
            try:
                logo = Image(logo_path, width=2.3 * inch, height=0.65 * inch)
                logo.drawOn(canvas, L, logo_bottom)
            except Exception as e:
                logger.error("Logo error: %s", e)

        # ── Helpers ──────────────────────────────────────────────────
        def draw_label(x, y, text):
            canvas.setFont("Helvetica-Bold", 8.5)
            canvas.drawString(x, y, text)

        def draw_value(x, y, text, max_width=None):
            canvas.setFont("Helvetica", 8.5)
            if max_width:
                while canvas.stringWidth(text, "Helvetica", 8.5) > max_width and len(text) > 4:
                    text = text[:-2] + "\u2026"
            canvas.drawString(x, y, text)

        def draw_inline(x, y, label, value, max_val_width=None):
            canvas.setFont("Helvetica-Bold", 8.5)
            canvas.drawString(x, y, label)
            lw = canvas.stringWidth(label, "Helvetica-Bold", 8.5)
            draw_value(x + lw, y, value, max_width=max_val_width)

        LINE = 0.175 * inch

        cd = self.pr_details  # set by the caller before build()

        # ── Format dates ─────────────────────────────────────────────
        def fmt_date(raw):
            if not raw:
                return ""
            try:
                return dateutil_parse(raw).strftime("%B %d, %Y")
            except Exception:
                return raw

        pr_date     = fmt_date(cd.get("pr_date", ""))
        date_needed = fmt_date(cd.get("date_needed", ""))

        # ── Two-column info block ────────────────────────────────────
        info_top = logo_bottom - 0.18 * inch

        # LEFT column -- Request Details
        vx = L
        vy = info_top

        draw_label(vx, vy, "REQUEST DETAILS:")
        vy -= LINE
        draw_inline(vx, vy, "Date: ", pr_date)
        vy -= LINE
        draw_inline(vx, vy, "Date Needed: ", date_needed)
        vy -= LINE
        draw_inline(vx, vy, "Urgency: ", cd.get("urgency", ""))
        vy -= LINE
        draw_inline(vx, vy, "Reference Number: ", cd.get("reference_number", ""),
                    max_val_width=2.2 * inch)
        vy -= LINE
        draw_inline(vx, vy, "PR No. from Client: ", cd.get("pr_number_client", ""),
                    max_val_width=2.0 * inch)

        # RIGHT column -- Company Information
        rx2 = L + 3.8 * inch
        ry  = info_top

        draw_label(rx2, ry, "COMPANY INFORMATION:")
        ry -= LINE
        draw_label(rx2, ry, cd.get("company_name", ""))
        ry -= LINE
        draw_value(rx2, ry, cd.get("company_address", ""), max_width=2.8 * inch)
        ry -= LINE
        draw_inline(rx2, ry, "Contact Person: ", cd.get("contact_person", ""),
                    max_val_width=1.8 * inch)
        ry -= LINE
        draw_inline(rx2, ry, "Designation: ", cd.get("designation", ""),
                    max_val_width=1.8 * inch)
        ry -= LINE
        draw_inline(rx2, ry, "Email: ", cd.get("contact_email", ""),
                    max_val_width=1.8 * inch)
        ry -= LINE
        draw_inline(rx2, ry, "Phone: ", cd.get("contact_phone", ""),
                    max_val_width=1.8 * inch)

        canvas.restoreState()

    # ------------------------------------------------------------------
    # Convenience: build the PDF from a list of flowable elements
    # ------------------------------------------------------------------
    def build_pdf(self, elements=None):
        """Build the PDF document.

        If *elements* is ``None`` an empty list is used (the header/footer
        callback still renders on every page).
        """
        if elements is None:
            elements = []
        self.build(elements)
