"""A277 — the two lead-generation documents.

  1. The FRIDAY REPORT — one A4 page for the 3pm meeting: the eight weekly numbers against the
     week's targets (daily quota × working days, holidays removed), a Mon–Sun grid, and the reply
     rate with its definition printed under it.
  2. The LEAD SHEET — one page per qualified lead: who, where, the four qualification checks, the
     pain, what they said, the next step, and which rep it went to.

DELIBERATELY PURE. Both take the exact payload the page drew from (getLeadgenCounts / getLeadgen)
and read no sheet, so the document agrees with the screen by construction — there is no second
count that could drift from the first. The visual vocabulary is imported from the quotation
renderer, never copied, so the documents read as siblings of everything else the company prints;
flow_quotation_pdf.py is not edited.
"""

import logging
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)
from PIL import Image as PILImage

from pdf_generators.flow_quotation_pdf import (
    PX, PAGE_W, PAGE_H, MARGIN, CONTENT_W,
    LATO, LATO_B, ARCH_B, ARCH_XB,
    HEADING, TEXT, BODY2, MUTED7, LABEL9, HAIR_E,
    COMPANY_NAME, COMPANY_ADDRESS,
    _esc, _ps, _LOGO_PATH,
)

logger = logging.getLogger(__name__)

# The dashboard's accent, not the quotation's red: this is an internal document and reads as the
# page it came from. A local token on purpose — importing ACCENT would repaint it on a re-theme.
INDIGO = HexColor("#4f46e5")
INDIGO_DARK = HexColor("#3730a3")
INDIGO_SOFT = HexColor("#e0e7ff")
OK = HexColor("#15803d")
OK_SOFT = HexColor("#dcfce7")
WARN = HexColor("#b45309")
WARN_SOFT = HexColor("#fef3c7")
GREY_SOFT = HexColor("#eef2f6")

TOP = 40 * PX
BOTTOM = 40 * PX
LOGO_H = 54 * PX

KEYS = ["plants", "contacts", "introEmails", "followupEmails", "coldCalls", "followupCalls", "leads", "meetings"]
LABELS = {"plants": "Plants researched", "contacts": "Contacts verified", "introEmails": "Intro emails",
          "followupEmails": "Follow-up emails", "coldCalls": "Cold calls", "followupCalls": "Follow-up calls",
          "leads": "Leads handed off", "meetings": "Meetings booked"}
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _n(v):
    try:
        return int(float(v or 0))
    except Exception:
        return 0


def _s(v):
    return "" if v is None else str(v)


class _Doc(BaseDocTemplate):
    """Letterhead on every page: logo left, company right, a hairline under. The title is set by the
    flow so a lead sheet and a report share the template."""

    def __init__(self, buf, footer, **kw):
        super().__init__(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=TOP + LOGO_H + 18 * PX, bottomMargin=BOTTOM + 14 * PX, **kw)
        self._footer = footer
        frame = Frame(MARGIN, self.bottomMargin, CONTENT_W, PAGE_H - self.topMargin - self.bottomMargin,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="lg", frames=[frame], onPage=self._on_page)])

    def _on_page(self, canvas, doc):
        canvas.saveState()
        top = PAGE_H - TOP
        try:
            pil = PILImage.open(_LOGO_PATH)
            iw, ih = pil.size
            w = LOGO_H * (iw / ih) if ih else LOGO_H
            canvas.drawImage(_LOGO_PATH, MARGIN, top - LOGO_H, w, LOGO_H, preserveAspectRatio=True, mask="auto")
        except Exception:
            canvas.setFillColor(HEADING)
            canvas.setFont(ARCH_B, 14 * PX)
            canvas.drawString(MARGIN, top - 14 * PX, COMPANY_NAME)
        canvas.setFillColor(HEADING)
        canvas.setFont(ARCH_B, 10 * PX)
        canvas.drawRightString(PAGE_W - MARGIN, top - 10 * PX, COMPANY_NAME)
        canvas.setFillColor(MUTED7)
        canvas.setFont(LATO, 8 * PX)
        y = top - 22 * PX
        for line in COMPANY_ADDRESS.split("\n"):
            canvas.drawRightString(PAGE_W - MARGIN, y, line)
            y -= 10 * PX
        canvas.setStrokeColor(HAIR_E)
        canvas.setLineWidth(0.8)
        canvas.line(MARGIN, top - LOGO_H - 8 * PX, PAGE_W - MARGIN, top - LOGO_H - 8 * PX)
        # footer
        canvas.setFillColor(LABEL9)
        canvas.setFont(LATO, 8 * PX)
        canvas.drawString(MARGIN, BOTTOM, self._footer)
        canvas.drawRightString(PAGE_W - MARGIN, BOTTOM, "Page %d" % doc.page)
        canvas.restoreState()


def _title(text, sub=None):
    out = [Paragraph(_esc(text), _ps("lgTitle", 22, HEADING, ARCH_XB, leading_mult=1.15))]
    if sub:
        out.append(Spacer(1, 4 * PX))
        out.append(Paragraph(_esc(sub), _ps("lgSub", 10, BODY2, LATO)))
    out.append(Spacer(1, 14 * PX))
    return out


def _eyebrow(text):
    return Paragraph(_esc(text).upper(), _ps("lgEye", 8, LABEL9, LATO_B, leading_mult=1.3))


# ── 1 · the Friday report ─────────────────────────────────────────────────────────────────────
def build_leadgen_week_pdf_bytes(payload):
    """payload = the getLeadgenCounts response (+ preparedBy). Returns PDF bytes."""
    p = payload or {}
    week = p.get("week") or {}
    quotas = p.get("quotas") or {}
    totals = week.get("totals") or {}
    targets = week.get("targets") or {}
    by_day = week.get("byDay") or {}
    days = week.get("days") or []
    working = week.get("workingDays") or []
    sector = p.get("sector") or {}
    reps = p.get("reps") or {}

    buf = BytesIO()
    footer = "Prepared by %s · Lead generation · week of %s" % (_s(p.get("preparedBy")) or "—", _s(week.get("start")))
    doc = _Doc(buf, footer)
    story = []
    sub = "Week of %s to %s · %d working day%s" % (_s(week.get("start")), _s(week.get("end")), len(working), "" if len(working) == 1 else "s")
    if sector.get("name"):
        sub += " · Sector week %s of %s: %s" % (_s(sector.get("index")), _s(sector.get("of")), _s(sector.get("name")))
    story += _title("Lead Generation — Weekly Report", sub)

    # the eight, against targets
    hdr = _ps("lgTh", 8, LABEL9, LATO_B, leading_mult=1.2)
    cell = _ps("lgTd", 9.5, TEXT, LATO, leading_mult=1.2)
    cell_b = _ps("lgTdb", 9.5, HEADING, ARCH_B, leading_mult=1.2)
    cell_r = _ps("lgTdr", 9.5, TEXT, LATO, align=2, leading_mult=1.2)
    cell_rb = _ps("lgTdrb", 9.5, HEADING, ARCH_B, align=2, leading_mult=1.2)
    rows = [[Paragraph("METRIC", hdr), Paragraph("DAILY QUOTA", _ps("h2", 8, LABEL9, LATO_B, align=2)),
             Paragraph("WEEK TARGET", _ps("h3", 8, LABEL9, LATO_B, align=2)), Paragraph("ACTUAL", _ps("h4", 8, LABEL9, LATO_B, align=2)),
             Paragraph("%", _ps("h5", 8, LABEL9, LATO_B, align=2)), Paragraph("STATUS", _ps("h6", 8, LABEL9, LATO_B, align=1))]]
    styles = [("LINEBELOW", (0, 0), (-1, 0), 0.8, HAIR_E), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 6 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 6 * PX),
              ("LEFTPADDING", (0, 0), (-1, -1), 6 * PX), ("RIGHTPADDING", (0, 0), (-1, -1), 6 * PX)]
    for i, k in enumerate(KEYS, start=1):
        n, t, q = _n(totals.get(k)), _n(targets.get(k)), _n(quotas.get(k))
        pct = int(round(n * 100.0 / t)) if t else 0
        met = t > 0 and n >= t
        status = "met" if met else ("%d short" % (t - n) if t else "no target")
        rows.append([Paragraph(_esc(LABELS[k]), cell_b), Paragraph(str(q), cell_r), Paragraph(str(t), cell_r),
                     Paragraph(str(n), cell_rb), Paragraph("%d%%" % pct if t else "—", cell_r),
                     Paragraph(_esc(status), _ps("st%d" % i, 8, OK if met else WARN, LATO_B, align=1))])
        styles.append(("BACKGROUND", (5, i), (5, i), OK_SOFT if met else WARN_SOFT))
        styles.append(("LINEBELOW", (0, i), (-1, i), 0.5, HAIR_E))
    t1 = Table(rows, colWidths=[CONTENT_W * 0.34, CONTENT_W * 0.13, CONTENT_W * 0.14, CONTENT_W * 0.12, CONTENT_W * 0.10, CONTENT_W * 0.17])
    t1.setStyle(TableStyle(styles))
    story += [_eyebrow("The eight, against this week's targets"), Spacer(1, 4 * PX), t1, Spacer(1, 10 * PX)]

    # reply rate — defined, not left to the reader
    rate = week.get("replyRate")
    aim = week.get("replyRateAim")
    rate_s = "—" if rate is None else ("%s%%" % rate)
    story.append(Paragraph("<b>Reply rate: %s</b>%s" % (_esc(rate_s), (" (aim %s%%)" % _esc(aim)) if aim else ""), _ps("lgRate", 11, HEADING, LATO)))
    story.append(Paragraph(_esc("Replies received this week ÷ intro emails sent this week — %d ÷ %d. A reply is a contact whose status moved to Replied; an intro is one email in an Intro batch."
                                % (_n(week.get("replies")), _n(totals.get("introEmails")))), _ps("lgRateNote", 8, MUTED7, LATO)))
    story.append(Spacer(1, 14 * PX))

    # Mon–Sun grid
    small_h = _ps("gh", 8, LABEL9, LATO_B, align=1, leading_mult=1.2)
    small = _ps("gc", 8.5, TEXT, LATO, align=1, leading_mult=1.2)
    small_b = _ps("gcb", 8.5, HEADING, ARCH_B, align=1, leading_mult=1.2)
    grid = [[Paragraph("", small_h)] + [Paragraph("%s<br/>%s" % (DOW[i] if i < 7 else "", _esc(d[5:])), small_h) for i, d in enumerate(days)]]
    g_styles = [("LINEBELOW", (0, 0), (-1, 0), 0.8, HAIR_E), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * PX)]
    for j, d in enumerate(days, start=1):
        if d not in working:
            g_styles.append(("BACKGROUND", (j, 0), (j, -1), GREY_SOFT))
            g_styles.append(("TEXTCOLOR", (j, 1), (j, -1), LABEL9))
    for k in KEYS:
        line = [Paragraph(_esc(LABELS[k]), _ps("gl", 8.5, TEXT, LATO, leading_mult=1.2))]
        q = _n(quotas.get(k))
        for d in days:
            c = by_day.get(d) or {}
            n = _n(c.get(k))
            style = small_b if (q and n >= q and c.get("working")) else small
            line.append(Paragraph(str(n) if (c.get("working") or n) else "·", style))
        grid.append(line)
    t2 = Table(grid, colWidths=[CONTENT_W * 0.30] + [CONTENT_W * 0.10] * 7)
    t2.setStyle(TableStyle(g_styles))
    story += [_eyebrow("Day by day — bold where the daily quota was met; grey columns are not working days"), Spacer(1, 4 * PX), t2, Spacer(1, 12 * PX)]

    who = []
    if reps.get("Luzon"):
        who.append("Luzon: %s" % reps["Luzon"])
    if reps.get("VisMin"):
        who.append("VisMin: %s" % reps["VisMin"])
    story.append(Paragraph(_esc("Leads handed to: " + (" · ".join(who) if who else "no rep set — configure lgRepLuzon / lgRepVisMin")), _ps("lgReps", 8.5, BODY2, LATO)))
    if p.get("holidays"):
        story.append(Paragraph(_esc("Holidays this configuration: " + ", ".join(p.get("holidays"))), _ps("lgHol", 8.5, BODY2, LATO)))
    story.append(Spacer(1, 18 * PX))
    story.append(Paragraph("Reviewed at the Friday 3pm meeting. Quotas are adjusted by the director or management after the first month.", _ps("lgFoot", 8, LABEL9, LATO)))

    doc.build(story)
    return buf.getvalue()


# ── 2 · the lead sheet ────────────────────────────────────────────────────────────────────────
def build_leadgen_lead_pdf_bytes(payload):
    """payload = {lead: <getLeadgen leads row>, preparedBy}. Returns PDF bytes."""
    p = payload or {}
    l = p.get("lead") or {}
    buf = BytesIO()
    doc = _Doc(buf, "Prepared by %s · Lead sheet %s" % (_s(p.get("preparedBy")) or "—", _s(l.get("leadNo"))))
    story = []
    company = _s(l.get("company")) or "—"
    site = _s(l.get("plantSite"))
    story += _title("Lead Sheet — %s" % (company + (" — " + site if site else "")),
                    "%s · %s · %s" % (_s(l.get("leadNo")), _s(l.get("territory")) or "—", _s(l.get("status")) or "—"))

    lab = _ps("kvL", 8, LABEL9, LATO_B, leading_mult=1.25)
    val = _ps("kvV", 10, HEADING, LATO, leading_mult=1.35)

    def kv(label, value):
        return [Paragraph(_esc(label).upper(), lab), Paragraph(_esc(value) if value else "—", val)]

    facts = [
        kv("Company", company) + kv("Plant / site", site),
        kv("Sector", _s(l.get("sector"))) + kv("Province", _s(l.get("province"))),
        kv("Contact", (_s(l.get("contactName")) + ((" · " + _s(l.get("contactRole"))) if l.get("contactRole") else "")).strip(" ·"))
        + kv("Reach", " · ".join([x for x in [_s(l.get("contactMobile")), _s(l.get("contactEmail"))] if x])),
        kv("Handed to", _s(l.get("handedTo")) or "no rep set") + kv("Handed off on", _s(l.get("handedOffOn")) + ((" · re-handed " + _s(l.get("rehandedOn"))) if l.get("rehandedOn") else "")),
    ]
    tf = Table(facts, colWidths=[CONTENT_W * 0.14, CONTENT_W * 0.36, CONTENT_W * 0.14, CONTENT_W * 0.36])
    tf.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5 * PX),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * PX), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("LINEBELOW", (0, 0), (-1, -2), 0.5, HAIR_E)]))
    story += [tf, Spacer(1, 14 * PX)]

    # the four conditions
    checks = [("rightPerson", "The right person — maintenance / O&M head or MRO / purchasing"),
              ("ownMaintenance", "Runs its own maintenance"),
              ("flangedOrHydraulic", "Has flanged or hydraulic work"),
              ("saidYes", "Said yes to a presentation, or asked for a quote")]
    crow = []
    cst = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 5 * PX), ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * PX),
           ("LEFTPADDING", (0, 0), (-1, -1), 6 * PX)]
    for i, (k, text) in enumerate(checks):
        on = bool(l.get(k))
        # "YES" / "NO" rather than a tick glyph: neither Lato nor Archivo carries U+2713, and a
        # .notdef box beside "said yes" would read as the opposite of what it means.
        crow.append([Paragraph("YES" if on else "NO", _ps("ck%d" % i, 8, OK if on else WARN, ARCH_B, align=1)),
                     Paragraph(_esc(text), _ps("ct%d" % i, 9.5, TEXT, LATO))])
        cst.append(("BACKGROUND", (0, i), (0, i), OK_SOFT if on else WARN_SOFT))
    tc = Table(crow, colWidths=[34 * PX, CONTENT_W - 34 * PX])
    tc.setStyle(TableStyle(cst))
    story += [_eyebrow("Qualification — all four must hold"), Spacer(1, 4 * PX), tc, Spacer(1, 14 * PX)]

    def block(label, text):
        return [_eyebrow(label), Spacer(1, 2 * PX), Paragraph(_esc(text) if text else "—", _ps("bl", 10, TEXT, LATO, leading_mult=1.45)), Spacer(1, 10 * PX)]

    story += block("Pain", _s(l.get("pain")))
    story += block("What they said", _s(l.get("whatTheySaid")))
    nxt = _s(l.get("nextStep"))
    if l.get("nextStepDate"):
        nxt = (nxt + " · " if nxt else "") + _s(l.get("nextStepDate"))
    story += block("Next step", nxt)
    if l.get("presentationDate"):
        story += block("Presentation", _s(l.get("presentationDate")) + ((" (booked " + _s(l.get("bookedOn")) + ")") if l.get("bookedOn") else "")
                       + ((" · attendees: " + _s(l.get("attendees"))) if l.get("attendees") else ""))
    if l.get("status") == "Returned":
        story += block("Returned by the rep on " + _s(l.get("returnedOn")), _s(l.get("returnReason")))
    if l.get("notes"):
        story += block("Notes", _s(l.get("notes")))
    doc.build(story)
    return buf.getvalue()
