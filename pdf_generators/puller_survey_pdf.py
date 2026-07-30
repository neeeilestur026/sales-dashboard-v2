"""Hydraulic Puller Application Survey PDF renderer (Addendum 185).

The sibling of bolting_survey_pdf.py, and the same ONE generator, TWO modes:

  blank=True   the printable hard copy — every label with a ruled blank beside it, empty checkboxes,
               a sketch box, and no recommendation block.
  blank=False  the same layout with the answers filled in, plus a Recommendation block naming the
               design pulling force and the assumption behind it, the jaw geometry the job REQUIRES,
               and the chosen puller labelled "System suggestion" or "Specified by <name>".

Sharing the layout is the point: the sheet a rep fills by hand and the sheet the system prints can
never drift out of step, because there is only one description of it.

Two things this sheet must never do, both enforced below:
  · It must not present jaw geometry as a catalogue fact. We hold family tonnage ratings only — no
    spread/reach/jaw-count data exists — so the geometry block is headed as a REQUIREMENT and closes
    by telling the reader to confirm it against the model's own dimension table.
  · It must not present an estimated pulling force as a measured one. The assumption line is printed
    verbatim beneath the figure whenever the force was estimated.

Every value goes through `_s()` first — numeric-looking values reach these generators as ints/floats
often enough that `.strip()` on a raw field has crashed a route before (A82/A135), and this one is fed
straight from a browser form.
"""

import os
import html
import logging
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer,
                                KeepTogether, Image)

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGO_PATH = os.path.join(_ROOT, "static", "images", "logo.png")

COMPANY = "H.O ESTUR CORPORATION"
ACCENT = colors.HexColor("#1F4E79")
ACCENT_RED = colors.HexColor("#C0392B")
HAIR = colors.HexColor("#c9d1d9")
LABEL = colors.HexColor("#5b6673")
INK = colors.HexColor("#1a1a1a")
SOFT = colors.HexColor("#f4f6f9")
WARN_BG = colors.HexColor("#fffbeb")
WARN_BD = colors.HexColor("#f0c000")

BLANK_RULE = "_" * 22       # what a printable blank looks like where a value would go


def _s(v):
    """Coerce anything to a clean string. Never trust the type of an incoming field."""
    if v is None:
        return ""
    if v is True:
        return "Yes"
    if v is False:
        return ""
    return str(v).strip()


def _esc(v):
    return html.escape(_s(v))


def _clip(v, limit):
    """Cap free text so it can never outgrow its cell. A survey field lives in a one-row table, and a
    ReportLab table row cannot split across pages — so an uncapped 10,000-char note raises LayoutError
    and the route 500s instead of printing (the A173-B1 class). Truncation is visible, which is the
    point: the rep sees the cut in the PDF."""
    t = _s(v)
    return t if len(t) <= limit else t[:limit].rstrip() + " …[truncated]"


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _st(name, size=9, leading=None, color=INK, bold=False, align=0):
    return ParagraphStyle(name=name, fontName="Helvetica-Bold" if bold else "Helvetica",
                          fontSize=size, leading=leading or (size * 1.35),
                          textColor=color, alignment=align)


S_LABEL = _st("psLabel", 7, 8.6, LABEL, bold=True)
S_VALUE = _st("psValue", 9, 11, INK)
S_BODY = _st("psBody", 8.4, 11, INK)
S_SMALL = _st("psSmall", 8, 11, LABEL)
S_H = _st("psH", 9.5, 12, colors.white, bold=True)
S_TITLE = _st("psTitle", 13, 15, ACCENT, bold=True)   # 13pt keeps this longer title on one line
S_SUB = _st("psSub", 8.5, 11, LABEL)
S_REC = _st("psRec", 10, 13.5, INK, bold=True)


def _field(label, value, blank):
    """A label above its value (or a ruled blank in hard-copy mode)."""
    shown = BLANK_RULE if blank else (_esc(_clip(value, 240)) or "&nbsp;")
    return [Paragraph(_esc(label).upper(), S_LABEL), Paragraph(shown, S_VALUE)]


def _grid(pairs, width, cols=2, blank=False):
    """Lay label/value fields out in `cols` columns with hairline separators."""
    cells, row = [], []
    for label, value in pairs:
        block = Table([[_field(label, value, blank)[0]], [_field(label, value, blank)[1]]],
                      colWidths=[(width / cols) - 6])
        block.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        row.append(block)
        if len(row) == cols:
            cells.append(row)
            row = []
    if row:
        while len(row) < cols:
            row.append("")
        cells.append(row)
    if not cells:
        return Spacer(1, 0)
    t = Table(cells, colWidths=[width / cols] * cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, HAIR),
    ]))
    return t


def _section(title, width):
    """A filled section bar."""
    t = Table([[Paragraph(_esc(title).upper(), S_H)]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _check(label, ticked, blank):
    """A checkbox + label. Courier brackets rather than U+2610/U+2612: the box glyphs are absent from
    Helvetica and fell back to a literal "n" on the page."""
    box = "[&nbsp;&nbsp;]" if (blank or not ticked) else "[X]"
    return Paragraph('<font name="Courier-Bold">' + box + "</font>&nbsp; " + _esc(label), S_BODY)


def _checkrow(items, width, blank):
    """items: [(label, ticked), …] laid out across one row."""
    cells = [_check(l, t, blank) for l, t in items]
    tbl = Table([cells], colWidths=[width / len(cells)] * len(cells))
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tbl


def _notebox(text, width, blank, lines=3):
    """Free-text area — ruled lines when blank, the text itself when filled."""
    if blank:
        rows = [[Paragraph("&nbsp;", S_VALUE)] for _ in range(lines)]
        t = Table(rows, colWidths=[width], rowHeights=[14] * lines)
        t.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, HAIR),
            ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ]))
        return t
    t = Table([[Paragraph(_esc(_clip(text, 1400)).replace("\n", "<br/>") or "&nbsp;", S_BODY)]],
              colWidths=[width])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, HAIR), ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _sketchbox(width, blank, lines=5):
    """An empty area for a hand sketch of the part and where the jaws can reach. Always ruled — even
    on the filled sheet, because the rep may still want to draw on the printout."""
    rows = [[Paragraph("&nbsp;", S_VALUE)] for _ in range(lines)]
    t = Table(rows, colWidths=[width], rowHeights=[15] * lines)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, HAIR),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#e8edf2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def _warn(title, body, width):
    inner = [[Paragraph("! " + _esc(title), _st("w1", 9, 12, colors.HexColor("#92400e"), bold=True))],
             [Paragraph(_esc(body), _st("w2", 8.6, 11.5, colors.HexColor("#78350f")))]]
    t = Table(inner, colWidths=[width - 16])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    outer = Table([[t]], colWidths=[width])
    outer.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, WARN_BD), ("BACKGROUND", (0, 0), (-1, -1), WARN_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 3, WARN_BD),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return outer


def _header(width, blank):
    """Logo + title + the standing note about what the sheet is for."""
    left = []
    if os.path.exists(_LOGO_PATH):
        try:
            left.append(Image(_LOGO_PATH, width=42 * mm, height=13 * mm, kind="proportional"))
        except Exception:                                     # a bad logo must never kill the render
            logger.warning("puller_survey_pdf: logo could not be drawn", exc_info=True)
    left.append(Paragraph(_esc(COMPANY), _st("co", 10, 13, INK, bold=True)))
    right = [Paragraph("HYDRAULIC PULLER APPLICATION SURVEY", S_TITLE),
             Paragraph("Hard copy — fill in and return to your Hi-ESCORP contact." if blank
                       else "Completed survey with the recommended puller.", S_SUB)]
    t = Table([[left, right]], colWidths=[width * 0.40, width * 0.60])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 1.2, ACCENT),
    ]))
    return t


def build_puller_survey_pdf_bytes(answers=None, recommendation=None, blank=False, prepared_by=""):
    """Render the survey and return its bytes. `blank=True` gives the printable empty form."""
    a = answers if isinstance(answers, dict) else {}
    rec = recommendation if isinstance(recommendation, dict) else {}

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm,
                            title="Hydraulic Puller Application Survey", author=COMPANY)
    W = doc.width
    E = []

    E.append(_header(W, blank))
    E.append(Spacer(1, 8))

    # ── 1. Request ────────────────────────────────────────────────────────────────────────────────
    E.append(_section("Request", W))
    E.append(Spacer(1, 4))
    E.append(_grid([
        ("Request by", a.get("requestBy")), ("Request date", a.get("requestDate")),
        ("Customer name", a.get("customer")), ("Industry", a.get("industry")),
        ("Application", a.get("application")), ("Contact / title", a.get("contact")),
        ("Date of visit", a.get("visitDate")), ("Phone", a.get("phone")),
        ("Email", a.get("email")), ("Quantity", a.get("quantity")),
    ], W, 2, blank))
    E.append(Spacer(1, 8))

    # ── 2. The job ────────────────────────────────────────────────────────────────────────────────
    E.append(_section("The job", W))
    E.append(Spacer(1, 4))
    job = _s(a.get("jobType")).lower()
    loc = _s(a.get("location")).lower()
    duty = _s(a.get("duty")).lower()
    left = [_grid([("What is being pulled", a.get("jobType")), ("Where it sits", a.get("location")),
                   ("How often", a.get("duty"))], W * 0.50, 1, blank)]
    right = [
        _checkrow([("Bearing", job == "bearing"), ("Gear", job == "gear"),
                   ("Pulley", job == "pulley")], W * 0.46, blank),
        _checkrow([("Hub / coupling", job == "hub"), ("Sleeve", job == "sleeve"),
                   ("Blind hole", job == "blind-hole")], W * 0.46, blank),
        _checkrow([("One-off", duty == "one-off"), ("Occasional", duty == "occasional"),
                   ("Repeat", duty == "repeat")], W * 0.46, blank),
        _check("Access blocked on two opposing sides", _s(a.get("accessObstructed")) == "Yes", blank),
        _check("Part heavy / awkward to position", _s(a.get("awkwardPosition")) == "Yes", blank),
        _check("No power available on site", _s(a.get("noPower")) == "Yes", blank),
    ]
    two = Table([[left, right]], colWidths=[W * 0.54, W * 0.46])
    two.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.4, HAIR),
    ]))
    E.append(two)
    E.append(Spacer(1, 8))

    # ── 3. Measurements ───────────────────────────────────────────────────────────────────────────
    E.append(_section("Measurements", W))
    E.append(Spacer(1, 4))
    unit = _s(a.get("dimUnit")).lower() or "mm"
    mleft = [
        _grid([("Part outside diameter", a.get("partOd")), ("Shaft diameter", a.get("shaftDia")),
               ("Reach — pulling face to shaft end", a.get("reach")),
               ("Hub / bearing width", a.get("contactLen")),
               ("Shaft end condition", a.get("shaftEndCond"))], W * 0.50, 1, blank),
    ]
    mright = [
        _checkrow([("MM", unit == "mm"), ("INCH", unit == "in")], W * 0.46, blank),
        Spacer(1, 3),
        # These two are the fields people get wrong on paper, so the sheet explains them itself.
        Paragraph("<b>Reach</b> is from the face the jaws pull against to the end of the shaft.", S_SMALL),
        Paragraph("<b>Hub / bearing width</b> is how much of the shaft the part actually grips — "
                  "not the same as reach. Without it the pulling force cannot be worked out.", S_SMALL),
        Spacer(1, 4),
        Paragraph("SKETCH — the part, the shaft, and where the jaws can reach", S_LABEL),
        _sketchbox(W * 0.46, blank, 5),
    ]
    two2 = Table([[mleft, mright]], colWidths=[W * 0.54, W * 0.46])
    two2.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.4, HAIR),
    ]))
    E.append(two2)
    E.append(Spacer(1, 8))

    # ── 4. Fit & known force ──────────────────────────────────────────────────────────────────────
    E.append(_section("How it is fitted, and any known force", W))
    E.append(Spacer(1, 4))
    fit = _s(a.get("fitType")).lower()
    E.append(_grid([("How it is fitted", a.get("fitType")),
                    ("Known pulling force (tons)", a.get("knownTons"))], W, 2, blank))
    E.append(Spacer(1, 3))
    E.append(_checkrow([("Slip / transition", fit == "slip"), ("Press fit", fit == "press"),
                        ("Shrink / heat fit", fit == "shrink"), ("Not known", fit == "unknown")],
                       W, blank))
    E.append(Spacer(1, 8))

    # ── 5. Opportunity & notes ────────────────────────────────────────────────────────────────────
    E.append(_section("Opportunity and application notes", W))
    E.append(Spacer(1, 4))
    E.append(_grid([("Opportunity / timing", a.get("opportunity"))], W, 1, blank))
    E.append(Spacer(1, 3))
    E.append(_notebox(a.get("notes"), W, blank, lines=3))

    # ── 6. Recommendation (filled sheets only) ────────────────────────────────────────────────────
    if not blank:
        block = [Spacer(1, 10), _section("Recommendation", W), Spacer(1, 5)]

        force_source = _s(rec.get("forceSource"))
        design = _num(rec.get("designTons"))
        if force_source and force_source != "none" and design > 0:
            head = ("Pulling force (as supplied by the customer)" if force_source == "stated"
                    else "Estimated pulling force — NOT a measured value")
            block.append(Paragraph(_esc(head), S_LABEL))
            block.append(Paragraph("%.1f t design load" % design, S_REC))
            # A185 clip site — this line is built from user-influenced text and bypasses _field.
            assumption = _clip(rec.get("forceAssumption"), 400)
            if assumption:
                block.append(Paragraph(_esc(assumption), S_BODY))
            block.append(Spacer(1, 6))

        g = rec.get("geometry") if isinstance(rec.get("geometry"), dict) else {}
        if g:
            bits = []
            if _num(g.get("spreadMm")) > 0:
                bits.append("jaw spread &ge; %d mm" % int(_num(g.get("spreadMm"))))
            if _num(g.get("reachMm")) > 0:
                bits.append("reach &ge; %d mm" % int(_num(g.get("reachMm"))))
            if _num(g.get("travelMm")) > 0:
                bits.append("travel &ge; %d mm" % int(_num(g.get("travelMm"))))
            if _num(g.get("jaws")) > 0:
                bits.append("%d-jaw" % int(_num(g.get("jaws"))))
            if bits:
                block.append(Paragraph("TOOL GEOMETRY THIS JOB REQUIRES", S_LABEL))
                block.append(Paragraph(" &middot; ".join(bits), S_REC))
                if _s(g.get("jawReason")):
                    # A185 clip site — free text, bypasses _field.
                    block.append(Paragraph(_esc(_clip("%d-jaw because %s."
                                                      % (int(_num(g.get("jaws"))), _s(g.get("jawReason"))), 400)),
                                           S_BODY))
                for n in (g.get("notes") or [])[:6]:
                    block.append(Paragraph(_esc(_clip(n, 400)), S_BODY))
                block.append(Spacer(1, 6))

        tool = rec.get("tool") if isinstance(rec.get("tool"), dict) else {}
        if _s(tool.get("name")):
            tag = ("Specified by " + _s(prepared_by) if _s(tool.get("source")) == "user" and _s(prepared_by)
                   else "Specified by the requester" if _s(tool.get("source")) == "user"
                   else "System suggestion")
            block.append(Paragraph("RECOMMENDED PULLER &mdash; " + _esc(tag), S_LABEL))
            block.append(Paragraph(_esc(_clip(tool.get("name"), 160)), S_REC))

        alts = [x for x in (rec.get("alternates") or []) if _s(x)]
        if alts:
            block.append(Paragraph("Alternates: " + _esc(_clip(", ".join(_s(x) for x in alts), 400)),
                                   S_SMALL))

        # Each entry is clipped, but the loops are deliberately NOT capped in length (matching
        # bolting_survey_pdf). Every item here is a safety note; truncating the list to keep the file
        # small could drop the one warning that mattered. A long PDF is the cheaper failure, and the
        # per-item _clip is what actually prevents the A173-B1 LayoutError.
        for f in (rec.get("conditionFlags") or []):
            block.append(Spacer(1, 5))
            block.append(_warn("Check this before pulling", _clip(f, 400), W))
        for w in (rec.get("warnings") or []):
            block.append(Spacer(1, 5))
            block.append(_warn("Note", _clip(w, 400), W))

        if rec.get("needsEngineer"):
            block.append(Spacer(1, 5))
            block.append(Paragraph("Needs engineer confirmation — Hi-ESCORP will contact you.",
                                   _st("psEng", 9, 12, ACCENT_RED, bold=True)))
        if _s(prepared_by):
            block.append(Spacer(1, 5))
            block.append(Paragraph("Prepared by " + _esc(prepared_by), S_SMALL))
        E.append(KeepTogether(block))

    E.append(Spacer(1, 8))
    E.append(Paragraph(
        "Pulling force is an estimate unless a tonnage was supplied, and jaw spread, reach and stroke "
        "are stated as requirements — we hold family ratings only, not per-model jaw geometry. Confirm "
        "both against the equipment maker's data before use.", S_SMALL))

    doc.build(E)
    return buf.getvalue()
