"""Travel allowance pack — three pages plus a receipt annex (A214).

Renders the document a sales rep files to have their ₱2,000 travel float replenished:

  1. Replenishment Report of Travel Allowance — the cover: total spent, the float, what remains
  2. Travel Itinerary                        — leg by leg, with departure/arrival/transport/amount
  3. Certification of Expenses Not Requiring Receipts — the fares that issue none: tricycles, jeepneys
  + annex                                    — the receipt photos, captioned with the leg they belong to

Design source: TravelAllow.pdf. That file is US Letter and every document this company produces is
A4 — 17pt wider and 50pt shorter — so its proportions were re-derived here in PX rather than its
coordinates transcribed. Its text is outlined (chars = 0), so the only way to compare output against
it is visually; there is nothing to extract.

PAGES 2 AND 3 ARE NEVER SUMMED. Page 2 totals the TRANSPORT legs, page 3 totals the legs with NO
RECEIPT, and most fares are both — a tricycle is a trip and issues nothing. The claim is page 1's
TOTAL AMOUNT SPENT, which is the sum of every item once. The source workbook's own sample is ₱35 +
₱70: each of the three pages reads ₱105 and the claim is ₱105, not ₱210. See _travDerive in
apps-script/FlowAPI.gs, which computes the same three projections server-side.

PAGE 3'S SIGNATURE BLOCKS ARE DELIBERATELY SWAPPED relative to the design. TravelAllow.pdf prints
CERTIFIED CORRECT above the DIRECTOR's name and leaves APPROVED BY blank, which would have the
director certifying the correctness of an expense he did not incur — and contradicts pages 1 and 2,
where the rep certifies and the director approves. Read as a slip in the template and corrected here.
Do not "fix" it back by comparing against the source file.

Layout is composed against a MEASURED budget, never flowed and hoped. A fixed rowHeight does not clip
in ReportLab — it bottom-aligns the overlong cell and draws the rest off the top of the sheet, with no
exception and nothing in the logs (measured: 441 of 503 words 691pt above the paper, while the row
below printed normally). So a long leg description would silently vanish while still claiming money.
Every ruled row is pre-measured and hard-truncated by _clip_text.
"""

import logging
import re
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)
from PIL import Image as PILImage, ImageOps

# The visual vocabulary is IMPORTED, never copied: same page geometry, same fonts, same escaping, so
# the travel pack reads as a sibling of the quotation. flow_quotation_pdf.py is not edited at all,
# which is what keeps ~100 live quotations at zero risk from this file.
from pdf_generators.flow_quotation_pdf import (
    PX, PAGE_W, PAGE_H, MARGIN, CONTENT_W,
    LATO, LATO_B, LATO_BLK, ARCH_SB, ARCH_B, ARCH_XB, _FACE,
    HEADING, TEXT, BODY2, BODY3, MUTED7, MUTED8, LABEL9, LABELA, LABELB,
    HAIR_E, HAIR_F0, HAIR_EC,
    COMPANY_NAME, COMPANY_ADDRESS,
    _esc, _fmt, _sp, _ps, _hx, _LOGO_PATH,
)
from pdf_generators.utils import ph_date_slash

logger = logging.getLogger(__name__)

# ── Palette ───────────────────────────────────────────────────────────────────
# The design's accent is ORANGE, not the quotation's red. Deliberately a local token: importing
# ACCENT would repaint the travel pack in quotation colours the day someone re-themes quotations.
TA_ORANGE = HexColor("#E8791E")
TA_HEAVY = HexColor("#1e293b")          # the dark rule above REMAINING / TOTAL
TA_RULE = HexColor("#e2e8f0")           # the hairlines between ruled rows

# ── The peso sign ─────────────────────────────────────────────────────────────
# It exists in Archivo and NOT in Lato. Measured by rendering and reading back:
#     Lato        '\x002,000.00'   → .notdef box
#     Archivo     '₱2,000.00'      → correct
#     Helvetica   'n2,000.00'      → prints the letter n
# That last one is why this matters: the font loader falls back to Helvetica without raising when
# static/fonts is missing, so a fonts-less deploy would print "n2,000.00" on a document someone signs.
# Every amount goes through PESO, and every amount is set in an Archivo face.
PESO = "₱" if _FACE.get("Archivo-Bold") == "Archivo-Bold" else "PHP "


def money(n):
    """'₱2,000.00' — always paired with an Archivo style by the caller."""
    return "%s%s" % (PESO, _fmt(n))


def money_inline(n):
    """An amount for use INSIDE a Lato paragraph.

    The peso glyph does not exist in Lato and renders as .notdef, so the amount carries its own font
    tag rather than inheriting the paragraph's. Without this the symbol silently disappears from the
    particulars sentence while printing correctly two lines below it, which reads as a typo in the
    document rather than as the font bug it is."""
    return "<font name='%s'>%s</font>" % (ARCH_B, money(n))


def _spw(text):
    """Letter-spaced label with a WIDE word gap, using NON-BREAKING spaces.

    _sp separates words with three ordinary spaces — and a ReportLab Paragraph COLLAPSES runs of
    whitespace, so all three become one, which is the same width as the single space between letters.
    'TOTAL AMOUNT SPENT' therefore prints as TOTALAMOUNTSPENT. The quotation gets away with it because
    its labels are two short words; these are not. &nbsp; is not collapsed."""
    gap = "&nbsp;" * 4
    return gap.join(_sp(w) for w in str(text).split(" ") if w)


# ── Pure helpers — no rendering, unit-testable on their own ───────────────────
def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if f != f or f in (float("inf"), float("-inf")):     # NaN / ±inf reach here from a JSON payload
        return 0.0
    return f


def _normalise(record):
    """Payload → the model the three pages read, with every field coerced and ordered.

    SORTED BY (date, seq), not by seq alone. FlowAPI's _travItems sorts by Seq only, so a rep who
    enters Tuesday's ride before Monday's would otherwise print 07/28, then 07/27, then a blank date
    row belonging to a different day than the date printed above it — a false statement on a document
    that gets signed. Blank dates sort last, together, so '' never collides with a real day."""
    rec = dict(record or {})
    raw = rec.get("items") or []
    items = []
    for idx, it in enumerate(raw, start=1):
        if not isinstance(it, dict):
            logger.warning("travel_allowance_pdf: skipping non-dict item at position %s", idx)
            continue
        d = str(it.get("date") or "").strip()
        items.append({
            "seq": int(_num(it.get("seq")) or idx),
            "date": d,
            "kind": str(it.get("kind") or "Transport").strip() or "Transport",
            "description": str(it.get("description") or "").strip(),
            "departureTime": str(it.get("departureTime") or "").strip(),
            "arrivalTime": str(it.get("arrivalTime") or "").strip(),
            "means": str(it.get("means") or "").strip(),
            "amount": _num(it.get("amount")),
            "hasReceipt": bool(it.get("hasReceipt")),
            "receiptDocId": str(it.get("receiptDocId") or "").strip(),
        })
    items.sort(key=lambda x: (x["date"] == "", x["date"], x["seq"]))

    total = sum(i["amount"] for i in items)
    transport = sum(i["amount"] for i in items if i["kind"] == "Transport")
    no_receipt = sum(i["amount"] for i in items if not i["hasReceipt"])
    float_amt = _num(rec.get("floatAmount"))

    return {
        "travNo": str(rec.get("travNo") or "").strip(),
        "date": str(rec.get("date") or "").strip(),
        "weekStart": str(rec.get("weekStart") or "").strip(),
        "weekEnd": str(rec.get("weekEnd") or "").strip(),
        "user": str(rec.get("user") or "").strip(),
        "position": str(rec.get("position") or "").strip(),
        "durationLabel": str(rec.get("durationLabel") or "").strip(),
        "purpose": str(rec.get("purpose") or "").strip(),
        "status": str(rec.get("status") or "").strip(),
        "acctApprovedBy": str(rec.get("acctApprovedBy") or "").strip(),
        "dirApprovedBy": str(rec.get("dirApprovedBy") or "").strip(),
        "overspendReason": str(rec.get("overspendReason") or "").strip(),
        "items": items,
        "floatAmount": float_amt,
        "totalSpent": round(total, 2),
        "transportTotal": round(transport, 2),
        "noReceiptTotal": round(no_receipt, 2),
        # Derived here and nowhere else. An overspend is reported as remaining ZERO plus the amount
        # the employee advanced — never as a negative remaining, which would misstate what they hold.
        "remaining": round(max(0.0, float_amt - total), 2),
        "advanced": round(max(0.0, total - float_amt), 2),
    }


def _day_first_rows(rows):
    """[bool] — True where a row is the first of its day WITHIN THIS LIST.

    Called PER CHUNK, never once over the whole claim. The design prints the date only on the first
    row of each day; applied across a page break that would leave the first row of page 4 with no
    date at all. Chunk-local means every physical page opens with a date by construction, with no
    special case for the continuation."""
    out, seen = [], None
    for r in rows:
        d = r.get("date") or ""
        out.append(d != seen)
        seen = d
    return out


def _clip_text(text, style, width, max_lines=2):
    """Hard-truncate to `max_lines` at `width`, measuring with the real font.

    ReportLab does NOT clip an overlong cell in a fixed-height row — it draws it off the page. So the
    truncation has to happen before the text ever reaches a table. Binary search on the cut point,
    because a linear walk over a 4,000-character description is thousands of wrap() calls."""
    s = str(text or "").strip()
    if not s:
        return ""
    if len(Paragraph(_esc(s), style).breakLines(width).lines) <= max_lines:
        return s
    lo, hi = 0, len(s)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        cand = s[:mid].rstrip() + "…"
        if len(Paragraph(_esc(cand), style).breakLines(width).lines) <= max_lines:
            lo = mid
        else:
            hi = mid - 1
    return (s[:lo].rstrip() + "…") if lo else "…"


def _fit_rows(n_real, row_h, budget, max_blank):
    """How many BLANK ruled rows to pad with — as many as fit, never a fixed count.

    The design shows ~7 / ~8 / ~12 blank rows, but those are what US Letter's budget happens to
    produce; on A4 the number differs and that is correct. This repo has had the fixed-count bug
    before — flow_pr_pdf.py's own comment records that blindly padding to ten rows overflowed the
    frame whenever descriptions were tall and pushed the signature block onto an extra page.

    max_blank stops a two-row page-3 printing twenty-six rules and looking like a spreadsheet."""
    if row_h <= 0:
        return 0
    used = n_real * row_h
    room = int(max(0.0, (budget - used)) // row_h)
    return max(0, min(int(max_blank), room))


def _page1_lines(rec):
    """The label/value pairs under page 1's table, in print order.

    ONE source for every figure on the cover. The sentence in the particulars, the AMOUNT cell beside
    it and TOTAL AMOUNT SPENT are three printings of the same number — reading them from one place is
    what stops them disagreeing."""
    lines = [("TOTAL AMOUNT SPENT", rec["totalSpent"], False),
             ("INITIAL AMOUNT OF THE TRAVEL ALLOWANCE", rec["floatAmount"], False)]
    if rec["advanced"] > 0:
        # The design has no line for this, because its sample never overspends. Without it REMAINING
        # would have to go negative, which is a lie about what the rep is holding: the excess is their
        # own money sitting in the float, and it is being repaid.
        lines.append(("EMPLOYEE ADVANCED (REIMBURSED ABOVE)", rec["advanced"], False))
    lines.append(("REMAINING AMOUNT OF THE TRAVEL ALLOWANCE", rec["remaining"], True))
    return lines


def _particulars_sentence(rec):
    """The one line the cover's Particulars column carries, with the real period and total."""
    a = ph_date_slash(rec["weekStart"], default=rec["weekStart"] or "00/00/0000")   # noqa: E501
    b = ph_date_slash(rec["weekEnd"], default=rec["weekEnd"] or "00/00/0000")
    return ("To: Replenishment of travel allowance period/day %s to %s as per supporting papers "
            "hereto attached in the total amount of %s" % (a, b, money_inline(rec["totalSpent"])))


def _duration_text(rec):
    """Never an empty value slot — a blank underline on a printed form reads as a rendering fault."""
    if rec["durationLabel"]:
        return rec["durationLabel"]
    a, b = rec["weekStart"], rec["weekEnd"]
    if a and b:
        return "%s – %s" % (ph_date_slash(a, a), ph_date_slash(b, b))
    return "—"


def _receipt_caption(rec, item):
    """What prints under an annex photo, so a loose printed page still identifies itself."""
    bits = [rec["travNo"] or "DRAFT", "Leg %d" % item["seq"]]
    if item["date"]:
        bits.append(ph_date_slash(item["date"], item["date"]))
    who = ", ".join(x for x in (item["means"], item["description"]) if x)
    if who:
        bits.append(who)
    bits.append(money(item["amount"]))
    return "  ·  ".join(bits)


def _signers(rec):
    """Whose names print in the certification blocks.

    On an APPROVED record these come from the record itself. Baking the template's names in would let
    a signed document credit a certifier who never saw it — the one failure here with real
    consequences. The constants are the draft/preview fallback only.

    And when the rep IS the accounting staffer — which the source workbook's own sample is — the
    second block is blanked rather than printing the same person twice."""
    rep = rec["user"] or ""
    acct = rec["acctApprovedBy"] or ACCT_DEFAULT
    director = rec["dirApprovedBy"] or DIRECTOR_DEFAULT
    if acct.strip().lower() == rep.strip().lower():
        acct = ""
    return {"rep": rep, "accounting": acct, "director": director}


ACCT_DEFAULT = "ROJAN LEO R. FRANCISCO JR."
DIRECTOR_DEFAULT = "NEIL M. ESTUR"
ACCT_TITLE = "Accounting Staff"
DIRECTOR_TITLE = "Director"

_RECEIPT_SEQ_RE = re.compile(r"^receipt-(\d+)\.", re.IGNORECASE)


def receipt_seq_from_filename(name):
    """'receipt-3.jpg' → 3, else None.

    The filename is the durable link between a Drive file and its leg. FlowAPI's _writeItems deletes
    and re-appends every item row on every save, so a failed write-back leaves 'Receipt Doc ID' blank
    forever while the file survives — exactly the hazard A178 hit with item photos, which is why it
    put the key in the filename too. The ID column is an optimisation; this is the fallback."""
    m = _RECEIPT_SEQ_RE.match(str(name or ""))
    return int(m.group(1)) if m else None


# ══════════════════════════════════════════════════════════════════════════════
#  Rendering
# ══════════════════════════════════════════════════════════════════════════════
HEAD_ZONE_H = 70 * PX               # the logo/address band the story reserves on every page
ROW_H = 22 * PX                     # one ruled row; chosen so an empty claim yields the design's counts
MAX_BLANK_P1, MAX_BLANK_P2, MAX_BLANK_P3 = 7, 8, 12
FRAME_H = PAGE_H - (36 * PX + 24 * PX) - (34 * PX)


class _TravTemplate(BaseDocTemplate):
    """ONE page template. Chrome is whatever is identical on every page; everything that changes —
    the eyebrow, the title, the date — is a story flowable.

    That split is not a style choice, it is what makes the document correct. _on_page fires before
    the flowables that will land on that page are known, so a `getPageNumber() == 3` branch cannot
    tell the COENRR from the itinerary's second page. NextPageTemplate fails the same way for a
    different reason: measured here, a table that overflows CONSUMES the queued template, so page 2's
    chrome lands on page 1's continuation. Titles as content means nothing can be wrong when the page
    count shifts."""

    def __init__(self, buf, **kw):
        super().__init__(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=36 * PX + 24 * PX, bottomMargin=34 * PX, **kw)
        frame = Frame(MARGIN, 34 * PX, CONTENT_W, FRAME_H,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="trav", frames=[frame], onPage=self._on_page)])

    def _on_page(self, canvas, doc):
        top = PAGE_H - 30 * PX
        try:
            pil = PILImage.open(_LOGO_PATH)
            iw, ih = pil.size
            h = 40 * PX
            w = h * (iw / ih) if ih else h
            canvas.drawImage(_LOGO_PATH, MARGIN, top - h, w, h,
                             preserveAspectRatio=True, mask="auto")
        except Exception:
            canvas.saveState()
            canvas.setFillColor(HEADING)
            canvas.setFont(ARCH_B, 14 * PX)
            canvas.drawString(MARGIN, top - 14 * PX, COMPANY_NAME)
            canvas.restoreState()
        canvas.saveState()
        canvas.setFillColor(LABELA)
        canvas.setFont(LATO, 8.5 * PX)
        for i, ln in enumerate(_ADDRESS_LINES):
            canvas.drawRightString(PAGE_W - MARGIN, top - 10 * PX - i * 11 * PX, ln)
        canvas.restoreState()


_ADDRESS_LINES = ["Blk 90, Lot 2&4, Phase I, Brgy Kaypian, University Heights",
                  "San Jose Delmonte Bulacan Philippines 3023"]


class _NumberedTrav(_canvas.Canvas):
    """Two-pass 'Page X of Y' — the whole reason the receipt annex is drawn as flowables rather than
    merged in afterwards with PyPDF2. Merged pages fall outside this count, so a five-page pack would
    print 'Page 3 of 3' and then keep going."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for st in self._saved:
            self.__dict__.update(st)
            self.setFillColor(LABELB)
            self.setFont(LATO, 8.5 * PX)
            self.drawRightString(PAGE_W - MARGIN, 20 * PX, "Page %d of %d" % (self._pageNumber, total))
            super().showPage()
        super().save()


def _head(title, date_text=None, continued=False):
    """The eyebrow + title + optional date, as flowables. A continuation page says so — a missing
    title is a bug you can see; a wrong one is not."""
    out = [Spacer(1, HEAD_ZONE_H),
           Paragraph(_spw("TRAVEL ALLOWANCE"), _ps("taEyebrow", 9, TA_ORANGE, ARCH_B, leading_mult=1.4)),
           Spacer(1, 4 * PX),
           Paragraph(_esc(title) + (" <font size='11'>— continued</font>" if continued else ""),
                     _ps("taTitle", 24, HEADING, ARCH_B, leading_mult=1.2))]
    if date_text:
        out += [Spacer(1, 4 * PX),
                Paragraph("Date — " + _esc(date_text), _ps("taDate", 10.5, MUTED8))]
    out.append(Spacer(1, 16 * PX))
    return out


def _ruled(rows, col_w, aligns, n_blank, header=None, first_row_h=None):
    """A hairline-ruled table with blank filler rows, in the design's idiom.

    `first_row_h` gives the first BODY row extra height. Page 1's particulars sentence is two lines of
    the document's own wording; at one row height it drew across the rule below it, and clipping it
    would have looked like a fault rather than a layout choice."""
    data = []
    if header:
        data.append(header)
    data.extend(rows)
    for _ in range(n_blank):
        data.append([""] * len(col_w))
    if not data:
        return None
    heights = [ROW_H] * len(data)
    if first_row_h and rows:
        heights[1 if header else 0] = first_row_h
    t = Table(data, colWidths=col_w, rowHeights=heights)
    style = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
             ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
             ("LINEBELOW", (0, 0), (-1, -1), 0.5, TA_RULE)]
    if header:
        style += [("LINEBELOW", (0, 0), (-1, 0), 1.1, TA_HEAVY)]
    for ci, a in enumerate(aligns):
        if a == "right":
            style.append(("ALIGN", (ci, 0), (ci, -1), "RIGHT"))
    t.setStyle(TableStyle(style))
    return t


def _totline(label, value, emphasis, width):
    """One right-aligned label/value pair under a table. Amounts are ALWAYS an Archivo face — Lato
    has no peso glyph and would print .notdef where the money goes."""
    lab_st = _ps("taTotL", 9.5 if not emphasis else 10.5,
                 HEADING if emphasis else MUTED7, ARCH_B if emphasis else ARCH_SB, align=2)
    val_st = _ps("taTotV", 12 if emphasis else 11,
                 TA_ORANGE if emphasis else HEADING, ARCH_B, align=2)
    t = Table([[Paragraph(_spw(label), lab_st),
                Paragraph(money(value), val_st)]],
              colWidths=[width - 130 * PX, 130 * PX])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 5 * PX),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * PX)]))
    return t


def _sigblock(caption, name, title, width):
    """Grey caption · signature rule · bold NAME · grey position.

    The position falls back to a non-breaking space rather than an empty string: an empty Paragraph
    collapses and the three blocks then have different heights, so their rules stop lining up —
    flow_pr_pdf.py already does exactly this for the same reason."""
    cap_st = _ps("taSigC", 9, MUTED8, leading_mult=1.35)
    nm_st = _ps("taSigN", 10.5, HEADING, ARCH_B, leading_mult=1.3)
    ps_st = _ps("taSigP", 9.5, LABEL9, leading_mult=1.3)
    inner = Table([[Paragraph(_esc(caption), cap_st)],
                   [Spacer(1, 34 * PX)],
                   [Paragraph(_esc(name) or "&nbsp;", nm_st)],
                   [Paragraph(_esc(title) or "&nbsp;", ps_st)]], colWidths=[width])
    inner.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * PX),
        ("LINEBELOW", (0, 1), (0, 1), 0.8, HAIR_EC)]))
    return inner


def _sigrow(blocks, width):
    gap = 16 * PX
    n = len(blocks)
    w = (width - gap * (n - 1)) / n
    cells = [_sigblock(c, nm, ti, w) for c, nm, ti in blocks]
    t = Table([cells], colWidths=[w] * n, hAlign="LEFT")
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
          ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]
    for i in range(1, n):
        st.append(("LEFTPADDING", (i, 0), (i, 0), gap))
    t.setStyle(TableStyle(st))
    return t


def _labelled(pairs, width):
    """The LABEL / value blocks on pages 2 and 3."""
    n = len(pairs)
    w = width / n
    lab = _ps("taLab", 8.5, LABELA, ARCH_SB, leading_mult=1.5)
    val = _ps("taVal", 11.5, HEADING, ARCH_B, leading_mult=1.35)
    cells = [[Paragraph(_spw(l), lab), Paragraph(_esc(v) or "—", val)] for l, v in pairs]
    t = Table([[c for c in cells]], colWidths=[w] * n, hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 8 * PX),
                           ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 10 * PX)]))
    return t


# ── Page 1: Replenishment Report ─────────────────────────────────────────────
def _page1(rec):
    body = _ps("taBody", 10, BODY2, leading_mult=1.4)
    amt = _ps("taAmt", 10.5, HEADING, ARCH_B, align=2)
    hdr = _ps("taTh", 8.5, LABELA, ARCH_SB)
    hdr_r = _ps("taThR", 8.5, LABELA, ARCH_SB, align=2)

    col = [CONTENT_W - 150 * PX, 150 * PX]
    sentence = _particulars_sentence(rec)
    rows = [[Paragraph(sentence, body), Paragraph(money(rec["totalSpent"]), amt)]]

    lines = _page1_lines(rec)
    tot_h = len(lines) * 24 * PX + 18 * PX
    sig_h = 120 * PX
    budget = FRAME_H - HEAD_ZONE_H - 90 * PX - tot_h - sig_h
    n_blank = _fit_rows(len(rows), ROW_H, budget, MAX_BLANK_P1)

    out = _head("Replenishment Report of Travel Allowance",
                ph_date_slash(rec["date"], default=rec["date"] or "—"))
    out.append(_ruled(rows, col, ["left", "right"], n_blank,
                      header=[Paragraph(_spw("PARTICULARS"), hdr), Paragraph(_spw("AMOUNT"), hdr_r)],
                      first_row_h=ROW_H * 2))
    out.append(Spacer(1, 10 * PX))
    for i, (label, value, emph) in enumerate(lines):
        if emph:
            out.append(_HeavyRule(CONTENT_W))
        out.append(_totline(label, value, emph, CONTENT_W))
    if rec["overspendReason"]:
        out.append(Spacer(1, 6 * PX))
        out.append(Paragraph("<b>Reason for the overspend:</b> " + _esc(rec["overspendReason"]),
                             _ps("taOver", 9.5, BODY3, leading_mult=1.4)))
    if rec["floatAmount"] == 0:
        out.append(Spacer(1, 4 * PX))
        out.append(Paragraph("no float has been issued to this employee yet",
                             _ps("taNoFloat", 9, LABEL9, align=2)))

    s = _signers(rec)
    out.append(Spacer(1, 26 * PX))
    out.append(_sigrow([("Certified: Correctness of the above data:", s["rep"], rec["position"]),
                        ("Certified: Supporting documents complete & proper:", s["accounting"],
                         ACCT_TITLE if s["accounting"] else ""),
                        ("Certified: The overall purpose is approve:", s["director"], DIRECTOR_TITLE)],
                       CONTENT_W))
    return out


class _HeavyRule(Flowable):
    """The dark rule above REMAINING / TOTAL."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 6 * PX

    def draw(self):
        self.canv.setStrokeColor(TA_HEAVY)
        self.canv.setLineWidth(1.4)
        self.canv.line(0, 1.5 * PX, self.width, 1.5 * PX)


# ── Page 2: Travel Itinerary ─────────────────────────────────────────────────
def _page2(rec):
    hdr = _ps("p2Th", 8.5, LABELA, ARCH_SB)
    hdr_r = _ps("p2ThR", 8.5, LABELA, ARCH_SB, align=2)
    hdr_pad = _ps("p2ThP", 8.5, LABELA, ARCH_SB, leftIndent=10 * PX)
    cell = _ps("p2C", 9.5, BODY2, leading_mult=1.3)
    cell_h = _ps("p2Ch", 9.5, HEADING, leading_mult=1.3)
    cell_r = _ps("p2Cr", 9.5, HEADING, ARCH_SB, align=2, leading_mult=1.3)

    # DEPARTURE/ARRIVAL are right-aligned and TRANSPORTATION left-aligned; at the design's widths the
    # letterspaced ARRIVAL heading ran straight into TRANSPORTATION's. Widened, and the transport
    # column now starts with a gap of its own.
    col = [72 * PX, CONTENT_W - 72 * PX - 76 * PX - 68 * PX - 124 * PX - 88 * PX,
           76 * PX, 68 * PX, 124 * PX, 88 * PX]
    header = [Paragraph(_spw("DATE"), hdr), Paragraph(_spw("DESCRIPTION"), hdr),
              Paragraph(_spw("DEPARTURE"), hdr_r), Paragraph(_spw("ARRIVAL"), hdr_r),
              Paragraph(_spw("TRANSPORTATION"), hdr_pad), Paragraph(_spw("AMOUNT"), hdr_r)]

    legs = [i for i in rec["items"] if i["kind"] == "Transport"]

    # Chunk against a MEASURED budget rather than a fixed row count. flow_pr_pdf.py's own comment
    # records why: padding blindly to a fixed number overflowed the frame whenever rows were tall and
    # pushed the signature block to an extra page.
    meta_h = 96 * PX
    tot_h = 34 * PX
    sig_h = 150 * PX
    first_budget = FRAME_H - HEAD_ZONE_H - 90 * PX - meta_h - ROW_H - tot_h - sig_h
    cont_budget = FRAME_H - HEAD_ZONE_H - 90 * PX - ROW_H - tot_h - sig_h
    per_first = max(1, int(first_budget // ROW_H))
    per_cont = max(1, int(cont_budget // ROW_H))

    chunks, i = [], 0
    if not legs:
        chunks = [[]]
    while i < len(legs):
        take = per_first if not chunks else per_cont
        chunks.append(legs[i:i + take])
        i += take

    out = []
    for ci, chunk in enumerate(chunks):
        is_last = (ci == len(chunks) - 1)
        if ci:
            out.append(PageBreak())
        out += _head("Travel Itinerary",
                     ph_date_slash(rec["date"], default=rec["date"] or "—"),
                     continued=bool(ci))
        if not ci:
            out.append(_labelled([("NAME OF EMPLOYEE", rec["user"]), ("POSITION", rec["position"]),
                                  ("DATE", ph_date_slash(rec["date"], rec["date"]))], CONTENT_W))
            out.append(_labelled([("DURATION", _duration_text(rec)),
                                  ("PURPOSE", rec["purpose"])], CONTENT_W))
            out.append(Spacer(1, 6 * PX))

        firsts = _day_first_rows(chunk)          # per CHUNK — every page opens with a date
        rows = []
        for r, first in zip(chunk, firsts):
            rows.append([
                Paragraph(ph_date_slash(r["date"], r["date"]) if first else "", cell_h),
                Paragraph(_esc(_clip_text(r["description"], cell, col[1], 1)), cell_h),
                Paragraph(_esc(_clip_text(r["departureTime"], cell, col[2], 1)), cell),
                Paragraph(_esc(_clip_text(r["arrivalTime"], cell, col[3], 1)), cell),
                Paragraph(_esc(_clip_text(r["means"], cell, col[4] - 10 * PX, 1)),
                          _ps("p2Cm", 9.5, BODY2, leading_mult=1.3, leftIndent=10 * PX)),
                Paragraph(_fmt(r["amount"]), cell_r)])
        budget = (first_budget if not ci else cont_budget)
        n_blank = _fit_rows(len(rows), ROW_H, budget, MAX_BLANK_P2)
        out.append(_ruled(rows, col, ["left", "left", "right", "right", "left", "right"],
                          n_blank, header=header))
        if is_last:
            # ONE total, on the last chunk only. A total repeated on every chunk reads as if the rep
            # spent the whole amount once per page.
            out.append(_HeavyRule(CONTENT_W))
            out.append(_totline("TOTAL", rec["transportTotal"], True, CONTENT_W))
            out.append(Spacer(1, 26 * PX))
            out.append(_p2_certify(rec))
    return out


def _p2_certify(rec):
    s = _signers(rec)
    cert = _ps("p2Cert", 9.5, BODY2, leading_mult=1.5)
    left = [Paragraph("<b>I CERTIFY that:</b>", _ps("p2CertH", 9.5, HEADING, LATO_B)),
            Spacer(1, 5 * PX),
            Paragraph("(1) I have reviewed the foregoing itinerary;", cert),
            Paragraph("(2) the travel is necessary to the business;", cert),
            Paragraph("(3) the period covered is reasonable; and", cert),
            Paragraph("(4) the expenses claimed are proper.", cert)]
    right = _sigrow([("PREPARED BY", s["rep"], rec["position"]),
                     ("APPROVED BY", s["director"], DIRECTOR_TITLE)], CONTENT_W / 2 - 10 * PX)
    t = Table([[left, right]], colWidths=[CONTENT_W / 2, CONTENT_W / 2])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


# ── Page 3: Certification of Expenses Not Requiring Receipts ─────────────────
def _page3(rec):
    hdr = _ps("p3Th", 8.5, LABELA, ARCH_SB)
    hdr_r = _ps("p3ThR", 8.5, LABELA, ARCH_SB, align=2)
    cell = _ps("p3C", 9.5, HEADING, leading_mult=1.3)
    cell_r = _ps("p3Cr", 9.5, HEADING, ARCH_SB, align=2, leading_mult=1.3)

    col = [92 * PX, CONTENT_W - 92 * PX - 120 * PX, 120 * PX]
    header = [Paragraph(_spw("DATE"), hdr), Paragraph(_spw("PARTICULARS"), hdr),
              Paragraph(_spw("AMOUNT"), hdr_r)]

    none_receipt = [i for i in rec["items"] if not i["hasReceipt"]]
    rows = []
    for r in none_receipt:
        what = ", ".join(x for x in (r["means"], r["description"]) if x) or r["kind"]
        rows.append([Paragraph(ph_date_slash(r["date"], r["date"]), cell),
                     Paragraph(_esc(_clip_text(what, cell, col[1], 1)), cell),
                     Paragraph(_fmt(r["amount"]), cell_r)])

    budget = FRAME_H - HEAD_ZONE_H - 90 * PX - 70 * PX - 34 * PX - 120 * PX
    n_blank = _fit_rows(len(rows), ROW_H, budget, MAX_BLANK_P3)

    out = [PageBreak()]
    out += _head("Certification of Expenses Not Requiring Receipts")
    out.append(_labelled([("NAME OF EMPLOYEE", rec["user"]), ("POSITION", rec["position"])],
                         CONTENT_W))
    out.append(Spacer(1, 4 * PX))
    out.append(_ruled(rows, col, ["left", "left", "right"], n_blank, header=header))
    out.append(_HeavyRule(CONTENT_W))
    out.append(_totline("TOTAL", rec["noReceiptTotal"], True, CONTENT_W))
    s = _signers(rec)
    out.append(Spacer(1, 30 * PX))
    # SWAPPED relative to TravelAllow.pdf — see the module docstring. The rep certifies what they
    # spent; the director approves it. The template has the director certifying his own correctness.
    out.append(_sigrow([("CERTIFIED CORRECT", s["rep"], rec["position"]),
                        ("APPROVED BY", s["director"], DIRECTOR_TITLE)], CONTENT_W))
    return out


# ── The receipt annex ────────────────────────────────────────────────────────
_MAX_RECEIPT_BYTES = 4 * 1024 * 1024
_MAX_RECEIPT_TOTAL = 10 * 1024 * 1024


class _Receipt(Flowable):
    """One receipt photo in a fixed slot, or an honest placeholder.

    Degrades exactly as _Thumb does and NEVER raises: a decode failure draws a bordered box saying so,
    because a silently missing receipt in an approval pack is the worst outcome available — the
    approver sees three, the claim says five, and nothing anywhere says one was dropped.

    exif_transpose is the difference from _Thumb: at 66px a rotated phone photo is a curiosity, at
    half a page it is unreadable."""

    def __init__(self, img_bytes, width, height, note=""):
        super().__init__()
        self.img_bytes = img_bytes
        self.width = width
        self.height = height
        self.note = note

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(HAIR_EC)
        c.setLineWidth(0.5)
        c.rect(0, 0, self.width, self.height, stroke=1, fill=0)
        drew = False
        if self.img_bytes and not self.note:
            try:
                pil = PILImage.open(BytesIO(self.img_bytes))
                try:
                    pil = ImageOps.exif_transpose(pil)
                except Exception:
                    pass
                if pil.mode not in ("RGB", "RGBA"):
                    pil = pil.convert("RGB")
                pil.thumbnail((int(self.width * 150 / 72), int(self.height * 150 / 72)))
                iw, ih = pil.size
                sc = min(self.width / iw, self.height / ih) if iw and ih else 1
                w, h = iw * sc, ih * sc
                c.drawImage(ImageReader(pil), (self.width - w) / 2, (self.height - h) / 2, w, h,
                            preserveAspectRatio=True, mask="auto")
                drew = True
            except Exception:
                logger.warning("travel receipt could not be decoded; drawing a placeholder")
        if not drew:
            c.setFillColor(LABELB)
            c.setFont(LATO, 9 * PX)
            msg = self.note or "receipt could not be read"
            c.drawCentredString(self.width / 2, self.height / 2 - 3 * PX, msg)
        c.restoreState()


def _annex(rec, receipts):
    """Two receipts per page, each captioned with its leg.

    Two, not three: an A4 frame gives each ~330pt at two-up, which is a legible receipt; three-up is
    ~215pt, which is not."""
    if not receipts:
        return []
    by_seq = {i["seq"]: i for i in rec["items"]}
    slot_h = (FRAME_H - HEAD_ZONE_H - 90 * PX - 4 * 18 * PX) / 2
    cap_st = _ps("taCap", 8.5, MUTED8, leading_mult=1.35)

    running = 0
    cells = []
    for r in receipts:
        seq = int(_num(r.get("seq")))
        item = by_seq.get(seq) or {"seq": seq, "date": "", "means": "", "description": "",
                                   "amount": 0.0, "kind": ""}
        raw = r.get("bytes")
        note = ""
        if raw is None:
            note = "receipt not included in this preview"
        elif len(raw) > _MAX_RECEIPT_BYTES or running + len(raw) > _MAX_RECEIPT_TOTAL:
            note = "receipt too large to print — see Drive"
        else:
            running += len(raw)
        cells.append((_Receipt(raw, CONTENT_W, slot_h, note),
                      Paragraph(_esc(_receipt_caption(rec, item)), cap_st)))

    out = []
    for idx in range(0, len(cells), 2):
        out.append(PageBreak())
        out += _head("Supporting Receipts", continued=(idx > 0))
        for flow, cap in cells[idx:idx + 2]:
            out.append(flow)
            out.append(Spacer(1, 5 * PX))
            out.append(cap)
            out.append(Spacer(1, 13 * PX))
    return out


# ── Entry point ──────────────────────────────────────────────────────────────
def build_travel_allowance_pdf_bytes(record, receipts=None):
    """record → the three-page pack (+ annex) as bytes.

    PURE: no sheet read, no Drive call, no Trav No required. That is what lets the rep's page render
    a live preview of a document that has not been saved yet, exactly as the Quote Configurator does.

    `receipts` is [{seq, bytes}] — `bytes=None` draws the slot and its caption but no image, which is
    how a preview keeps the page count honest without shipping megabytes on every keystroke.

    The annex NEVER changes a total: every figure comes from the items."""
    rec = _normalise(record)
    buf = BytesIO()
    doc = _TravTemplate(buf)
    story = []
    story += _page1(rec)
    story.append(PageBreak())
    story += _page2(rec)
    story += _page3(rec)
    story += _annex(rec, receipts or [])
    doc.build(story, canvasmaker=_NumberedTrav)
    return buf.getvalue()
