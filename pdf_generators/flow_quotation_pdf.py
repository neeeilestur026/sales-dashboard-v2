"""Flow quotation PDF renderer — modern layout v2 (Addendum 87).

Implements the gradient/card design from the user's reference: 6px gradient top bar,
Archivo/Lato typography, reference pill chip, meta / PREPARED FOR / SUBJECT cards,
AUTHORIZED DISTRIBUTOR strip, gradient-header items table with zebra rows and rounded
thumbnails, requested-vs-offered pairing (A86), gradient grand-total bar, terms strip,
rule-line section headings with a signature line, disclaimer, and a full-bleed gradient
footer band with "Page X of Y" on every page.

The DOCUMENT corners stay square — the reference's rounded sheet / drop shadow / gray
desk are on-screen web effects only. Rounded corners apply only to inner elements.

Standalone (ReportLab + vendored TTFs in static/fonts; falls back to Helvetica if the
fonts are missing so rendering never fails). ACCENT is the single theming token — the
dark/soft/border shades and every bar, chip, and border derive from it.
"""

import logging
import os
import re
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, KeepTogether,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus import Image as RLImage
from PIL import Image as PILImage

# A213 — shared with quotation_parser.py, which has to recognise this heading to know that the rows
# under it belong to no item. One constant, so the two cannot drift.
from pdf_generators.utils import QUO_SCOPE_INTABLE_HEADING

logger = logging.getLogger(__name__)

# ── Page metrics ──────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4                          # 595.27 x 841.89 pt
PX = PAGE_W / 820.0                          # spec px (820px sheet) → pt
MARGIN = 48 * PX
TOP_BAR_H = 6 * PX                           # gradient accent bar, very top
TOP_MARGIN = 32 * PX + TOP_BAR_H
FOOTER_BAND_H = (16 * 2 + 14) * PX
BOTTOM_MARGIN = FOOTER_BAND_H + 10 * PX
CONTENT_W = PAGE_W - 2 * MARGIN

# ── Color system: ONE accent drives everything ────────────────────────────────
def _mix(c1, c2, t):
    """Mix color c1 toward c2 by t (0..1)."""
    return Color(c1.red + (c2.red - c1.red) * t,
                 c1.green + (c2.green - c1.green) * t,
                 c1.blue + (c2.blue - c1.blue) * t)

ACCENT = HexColor("#C0392B")                            # the single theming token
ACCENT_DARK = _mix(ACCENT, colors.black, 0.28)
ACCENT_SOFT = _mix(ACCENT, colors.white, 0.92)
ACCENT_BORDER = _mix(ACCENT, colors.white, 0.72)
# Gradient pair: EVERY gradient element (top bar, QUOTATION title, table header,
# grand-total bar, footer band) uses one identical 135° fade dark blue → red.
ACCENT_G1 = HexColor("#1F4E79")                         # gradient start (dark blue)
ACCENT_G2 = ACCENT                                      # gradient end (red)
# Navy tints, derived the same way as the red ones — used by the summary blocks
# (Scope of Supply / Exclusions / Options) so their edges match the gradient navy.
NAVY_SOFT = _mix(ACCENT_G1, colors.white, 0.92)
NAVY_BORDER = _mix(ACCENT_G1, colors.white, 0.72)

HEADING = HexColor("#1a1a1a")
TEXT = HexColor("#333333")
BODY2 = HexColor("#555555")
BODY3 = HexColor("#666666")
MUTED7 = HexColor("#777777")
MUTED8 = HexColor("#888888")
LABEL9 = HexColor("#999999")
LABELA = HexColor("#aaaaaa")
LABELB = HexColor("#bbbbbb")
HAIR_E = HexColor("#eeeeee")
HAIR_F0 = HexColor("#f0f0f0")
HAIR_EC = HexColor("#ececec")
CARD_A = HexColor("#faf9f8")
CARD_B = HexColor("#fbfbfc")
THUMB_BORDER = HexColor("#e6e6e6")
STRIPE_A = HexColor("#f4f4f4")
STRIPE_B = HexColor("#ececec")
LINK = HexColor("#2b5fb8")

# ── Fonts: vendored Lato/Archivo, graceful Helvetica fallback ─────────────────
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FONT_DIR = os.path.join(_ROOT, "static", "fonts")
_LOGO_PATH = os.path.join(_ROOT, "static", "images", "logo.png")

_FONTS = {
    "Lato": ("Lato-Regular.ttf", "Helvetica"),
    "Lato-Bold": ("Lato-Bold.ttf", "Helvetica-Bold"),
    "Lato-Black": ("Lato-Black.ttf", "Helvetica-Bold"),
    "Archivo-SemiBold": ("Archivo-SemiBold.ttf", "Helvetica-Bold"),
    "Archivo-Bold": ("Archivo-Bold.ttf", "Helvetica-Bold"),
    "Archivo-ExtraBold": ("Archivo-ExtraBold.ttf", "Helvetica-Bold"),
}
_FACE = {}
for _name, (_file, _fallback) in _FONTS.items():
    try:
        pdfmetrics.registerFont(TTFont(_name, os.path.join(_FONT_DIR, _file)))
        _FACE[_name] = _name
    except Exception:
        logger.warning("font %s unavailable — falling back to %s", _name, _fallback)
        _FACE[_name] = _fallback
try:  # inline <b> inside Lato paragraphs
    pdfmetrics.registerFontFamily("Lato", normal=_FACE["Lato"], bold=_FACE["Lato-Bold"],
                                  italic=_FACE["Lato"], boldItalic=_FACE["Lato-Bold"])
except Exception:
    pass

LATO = _FACE["Lato"]
LATO_B = _FACE["Lato-Bold"]
LATO_BLK = _FACE["Lato-Black"]
ARCH_SB = _FACE["Archivo-SemiBold"]
ARCH_B = _FACE["Archivo-Bold"]
ARCH_XB = _FACE["Archivo-ExtraBold"]

# ── Company constants ─────────────────────────────────────────────────────────
COMPANY_NAME = "H.O ESTUR CORPORATION"
COMPANY_ADDRESS = ("Blk 90 Lot 2 & 4 Ph 1 University Heights, Brgy Kaypian,\n"
                   "District 1, San Jose Del Monte, Bulacan,\nPhilippines, 3023")
COMPANY_WEBSITE = "www.hiescorp.com"
BRANDS = "Cejn  ·  Snap-on Bluepoint  ·  Hydraulic Technologies  ·  Chicago Pneumatics  ·  RAD Torque Solutions"
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


def _num_key(v):
    """A205 — order option keys numerically so 10 follows 2 rather than preceding it."""
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return float("inf")


def _fmt(n):
    try:
        return f"{float(n):,.2f}"
    except Exception:
        return str(n)


def _esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _hx(c):
    return "#%02x%02x%02x" % (int(c.red * 255), int(c.green * 255), int(c.blue * 255))


def _sp(text):
    """Letter-spaced micro-label ('PREPARED FOR' → 'P R E P A R E D  F O R').

    Words keep a wider gap — letter-spacing every character with a single space ran
    words together, which only became visible once labels got longer than two words."""
    return "   ".join(" ".join(list(w)) for w in str(text).split(" ") if w)


def _ps(name, size_px, color=TEXT, font=None, align=0, leading_mult=1.45, **kw):
    size = size_px * PX
    return ParagraphStyle(name=name, fontName=font or LATO, fontSize=size, textColor=color,
                          alignment=align, leading=size * leading_mult, **kw)


# ── Custom flowables ──────────────────────────────────────────────────────────
def _desc_indent():
    """Width of the thumbnail gutter — where the description text starts inside its column."""
    return _Thumb.SIZE + 10 * PX


def _desc_text_width(col_w1):
    """Usable width of the description TEXT, inside the item column and beside the thumbnail.

    A213 — the scope block prints under this text and must line up with it exactly, so both callers
    take the width from here rather than repeating the arithmetic. ~219pt on an ordinary quotation;
    ~176pt once alternative offers widen the index column, which is why the scope drops to one
    column there (see _scope_rows)."""
    return col_w1 - _desc_indent() - 10 * PX


class _Thumb(Flowable):
    """66px product thumbnail, rounded, strictly boxed; striped placeholder when no image."""
    SIZE = 66 * PX
    RAD = 6 * PX

    def __init__(self, img_bytes=None):
        super().__init__()
        self.img_bytes = img_bytes
        self.width = self.height = self.SIZE

    def draw(self):
        c = self.canv
        s = self.SIZE
        c.saveState()
        clip = c.beginPath()
        clip.roundRect(0, 0, s, s, self.RAD)
        c.clipPath(clip, stroke=0, fill=0)
        drew = False
        if self.img_bytes:
            try:
                pil = PILImage.open(BytesIO(self.img_bytes))
                if pil.mode not in ("RGB", "RGBA"):
                    pil = pil.convert("RGB")
                pil.thumbnail((220, 220))          # embed small — slot is 66px
                iw, ih = pil.size
                scale = min(s / iw, s / ih) if iw and ih else 1
                w, h = iw * scale, ih * scale
                c.setFillColor(colors.white)
                c.rect(0, 0, s, s, stroke=0, fill=1)
                c.drawImage(ImageReader(pil), (s - w) / 2, (s - h) / 2, w, h,
                            preserveAspectRatio=True, mask="auto")
                drew = True
            except Exception:
                logger.warning("thumbnail decode failed; using placeholder")
        if not drew:
            c.setFillColor(STRIPE_A)
            c.rect(0, 0, s, s, stroke=0, fill=1)
            c.setStrokeColor(STRIPE_B)
            c.setLineWidth(2.2)
            stripes = c.beginPath()
            x = -s
            while x < s:
                stripes.moveTo(x, 0)
                stripes.lineTo(x + s, s)
                x += 7 * PX
            c.drawPath(stripes, stroke=1, fill=0)
            c.setFillColor(colors.white)
            c.rect(s * 0.06, s * 0.38, s * 0.88, s * 0.24, stroke=0, fill=1)
            c.setFillColor(MUTED8)
            c.setFont("Courier", 6.5 * PX)
            c.drawCentredString(s / 2, s * 0.45, "product shot")
        c.restoreState()
        c.saveState()
        c.setStrokeColor(THUMB_BORDER)
        c.setLineWidth(1)
        c.roundRect(0, 0, s, s, self.RAD, stroke=1, fill=0)
        c.restoreState()


def _draw_ref_chip(c, right_x, top_y, text):
    """Reference pill drawn at FIXED canvas coordinates (right-aligned at right_x, top at top_y)."""
    text = str(text or "").strip() or "—"
    fsize = 11.5 * PX
    pad_x, pad_y, dot = 12 * PX, 5 * PX, 6 * PX
    tw = pdfmetrics.stringWidth(text, LATO_B, fsize)
    w = pad_x * 2 + dot + 6 * PX + tw
    h = pad_y * 2 + fsize * 1.15
    x, y = right_x - w, top_y - h
    c.saveState()
    c.setFillColor(ACCENT_SOFT)
    c.setStrokeColor(ACCENT_BORDER)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, h / 2, stroke=1, fill=1)
    cy = y + h / 2
    c.setFillColor(ACCENT)
    c.circle(x + pad_x + dot / 2, cy, dot / 2, stroke=0, fill=1)
    c.setFillColor(ACCENT_DARK)
    c.setFont(LATO_B, fsize)
    c.drawString(x + pad_x + dot + 6 * PX, cy - fsize * 0.36, text)
    c.restoreState()


class _GradientBar(Flowable):
    """Grand-total bar: rounded accent→accentDark gradient, white label + amount."""

    def __init__(self, width, label, amount):
        super().__init__()
        self.width = width
        self.label = label
        self.amount = amount
        self.height = 11 * 2 * PX + 18 * PX * 1.1

    def draw(self):
        c = self.canv
        c.saveState()
        clip = c.beginPath()
        clip.roundRect(0, 0, self.width, self.height, 8 * PX)
        c.clipPath(clip, stroke=0, fill=0)
        # 135° fade (top-left → bottom-right), same pair as every other gradient element
        c.linearGradient(0, self.height, self.width, 0, [ACCENT_G1, ACCENT_G2], extend=True)
        c.setFillColor(colors.white)
        c.setFont(ARCH_B, 13 * PX)
        c.drawString(18 * PX, self.height / 2 - 13 * PX * 0.36, self.label)
        c.setFont(ARCH_XB, 18 * PX)
        c.drawRightString(self.width - 18 * PX, self.height / 2 - 18 * PX * 0.36, self.amount)
        c.restoreState()


class _SectionHead(Flowable):
    """Uppercase accentDark heading with a flex-fill hairline rule to the right."""

    def __init__(self, text, width):
        super().__init__()
        self.text = _sp(text)
        self.width = width
        self.fsize = 11 * PX
        self.height = self.fsize * 1.4

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(ACCENT_DARK)
        c.setFont(LATO_B, self.fsize)
        base = self.height / 2 - self.fsize * 0.36
        c.drawString(0, base, self.text)
        tw = pdfmetrics.stringWidth(self.text, LATO_B, self.fsize)
        c.setStrokeColor(HAIR_E)
        c.setLineWidth(1)
        mid = self.height / 2
        c.line(tw + 10 * PX, mid, self.width, mid)
        c.restoreState()


# ── Page chrome: gradient top bar + footer band; Page X of Y via 2-pass canvas ─
class _NumberedCanvas(_canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_states = []

    def showPage(self):
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_states)
        for state in self._saved_states:
            self.__dict__.update(state)
            self.setFillColor(LABELA)
            self.setFont(LATO, 9.5 * PX)
            self.drawRightString(PAGE_W - MARGIN, FOOTER_BAND_H + 5 * PX,
                                 f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


LOGO_H = 96 * PX            # bigger logo — drawn partly INTO the top margin so content doesn't move
LOGO_RISE = 14 * PX         # how far above the header zone the logo starts (eats unused margin)
HEADER_LOCK_H = (96 - 14) * PX   # fixed header zone the flow reserves (logo bottom relative to frame top)


class _QuoTemplate(BaseDocTemplate):
    def __init__(self, buf, footer_left, footer_right, ref_no="", **kw):
        super().__init__(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN, **kw)
        self._footer_left = footer_left
        self._footer_right = footer_right
        self._ref_no = ref_no
        frame = Frame(MARGIN, BOTTOM_MARGIN, CONTENT_W, PAGE_H - TOP_MARGIN - BOTTOM_MARGIN,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="quo", frames=[frame], onPage=self._on_page)])

    def _grad_rect(self, canvas, x, y, w, h):
        canvas.saveState()
        clip = canvas.beginPath()
        clip.rect(x, y, w, h)
        canvas.clipPath(clip, stroke=0, fill=0)
        # 135° fade (top-left → bottom-right): PDF y-axis points up, so start at (x, y+h)
        canvas.linearGradient(x, y + h, x + w, y, [ACCENT_G1, ACCENT_G2], extend=True)
        canvas.restoreState()

    def _draw_locked_header(self, canvas):
        """Logo + QUOTATION title + reference chip at FIXED coordinates (page 1 only) —
        nothing in the content flow can ever move them."""
        top = PAGE_H - TOP_MARGIN                  # top of the header zone
        try:
            pil = PILImage.open(_LOGO_PATH)
            iw, ih = pil.size
            h = LOGO_H
            w = h * (iw / ih) if ih else h
            # start LOGO_RISE above the zone (inside the top margin) so the bigger logo
            # doesn't push the content down or move the locked title/chip
            canvas.drawImage(_LOGO_PATH, MARGIN, top + LOGO_RISE - h, w, h,
                             preserveAspectRatio=True, mask="auto")
        except Exception:
            canvas.saveState()
            canvas.setFillColor(HEADING)
            canvas.setFont(ARCH_B, 16 * PX)
            canvas.drawString(MARGIN, top - 16 * PX, COMPANY_NAME)
            canvas.restoreState()
        title_size = 46 * PX
        title_y = top - title_size * 0.82
        title_w = pdfmetrics.stringWidth("QUOTATION", ARCH_XB, title_size)
        title_x = PAGE_W - MARGIN - title_w
        canvas.saveState()
        try:
            # Gradient TITLE: the glyphs become the clipping path (text render mode 7),
            # then the shared 135° blue→red fade is painted through them.
            txt = canvas.beginText(title_x, title_y)
            txt.setTextRenderMode(7)
            txt.setFont(ARCH_XB, title_size)
            txt.textLine("QUOTATION")
            canvas.drawText(txt)
            canvas.linearGradient(title_x, title_y + title_size * 0.75,
                                  title_x + title_w, title_y - title_size * 0.1,
                                  [ACCENT_G1, ACCENT_G2], extend=True)
        except Exception:
            canvas.setFillColor(ACCENT)
            canvas.setFont(ARCH_XB, title_size)
            canvas.drawRightString(PAGE_W - MARGIN, title_y, "QUOTATION")
        canvas.restoreState()
        _draw_ref_chip(canvas, PAGE_W - MARGIN, top - title_size * 0.95 - 6 * PX, self._ref_no)

    def _on_page(self, canvas, doc):
        # 6px gradient bar flush at the very top (square document corners)
        self._grad_rect(canvas, 0, PAGE_H - TOP_BAR_H, PAGE_W, TOP_BAR_H)
        # locked header on the first page
        if canvas.getPageNumber() == 1:
            self._draw_locked_header(canvas)
        # gradient footer band
        self._grad_rect(canvas, 0, 0, PAGE_W, FOOTER_BAND_H)
        canvas.saveState()
        y = FOOTER_BAND_H / 2 - (12 * PX) * 0.36
        canvas.setFillColor(colors.white)
        canvas.setFont(ARCH_XB, 12 * PX)
        canvas.drawString(MARGIN, y, self._footer_left)
        canvas.setFillColor(Color(1, 1, 1, alpha=0.92))
        canvas.setFont(LATO, 12 * PX)
        canvas.drawRightString(PAGE_W - MARGIN, y, self._footer_right)
        canvas.restoreState()


# ── Public API (route contract unchanged) ─────────────────────────────────────
def _alt_row_styles(span_rows):
    """A205 — SPAN the banner and per-option subtotal rows across all five columns and tint them, so
    they read as section furniture rather than as another priced line. ROWBACKGROUNDS zebra-stripes
    every body row, so each of these needs its own BACKGROUND to override it; without that a subtotal
    can land on a white stripe and look exactly like an item."""
    out = []
    for ri, kind in span_rows or []:
        out.append(("SPAN", (0, ri), (-1, ri)))
        # ACCENT_SOFT is the existing red-on-white tint used elsewhere for accent panels; the
        # subtotal uses the neutral card tint so the eye reads banner > subtotal > item.
        out.append(("BACKGROUND", (0, ri), (-1, ri),
                    ACCENT_SOFT if kind == "banner" else CARD_A))
        out.append(("TOPPADDING", (0, ri), (-1, ri), 7 * PX))
        out.append(("BOTTOMPADDING", (0, ri), (-1, ri), 7 * PX))
        if kind == "subtotal":
            out.append(("LINEABOVE", (0, ri), (-1, ri), 0.6, HAIR_EC))
    return out


def build_summary_table(total_ex_vat, vat_option, discount_pct=0):
    """Totals for the summary block. Returns a dict the renderer interprets.

    A quotation-level discount % is applied to the pre-VAT subtotal: VAT and the grand total are
    computed on the discounted (net) amount. `total_ex_vat` in the returned dict is the NET ex-VAT
    figure (so the existing renderer keys keep their meaning); `gross_ex_vat`/`discount_*` carry the
    extra rows. When discount_pct == 0 the output is identical to before (net == gross)."""
    opt = (vat_option or "inclusive").strip().lower()
    try:
        dp = max(0.0, min(100.0, float(discount_pct or 0)))
    except (TypeError, ValueError):
        dp = 0.0
    disc_amt = round(total_ex_vat * dp / 100.0, 2)
    net_ex = total_ex_vat - disc_amt
    vat = net_ex * 0.12 if opt == "inclusive" else 0.0
    return {"gross_ex_vat": total_ex_vat, "discount_pct": dp, "discount_amt": disc_amt,
            "total_ex_vat": net_ex, "vat": vat, "total": net_ex + vat, "vat_option": opt}


def _card(content, width, fill, border=HAIR_E, left_accent=None, pad=(16, 8)):
    """A rounded card table around a list of flowables.

    `left_accent` is the color of a 3px left edge (True keeps the historical red)."""
    t = Table([[content]], colWidths=[width])
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 1, border),
        ("ROUNDEDCORNERS", [6 * PX] * 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), pad[0] * PX),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad[0] * PX),
        ("TOPPADDING", (0, 0), (-1, -1), pad[1] * PX),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad[1] * PX),
    ]
    if left_accent:
        edge = ACCENT if left_accent is True else left_accent
        style.append(("LINEBEFORE", (0, 0), (0, -1), 3, edge))
    t.setStyle(TableStyle(style))
    return t


# ── Summary blocks: Scope of Supply / Exclusions / Options ────────────────────
def _bullet_para(text, style):
    """One '• text' line. **asterisks** become bold — applied AFTER escaping, so
    user text can never inject markup."""
    body = _esc(str(text or ""))
    body = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", body)
    return Paragraph("&bull;&nbsp;" + body, style)


def _cap_name(name, limit=600, token=40):
    """A173 — keep a product name inside its row.

    The item row is a one-row table nested in another, so neither can split: an unbounded name is a
    LayoutError waiting to happen (~2,800 chars), and a single unbreakable token wider than the 219pt
    text column cannot wrap at all. Reps do paste spec sheets into this field, and the front end also
    falls back to using the name as the description, so this is reachable in normal use.
    Two guards: a length cap, and zero-width spaces sprinkled into any monster token so it wraps."""
    s = str(name or "")
    if len(s) > limit:
        s = s[:limit - 1].rstrip() + "\u2026"
    return " ".join(
        w if len(w) <= token else "\u200b".join(w[i:i + token] for i in range(0, len(w), token))
        for w in s.split(" ")
    )


def _scope_rows(bullets, width):
    """A213 — the scope of supply, as rows for the ITEMS TABLE rather than a card after the totals.

    Returns a list of flowable-lists, one per table row, all sized to `width` (the description text
    width). The caller drops each into the description column of its own row, leaving QTY / UNIT
    PRICE / AMOUNT blank.

    WHY ROWS AND NOT ONE CELL. A table row cannot split across pages and a nested table cannot split
    at all, so any single-cell layout is capped by the frame height — which is how the old
    _bullet_block ends up printing "… +N more (shortened to fit the page)". Inclusions are
    contractual: silently dropping one drops a commitment. Rows split between each other, so the
    block flows onto the next page instead, losing nothing.

    ONE BULLET PAIR PER ROW, not N. With N pairs a row's height is a sum, and bounding it needs a
    bound on the pair count AND on every bullet's line count. With one pair the bound depends only on
    the single worst bullet, which _cap_name already guarantees:

        frame 773.65 − repeated header 26.10 − row padding 11.62 = 735.93pt available
        one bullet capped at 320 chars ÷ 25 chars/line (the narrow, alternative-offers case)
          = 13 lines × 8.62pt leading                            = 112.1pt
        → 6.6x margin, so LayoutError here is unreachable rather than unlikely.

    A **bold** entry becomes a SUB-HEADING (the mock-up's Features / Standard Accessories /
    Additional Inclusions). It is full width, carries no bullet glyph, and flushes any half-finished
    pair so a heading never sits beside a bullet. This overloads the `**bold**` syntax that
    _bullets() already parses — deliberately, to avoid inventing a second one — which means a rep
    bolding a single bullet for emphasis now creates a heading. The configurator copy says so."""
    rows = [b for b in (bullets or []) if str((b or {}).get("text") or "").strip()]
    if not rows:
        return []

    # Two columns at ~105pt is what the mock-up shows and what the median inclusion needs (1-2
    # lines). Once alternative offers widen the index column the text drops to ~176pt and each
    # column to ~83pt, where the same bullets need three lines and read as a mess — one column there.
    columns = 2 if width >= 200 else 1
    size = 9.5
    body_st = _ps("scpB", size, BODY2, leading_mult=1.25)
    head_st = _ps("scpH", 10, ACCENT_DARK, ARCH_B, leading_mult=1.3)
    sub_st = _ps("scpS", 10, HEADING, LATO_B, leading_mult=1.3)

    out = [[Paragraph(_esc(QUO_SCOPE_INTABLE_HEADING), head_st)]]
    gutter = 14 * PX
    col_w = (width - gutter) / 2.0 if columns == 2 else width

    def bullet(entry):
        return _bullet_para(_cap_name(str(entry.get("text") or ""), limit=320, token=24), body_st)

    def pair_row(left, right):
        """One row holding up to two bullets side by side, at the column width they were measured at."""
        cells = [bullet(left), bullet(right) if right else ""]
        t = Table([cells], colWidths=[col_w, col_w], hAlign="LEFT")
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LEFTPADDING", (0, 0), (0, 0), 0),
                               ("LEFTPADDING", (1, 0), (1, 0), gutter),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 1 * PX),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * PX)]))
        return [t]

    pending = None
    for b in rows:
        text = str(b.get("text") or "").strip()
        if b.get("bold"):
            if pending is not None:                 # never leave a heading beside a stray bullet
                out.append(pair_row(pending, None))
                pending = None
            out.append([Spacer(1, 3 * PX),
                        Paragraph(_esc(_cap_name(text, limit=320, token=24)), sub_st)])
            continue
        if columns == 1:
            out.append(pair_row(b, None))
        elif pending is None:
            pending = b
        else:
            out.append(pair_row(pending, b))
            pending = None
    if pending is not None:
        out.append(pair_row(pending, None))
    return out


def _bullet_block(heading, bullets, edge, width, columns=1, size=11.5, leading=1.7):
    """Uppercase heading + hairline rule, then a bordered card with a 3px left edge.

    `bullets` is a list of {"text", "bold"} (or plain strings). `columns=2` splits the
    list across two columns — ReportLab has no column-count, and a two-column table is
    the faithful equivalent that also keeps every bullet unsplit. Returns a
    KeepTogether so a block never straddles a page break."""
    rows = [b if isinstance(b, dict) else {"text": b} for b in (bullets or [])]
    rows = [r for r in rows if str(r.get("text") or "").strip()]
    if not rows:
        return None

    # A173 — CAP THE BLOCK, or a long list takes the whole render down with it.
    # _card is a one-row, one-cell Table and a ReportLab table row cannot split across pages, so once
    # the card is taller than the frame (~774pt) the build raises LayoutError and the route answers
    # 500. Measured: scope/options die at roughly 52 wrapped lines, the two-column exclusions at ~114.
    # Truncating visibly is strictly better than failing — the rep sees "+N more" in the live preview
    # and can shorten the text, where a 500 just leaves them with no document and no explanation.
    per_line = max(1.0, leading) * size * PX          # rendered height of one wrapped line
    usable = 700 * PX / max(per_line, 1.0)            # frame height less heading, padding and rule
    budget = int(usable * (2 if columns == 2 else 1))
    # a long bullet wraps, so charge it more than one line
    chars_per_line = 96 if columns == 2 else 58
    spent, kept = 0, []
    for r in rows:
        cost = max(1, -(-len(str(r.get("text") or "")) // chars_per_line))
        if spent + cost > budget:
            kept.append({"text": "… +%d more (shortened to fit the page)" % (len(rows) - len(kept)),
                         "bold": False})
            break
        spent += cost
        kept.append(r)
    rows = kept

    st = _ps("blBul", size, BODY2, leading_mult=leading)
    st_bold = _ps("blBulB", size, TEXT, LATO_B, leading_mult=leading)

    def para(r):
        return _bullet_para(r.get("text"), st_bold if r.get("bold") else st)

    if columns == 2 and len(rows) > 1:
        half = (len(rows) + 1) // 2
        left, right = rows[:half], rows[half:]
        gutter = 28 * PX
        col_w = (width - 2 * 18 * PX - gutter) / 2.0
        cells = [[para(r) for r in left], [para(r) for r in right]]
        body = Table([[cells[0], "", cells[1]]], colWidths=[col_w, gutter, col_w])
        body.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                  ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                  ("TOPPADDING", (0, 0), (-1, -1), 0),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        content = [body]
    else:
        content = [para(r) for r in rows]

    return KeepTogether([_SectionHead(heading, width), Spacer(1, 6 * PX),
                         _card(content, width, CARD_B, border=HAIR_EC,
                               left_accent=edge, pad=(18, 14))])


def _options_block(label, options, width):
    """Tinted card (no separate heading): uppercase label, then one row per option with
    the description left and the price right-aligned on the same line."""
    rows = [o for o in (options or []) if str((o or {}).get("text") or "").strip()]
    if not rows:
        return None

    # A173 — same one-row-card ceiling as _bullet_block: this card cannot split either, so a long
    # options list took the whole render down with a LayoutError. Cap it and say so on the page.
    _cap = int(700 * PX / max(11 * PX * 1.6, 1.0))
    if len(rows) > _cap:
        hidden = len(rows) - _cap + 1
        rows = rows[:_cap - 1] + [{"text": "… +%d more option(s) (shortened to fit the page)" % hidden,
                                   "price": ""}]

    desc_st = _ps("optD", 11, BODY2, leading_mult=1.6)
    price_st = _ps("optP", 11, HEADING, LATO_B, align=2, leading_mult=1.6)
    inner_w = width - 2 * 18 * PX
    price_w = 150 * PX

    # Paragraphs collapse whitespace runs, so the word gaps _sp() adds need to be
    # non-breaking here (canvas-drawn labels like _SectionHead keep the plain spaces).
    label_html = _esc(_sp(label)).replace("   ", "&nbsp;&nbsp;&nbsp;")
    content = [Paragraph(
        f"<font name='{LATO_B}' size={10 * PX:.1f} color='{_hx(ACCENT_DARK)}'>{label_html}</font>",
        _ps("optLb", 10, ACCENT_DARK, LATO_B, leading_mult=1.5))]
    content.append(Spacer(1, 5 * PX))
    for o in rows:
        row = Table([[_bullet_para(o.get("text"), desc_st),
                      Paragraph(_esc(str(o.get("price") or "")), price_st)]],
                    colWidths=[inner_w - price_w, price_w])
        row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                 ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                 ("TOPPADDING", (0, 0), (-1, -1), 1 * PX),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * PX)]))
        content.append(row)

    return KeepTogether([_card(content, width, NAVY_SOFT, border=HAIR_EC,
                               left_accent=ACCENT_G1, pad=(18, 11))])


def build_quotation_pdf_bytes(items, images, client_details, terms_and_conditions,
                              summary_table_data, desc_mode="short", note="",
                              scope=None, exclusions=None, options=None,
                              recommended_option=""):
    """Render the quotation PDF (v2 layout) and return its bytes.

    `scope` / `exclusions` are lists of {"text", "bold"}; `options` a list of
    {"text", "price"}. Each renders only when non-empty, so callers that omit them
    get byte-identical output to before.

    A205 — an item may carry `option_no`. Blank means an ordinary charged line. Lines sharing a
    non-blank value are MUTUALLY EXCLUSIVE alternatives: they print under an ALTERNATIVE OFFERS
    banner, each group with its own VAT subtotal, and the client picks one. `recommended_option`
    names the group the document total was built from. With no tagged items none of this engages and
    the output is byte-identical to before — which matters, because ~100 live quotations depend on
    that path being untouched."""
    cd = client_details or {}
    desc_mode = (desc_mode or "").strip().lower()          # "short" hides description sub-lines
    terms = terms_and_conditions or {}
    if isinstance(summary_table_data, dict):
        summary = summary_table_data
    else:
        total = sum(float(i.get("total_unit_price") or 0) for i in (items or []))
        summary = build_summary_table(total, "inclusive")

    sig_name = str(cd.get("signature_name") or "").strip()
    footer_bits = [str(cd.get("signature_mobile") or "").strip(),
                   str(cd.get("signature_email") or "").strip(), COMPANY_WEBSITE]
    footer_right = "  ·  ".join(x for x in footer_bits if x)

    buf = BytesIO()
    doc = _QuoTemplate(buf, COMPANY_NAME, footer_right, ref_no=cd.get("reference_no"))
    story = []

    # ── Row A: LOCKED header zone — logo + QUOTATION + chip are drawn by the page template at
    # fixed canvas coordinates (page 1); the story just reserves the space so nothing overlaps.
    story.append(Spacer(1, HEADER_LOCK_H + 2 * PX))

    # ── Row B: seller | meta card ──
    seller = Paragraph(
        f"<font name='{ARCH_B}' size={15 * PX:.1f} color='{_hx(HEADING)}'>{_esc(COMPANY_NAME)}</font><br/>"
        + "<br/>".join(_esc(l) for l in COMPANY_ADDRESS.split("\n"))
        + f"<br/><font name='{LATO_B}' color='{_hx(ACCENT_DARK)}'>{COMPANY_WEBSITE}</font>",
        _ps("seller", 13, BODY3, leading_mult=1.6))
    meta_rows = []
    _meta = [("Date", cd.get("quotation_date")),
             ("RFQ No.", cd.get("reference_rfq_no") or "—")]
    if str(cd.get("plant_site") or "").strip():   # A145: plant-site destination (only when provided)
        _meta.append(("Plant Site", cd.get("plant_site")))
    _meta.append(("Sales Person", sig_name))
    for label, value in _meta:
        meta_rows.append([Paragraph(_esc(label), _ps("mLb", 13, LABEL9)),
                          Paragraph(_esc(value), _ps("mVal", 13, TEXT, LATO_B, align=2))])
    meta_inner = Table(meta_rows, colWidths=[105 * PX, (300 - 32 - 105) * PX])
    meta_inner.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 1, HAIR_E),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * PX)]))
    meta_card = _card([meta_inner], 300 * PX, CARD_A)
    row_b = Table([[seller, "", meta_card]], colWidths=[CONTENT_W - 300 * PX - 28 * PX, 28 * PX, 300 * PX])
    row_b.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(row_b)
    story.append(Spacer(1, 8 * PX))

    # ── Row C: PREPARED FOR card | SUBJECT card ──
    cust_bits = [f"<font name='{LATO_B}' size={10.5 * PX:.1f} color='{_hx(ACCENT_DARK)}'>{_sp('PREPARED FOR')}</font><br/>",
                 f"<font name='{ARCH_B}' size={16 * PX:.1f} color='{_hx(HEADING)}'>{_esc(cd.get('client_name'))}</font>"]
    if cd.get("client_address"):
        cust_bits.append("<br/>" + "<br/>".join(_esc(l) for l in str(cd["client_address"]).splitlines() if l.strip()))
    att = " · ".join(x for x in [str(cd.get("attention") or "").strip(),
                                 str(cd.get("designation") or "").strip()] if x)
    if att:
        cust_bits.append(f"<br/><font color='{_hx(TEXT)}'><b>Attention:</b> {_esc(att)}</font>")
    if cd.get("email"):
        cust_bits.append(f"<br/><font color='{_hx(LINK)}'>{_esc(cd['email'])}</font>")
    cust_para = Paragraph("".join(cust_bits), _ps("cust", 13, BODY3, leading_mult=1.5))
    subj_para = Paragraph(
        f"<font name='{LATO_B}' size={10.5 * PX:.1f} color='{_hx(LABEL9)}'>{_sp('SUBJECT')}</font><br/>"
        f"<font name='{LATO_B}'>{_esc(cd.get('subject') or '')}</font>",
        _ps("subj", 13, TEXT, leading_mult=1.5))
    cust_w = CONTENT_W - 250 * PX - 24 * PX
    row_c = Table([[_card([cust_para], cust_w, CARD_B, left_accent=True), "",
                    _card([subj_para], 250 * PX, CARD_B)]],
                  colWidths=[cust_w, 24 * PX, 250 * PX])
    row_c.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(row_c)
    story.append(Spacer(1, 8 * PX))

    # (Brand strip moved to the BOTTOM of the document — see the tail block.)

    # ── Items table ──
    col_w = [36 * PX, 0, 70 * PX, 110 * PX, 120 * PX]
    col_w[1] = CONTENT_W - col_w[0] - col_w[2] - col_w[3] - col_w[4]
    head_l = _ps("thL", 11, colors.white, ARCH_B)
    head_r = _ps("thR", 11, colors.white, ARCH_B, align=2)
    rows = [[Paragraph("#", head_l), Paragraph("ITEM &amp; DESCRIPTION", head_l),
             Paragraph("QTY", head_r), Paragraph("UNIT PRICE", head_r), Paragraph("AMOUNT", head_r)]]

    title_st = _ps("itTitle", 13, HEADING, ARCH_SB, leading_mult=1.3)
    sub_st = _ps("itSub", 12.5, MUTED8, leading_mult=1.28)
    idx_st = _ps("itIdx", 12.5, LABELB, LATO_B)
    qty_st = _ps("itQty", 12.5, TEXT, LATO_B, align=2)
    uom_st = _ps("itUom", 10.5, LABELB, align=2)
    price_st = _ps("itPrice", 12.5, BODY2, align=2)
    amt_st = _ps("itAmt", 12.5, HEADING, LATO_B, align=2)
    offer_label_st = _ps("offerLb", 9.5, ACCENT_DARK, LATO_B, leading_mult=1.25)
    # A205 — alternative-offer chrome
    alt_banner_st = _ps("altBan", 11, ACCENT_DARK, ARCH_B, leading_mult=1.3)
    alt_badge_st = _ps("altBadge", 9.5, ACCENT_DARK, LATO_B, align=1, leading_mult=1.2)
    alt_sub_st = _ps("altSub", 11, HEADING, LATO_B, align=2, leading_mult=1.3)

    # A205 — split base lines from the mutually exclusive alternatives, then lay the table out as
    # base rows → banner → each option's rows → that option's own VAT subtotal. Markers are injected
    # into the SAME row list so the existing column widths, header gradient and page-splitting all
    # apply unchanged; a second table would have had to reproduce every one of them.
    _opt_key = lambda x: str((x or {}).get("option_no") or "").strip()
    base_items = [i for i in items if not _opt_key(i)]
    opt_order, opt_map = [], {}
    for i in items:
        k = _opt_key(i)
        if not k:
            continue
        if k not in opt_map:
            opt_map[k] = []
            opt_order.append(k)
        opt_map[k].append(i)
    opt_order.sort(key=lambda k: (_num_key(k), k))
    rec_key = str(recommended_option or "").strip()
    if opt_order and rec_key not in opt_map:
        rec_key = min(opt_order, key=lambda k: sum(float(x.get("total_unit_price") or 0) for x in opt_map[k]))

    ordered = list(base_items)
    if opt_order:
        ordered.append({"_marker": "banner"})
        for k in opt_order:
            ordered.extend(opt_map[k])
            ordered.append({"_marker": "subtotal", "_key": k})
    span_rows = []          # (row_index, kind) filled as the rows are appended
    item_rows = []          # A213 — indices of REAL item rows, for the zebra band counter
    scope_row_idx = []      # A213 — indices of the scope rows, so they share item 01's band
    # A213 — scope prints inside the table, under the first BASE item. With no base item there is
    # nothing to hang it on: if every line carries an option_no, ordered[0] is the ALTERNATIVE OFFERS
    # banner, and scope placed there reads as belonging to option 1 — which it does not. Same when
    # items is empty. Both cases fall back to the pre-A213 full-width card after the totals, which is
    # why _bullet_block and the post-totals path are kept rather than deleted.
    scope_in_table = bool(scope) and bool(base_items)
    scope_rows_pending = _scope_rows(scope, _desc_text_width(col_w[1])) if scope_in_table else None
    if not scope_rows_pending:
        scope_in_table = False
    # The index column is sized for "01". An OPTION badge does not fit and silently CLIPS to "OPT",
    # taking the ★ with it — so widen it, but only when options exist, so a quotation without them
    # keeps the exact column geometry (and therefore the identical output) it has today.
    if opt_order:
        col_w[0] = 96 * PX
        col_w[1] = CONTENT_W - col_w[0] - col_w[2] - col_w[3] - col_w[4]

    def model_line(code):
        return (f"<font color='{_hx(LABELB)}'>Model No.</font> "
                f"<font color='{_hx(MUTED8)}'>{_esc(code)}</font>")

    for it in ordered:
        mk = it.get("_marker")
        if mk == "banner":
            span_rows.append((len(rows), "banner"))
            rows.append([Paragraph(
                "<b>ALTERNATIVE OFFERS</b> &nbsp;— the options below are alternatives; "
                "please select one. Prices are not cumulative.", alt_banner_st), "", "", "", ""])
            continue
        if mk == "subtotal":
            k = it.get("_key")
            g_ex = sum(float(x.get("total_unit_price") or 0) for x in opt_map[k])
            g_vat = g_ex * 0.12
            span_rows.append((len(rows), "subtotal"))
            rows.append([Paragraph(
                f"Total (VAT Excl.) PHP {_fmt(g_ex)} &nbsp;·&nbsp; VAT (12%) PHP {_fmt(g_vat)}"
                f" &nbsp;·&nbsp; <font color='{_hx(ACCENT_DARK)}'>Total (VAT Inc.) "
                f"PHP {_fmt(g_ex + g_vat)}</font>", alt_sub_st), "", "", "", ""])
            continue
        no = it.get("item_no")
        name = str(it.get("product_name") or "").strip()
        code = str(it.get("product_code") or "").strip()
        desc = str(it.get("description") or "").strip()
        orig_code = str(it.get("orig_code") or "").strip()
        orig_name = str(it.get("orig_name") or "").strip()
        # A173 — "N/A" is not something a customer asked for; it is a line that simply had no part
        # number. Treating it as a difference paired the line against the supplier's real code and,
        # with no original description to show, printed the SAME description twice — once as the
        # request and again under OUR OFFER. The model-line writer below already skips an N/A code;
        # this makes the pairing test agree with it instead of contradicting it.
        _orig_code_real = orig_code and orig_code.lower() not in ("n/a", "na", "-")
        paired = (_orig_code_real and orig_code != code) or (orig_name and orig_name != name)

        sub_lines = []
        if desc and desc != name and desc_mode != "short":
            # Cap by estimated RENDERED height, not raw characters: the description column is
            # ~219pt wide (~55 chars per visual line), and a single table row taller than the
            # frame cannot split → LayoutError. Budget ≈ 24 visual lines per item, 160 chars/line.
            visual_budget = 24
            for ln in desc.splitlines():
                ln = ln.strip()
                if not ln or ln == name:
                    continue
                if len(ln) > 160:
                    ln = ln[:157].rstrip() + "…"
                cost = max(1, -(-len(ln) // 55))            # ceil(len/55) wrapped-line estimate
                if cost > visual_budget:
                    sub_lines.append("…")
                    break
                visual_budget -= cost
                sub_lines.append(("• " + _esc(ln.lstrip("-*• ").strip()))
                                 if ln[:1] in "-*•" else _esc(ln))
        has_code = code and code.lower() != "n/a" and code != name

        if paired:
            req_name = orig_name or name
            text_col = [Paragraph(_esc(req_name), title_st)]
            if orig_code and orig_code.lower() != "n/a" and orig_code != req_name:
                text_col.append(Paragraph(model_line(orig_code), sub_st))
            text_col.append(Spacer(1, 4 * PX))
            text_col.append(Paragraph(_sp("OUR OFFER"), offer_label_st))
            text_col.append(Paragraph(
                f"<font name='{ARCH_SB}' color='{_hx(HEADING)}'>{_esc(_cap_name(name))}</font>", sub_st))
            if sub_lines:
                text_col.append(Paragraph("<br/>".join(sub_lines), sub_st))
            if has_code:
                text_col.append(Paragraph(model_line(code), sub_st))
        else:
            text_col = [Paragraph(_esc(_cap_name(name)), title_st)]
            if sub_lines:
                text_col.append(Spacer(1, 2 * PX))
                text_col.append(Paragraph("<br/>".join(sub_lines), sub_st))
            if has_code:
                text_col.append(Paragraph(model_line(code), sub_st))

        img_bytes = (images or {}).get(no)
        desc_cell = Table([[_Thumb(img_bytes), text_col]],
                          colWidths=[_desc_indent(), _desc_text_width(col_w[1])])
        desc_cell.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                       ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                       ("TOPPADDING", (0, 0), (-1, -1), 0),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        try:
            idx_txt = f"{int(no):02d}"
        except Exception:
            idx_txt = str(no)
        qty_cell = [Paragraph(f"{float(it.get('quantity') or 0):.1f}", qty_st),
                    Paragraph(str(it.get("uom") or "pc(s)"), uom_st)]
        _k = _opt_key(it)
        if _k:
            idx_cell = Paragraph(
                # No ★ here: the glyph is absent from the Helvetica fallback used when Lato/Archivo
                # are unavailable, and a missing glyph takes the whole <font> run with it — the label
                # vanished entirely. Plain words render in every font this document can fall back to.
                f"OPTION {_esc(_k)}" + ("<br/><font size='6.5'>RECOMMENDED</font>" if _k == rec_key else ""),
                alt_badge_st)
        else:
            idx_cell = Paragraph(idx_txt, idx_st)
        item_rows.append(len(rows))
        rows.append([idx_cell, desc_cell, qty_cell,
                     Paragraph(_fmt(it.get("total_amount")), price_st),
                     Paragraph(_fmt(it.get("total_unit_price")), amt_st)])

        # A213 — the scope of supply hangs off the FIRST base item, right under its description.
        # Appended INSIDE this loop on purpose: span_rows records `len(rows)` as it goes, so rows
        # added here shift every later index correctly. Building them in a second pass and
        # inserting would silently break every A205 span index.
        if scope_rows_pending and not _k:
            for cell in scope_rows_pending:
                scope_row_idx.append(len(rows))
                rows.append(["", cell, "", "", ""])
            scope_rows_pending = None

    items_tbl = Table(rows, colWidths=col_w, repeatRows=1)
    # Header: ONE continuous blue→red fade across all columns — each cell gets a horizontal
    # gradient whose start/end colors are sampled at its column boundaries, so the five cells
    # stitch into a single fade (and it repeats correctly on later pages via repeatRows).
    total_w = sum(col_w)
    header_grads, xpos = [], 0.0
    for ci, cw in enumerate(col_w):
        c_start = _mix(ACCENT_G1, ACCENT_G2, xpos / total_w)
        c_end = _mix(ACCENT_G1, ACCENT_G2, (xpos + cw) / total_w)
        header_grads.append(("BACKGROUND", (ci, 0), (ci, 0), ["HORIZONTAL", c_start, c_end]))
        xpos += cw
    # A213 — the zebra and the rules are now PER ROW, not blanket commands.
    #
    # ROWBACKGROUNDS cycles on row index from where it starts, so inserting scope rows after item 01
    # flips the stripe for every later item. It cannot be patched over either: backgrounds are drawn
    # before lines and before content, and _alt_row_styles already needs a per-row BACKGROUND to
    # defeat the same cycle — a third layer on top of two is how this file becomes unreadable.
    # So the phase is driven by a LOGICAL band counter over real item rows, and item 01's scope rows
    # take its colour, which is what makes them read as the single continuous band the client's
    # mock-up shows.
    #
    # LINEBELOW is the same story with one extra twist: a line command cannot be cancelled. The old
    # blanket ("LINEBELOW", (0,1), (-1,-1), …) would draw a rule under every scope row, chopping the
    # block into stripes. Per-row commands instead: under every ordinary item row, and under the LAST
    # scope row (that rule is what separates item 01's band from item 02), never in between.
    scope_set = set(scope_row_idx)
    if not scope_set:
        # No scope rows — keep the original blanket commands EXACTLY. The per-row rewrite below is
        # only needed to stop inserted rows shifting the stripe, so a quotation without scope must
        # not pay for it: ~100 live quotations render through here and their output stays byte for
        # byte what it was, which tests/flow/quotation-baseline.py asserts.
        zebra = [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARD_B])]
        rules = [("LINEBELOW", (0, 1), (-1, -1), 1, HAIR_F0)]
    else:
        # The cycle must advance exactly as ROWBACKGROUNDS would — once per body row — EXCEPT on a
        # scope row, which takes the colour of the item it belongs to and does not advance. That is
        # what makes an item and its inclusions read as one continuous band rather than a stripe
        # every third line, and it keeps every later item on the stripe it would have had.
        zebra, rules, phase = [], [], 0
        last_scope = scope_row_idx[-1]
        for ri in range(1, len(rows)):
            if ri in scope_set:
                fill = [colors.white, CARD_B][(phase - 1) % 2]
            else:
                fill = [colors.white, CARD_B][phase % 2]
                phase += 1
            zebra.append(("BACKGROUND", (0, ri), (-1, ri), fill))
            # A rule under every row EXCEPT inside the scope block. The one under item 01 moves to
            # the foot of its inclusions, which is what separates item 01's band from item 02's.
            if ri not in scope_set or ri == last_scope:
                if not (ri + 1 in scope_set):
                    rules.append(("LINEBELOW", (0, ri), (-1, ri), 1, HAIR_F0))

    # Command ORDER is preserved exactly — zebra where ROWBACKGROUNDS sat, rules where LINEBELOW sat.
    # ReportLab emits its content stream in command order, so merely hoisting the rules above BOX
    # changes the bytes of every quotation ever rendered. The baseline caught precisely that.
    items_tbl.setStyle(TableStyle(header_grads + zebra + [
        ("BOX", (0, 0), (-1, -1), 1, HAIR_EC),
        ("VALIGN", (0, 0), (-1, -1), "TOP")] + rules + [
        ("LEFTPADDING", (0, 0), (-1, -1), 8 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 8 * PX),
        ("TOPPADDING", (0, 0), (-1, 0), 10 * PX), ("BOTTOMPADDING", (0, 0), (-1, 0), 10 * PX),
        ("TOPPADDING", (0, 1), (-1, -1), 8 * PX), ("BOTTOMPADDING", (0, 1), (-1, -1), 8 * PX)]
        # A213 — a scope row's own padding lives inside its nested table, so the outer 8px top and
        # bottom on every row would treble the gaps between bullet pairs. Tighten them here only.
        + [("TOPPADDING", (0, ri), (-1, ri), 0) for ri in scope_row_idx]
        + [("BOTTOMPADDING", (0, ri), (-1, ri), 0) for ri in scope_row_idx]
        + _alt_row_styles(span_rows)))
    story.append(items_tbl)
    story.append(Spacer(1, 10 * PX))

    # ── Totals (right-aligned, 340px) ──
    opt = summary.get("vat_option", "inclusive")
    dp = summary.get("discount_pct", 0) or 0
    tot_rows = []
    # A quotation-level discount inserts a Subtotal + "Less: Discount (X%)" pair before the VAT rows.
    if dp > 0:
        pct_txt = ("%g" % dp)
        tot_rows.append([Paragraph("Subtotal (VAT Exclusive)", _ps("td0", 13, MUTED7)),
                         Paragraph("PHP " + _fmt(summary["gross_ex_vat"]), _ps("td0v", 13, TEXT, LATO_B, align=2))])
        tot_rows.append([Paragraph("Less: Discount (" + pct_txt + "%)", _ps("td1", 13, ACCENT_DARK)),
                         Paragraph("− PHP " + _fmt(summary["discount_amt"]), _ps("td1v", 13, ACCENT_DARK, LATO_B, align=2))])
    if opt == "inclusive":
        net_label = "Net (VAT Exclusive)" if dp > 0 else "Total Amount (VAT Exclusive)"
        tot_rows += [[Paragraph(net_label, _ps("tl1", 13, MUTED7)),
                      Paragraph("PHP " + _fmt(summary["total_ex_vat"]), _ps("tv1", 13, TEXT, LATO_B, align=2))],
                     [Paragraph("VAT (12%)", _ps("tl2", 13, MUTED7)),
                      Paragraph("PHP " + _fmt(summary["vat"]), _ps("tv2", 13, TEXT, LATO_B, align=2))]]
        grand_text = "Total (VAT Inclusive)"
    elif opt == "zero":
        grand_text = "Total (Zero-Rated)"
    else:
        grand_text = "Total (VAT Exclusive)"

    tot_w = 340 * PX
    blocks = []
    if tot_rows:
        t = Table(tot_rows, colWidths=[tot_w - 130 * PX, 130 * PX])
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, HAIR_E),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 4 * PX),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * PX)]))
        blocks.append(t)
        blocks.append(Spacer(1, 8 * PX))
    blocks.append(_GradientBar(tot_w, grand_text, "PHP " + _fmt(summary["total"])))
    totals_wrap = Table([[blocks]], colWidths=[CONTENT_W])
    totals_wrap.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), CONTENT_W - tot_w),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                     ("TOPPADDING", (0, 0), (-1, -1), 0),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(totals_wrap))
    story.append(Spacer(1, 8 * PX))

    # ── Scope of Supply / Exclusions / Options (each omitted when empty) ──
    # A213 — scope normally prints INSIDE the items table now, under the first item's description,
    # so it is dropped from here. The card survives as the fallback for a quotation with no base
    # item to hang it on (see scope_in_table). Exclusions and options do NOT move: they are about
    # the whole quotation, not about one line, and under an item they would read wrongly.
    for blk in (None if scope_in_table else
                _bullet_block("SCOPE OF SUPPLY — INCLUDED", scope, ACCENT_G1, CONTENT_W),
                _bullet_block("EXCLUSIONS — UNLESS OTHERWISE STATED IN WRITING", exclusions,
                              ACCENT, CONTENT_W, columns=2, size=11, leading=1.6),
                _options_block("AVAILABLE AS OPTIONS — PRICED SEPARATELY UPON REQUEST",
                               options, CONTENT_W)):
        if blk is not None:
            story.append(blk)
            story.append(Spacer(1, 8 * PX))

    # ── Terms strip ──
    term_cells = []
    for label, key in [("VALIDITY", "validity"), ("DELIVERY", "delivery"),
                       ("PAYMENT", "payment"), ("WARRANTY", "warranty")]:
        # cap: an extreme term would make this single unsplittable row taller than a page
        term_txt = str(terms.get(key) or "—")
        if len(term_txt) > 280:
            term_txt = term_txt[:277].rstrip() + "…"
        term_cells.append([Paragraph(_sp(label), _ps("teLb", 9.5, ACCENT_DARK, LATO_B)),
                           Spacer(1, 3 * PX),
                           Paragraph(_esc(term_txt), _ps("teVal", 13, TEXT, leading_mult=1.35))])
    terms_tbl = Table([term_cells], colWidths=[CONTENT_W / 4.0] * 4)
    terms_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, HAIR_EC),
        ("ROUNDEDCORNERS", [8 * PX] * 4),
        ("INNERGRID", (0, 0), (-1, -1), 1, HAIR_EC),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 15 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 15 * PX),
        ("TOPPADDING", (0, 0), (-1, -1), 9 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 9 * PX)]))
    story.append(KeepTogether(terms_tbl))
    story.append(Spacer(1, 7 * PX))

    # ── Bank details | signature ──
    kv = _ps("kv", 12, BODY2, leading_mult=1.35)
    bank_body = "<br/>".join(
        f"<font color='{_hx(TEXT)}'>{_esc(k)}:</font>  {_esc(v)}" for k, v in BANK_LINES)
    bank_w = CONTENT_W - 250 * PX - 40 * PX
    bank_col = [_SectionHead("BANK DETAILS", bank_w), Spacer(1, 6 * PX), Paragraph(bank_body, kv)]

    sig_space = Table([[""]], colWidths=[250 * PX], rowHeights=[20 * PX])
    sig_space.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.5, HexColor("#dddddd")),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    sig_col = [_SectionHead("SINCERELY YOURS", 250 * PX), Spacer(1, 4 * PX), sig_space, Spacer(1, 5 * PX),
               Paragraph(f"<font name='{ARCH_B}' size={14 * PX:.1f} color='{_hx(HEADING)}'>{_esc(sig_name)}</font>",
                         _ps("sigNm", 14, HEADING, leading_mult=1.3))]
    if cd.get("signature_designation"):
        sig_col.append(Paragraph(_esc(str(cd["signature_designation"])[:200]), _ps("sigTi", 12, MUTED8)))
    extra = []
    if cd.get("signature_viber"):
        extra.append(f"<font color='{_hx(LABELA)}'>Viber:</font> {_esc(cd['signature_viber'])}")
    if cd.get("signature_mobile"):
        extra.append(f"<font color='{_hx(LABELA)}'>Mobile:</font> {_esc(cd['signature_mobile'])}")
    if cd.get("signature_email"):
        extra.append(f"<font color='{_hx(LINK)}'>{_esc(cd['signature_email'])}</font>")
    if extra:
        sig_col += [Spacer(1, 4 * PX), Paragraph("<br/>".join(extra), kv)]

    bank_sig = Table([[bank_col, "", sig_col]], colWidths=[bank_w, 40 * PX, 250 * PX])
    bank_sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                  ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    # Bank/signature + note + disclaimer travel as ONE block — the disclaimer can never be
    # orphaned onto a page by itself (the group is ~110pt, far below a full page, so it always fits).
    tail = [bank_sig, Spacer(1, 5 * PX)]
    note = (note or "").strip()
    if note:
        tail.append(Paragraph(f"<b>Note:</b> {_esc(note)}", _ps("note", 11.5, BODY2)))
        tail.append(Spacer(1, 5 * PX))
    tail.append(Paragraph(DISCLAIMER, _ps("disc", 10.5, LABELA, leading_mult=1.55)))
    # Brand strip sits at the very bottom, just below the disclaimer (moved from the header).
    strip_para = Paragraph(
        f"<font name='{LATO_B}' size={11 * PX:.1f} color='{_hx(ACCENT_DARK)}'>{_esc(BRANDS)}</font>",
        _ps("brands", 11, ACCENT_DARK, align=1, leading_mult=1.4))
    tail.append(Spacer(1, 8 * PX))
    tail.append(_card([strip_para], CONTENT_W, ACCENT_SOFT, border=ACCENT_BORDER, pad=(16, 10)))
    story.append(KeepTogether(tail))

    doc.build(story, canvasmaker=_NumberedCanvas)
    return buf.getvalue()
