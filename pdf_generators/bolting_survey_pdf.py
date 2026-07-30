"""Bolting Application Survey PDF renderer (Addendum 177).

ONE generator, TWO modes:

  blank=True   the printable hard copy — every label with a ruled blank beside it, empty checkboxes,
               and no recommendation block.
  blank=False  the same layout with the answers filled in, plus a Recommendation block naming the
               target torque, where it came from, any condition caveats, and the chosen tool labelled
               "System suggestion" or "Specified by <name>".

Sharing the layout is the point: the sheet a rep fills by hand and the sheet the system prints can
never drift out of step, because there is only one description of it.

Every value goes through `_s()` first. Numeric-looking values reach these generators as ints/floats
often enough that `.strip()` on a raw field has crashed a route before (A82/A135), and this one is
fed straight from a browser form.
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
    """Cap free text so it can never outgrow its cell. A survey field lives in a one-row
    table, and a ReportLab table row cannot split across pages — so an uncapped 10,000-char
    note raises LayoutError and the route 500s instead of printing. Truncation is visible,
    which is the point: the rep sees the cut in the PDF."""
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


S_LABEL = _st("bsLabel", 7, 8.6, LABEL, bold=True)
S_VALUE = _st("bsValue", 9, 11, INK)
S_BODY = _st("bsBody", 8.4, 11, INK)
S_SMALL = _st("bsSmall", 8, 11, LABEL)
S_H = _st("bsH", 9.5, 12, colors.white, bold=True)
S_TITLE = _st("bsTitle", 16, 18, ACCENT, bold=True)
S_SUB = _st("bsSub", 8.5, 11, LABEL)
S_REC = _st("bsRec", 10, 13.5, INK, bold=True)


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
    """A checkbox + label. Drawn with Courier brackets rather than U+2610/U+2612: the box glyphs are
    absent from Helvetica and fell back to a literal "n" on the page."""
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
            logger.warning("bolting_survey_pdf: logo could not be drawn", exc_info=True)
    left.append(Paragraph(_esc(COMPANY), _st("co", 10, 13, INK, bold=True)))
    right = [Paragraph("BOLTING APPLICATION SURVEY", S_TITLE),
             Paragraph("Hard copy — fill in and return to your Hi-ESCORP contact." if blank
                       else "Completed survey with the recommended tool.", S_SUB)]
    t = Table([[left, right]], colWidths=[width * 0.42, width * 0.58])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 1.2, ACCENT),
    ]))
    return t


def build_bolting_survey_pdf_bytes(answers=None, recommendation=None, blank=False, prepared_by=""):
    """Render the survey and return its bytes. `blank=True` gives the printable empty form."""
    a = answers if isinstance(answers, dict) else {}
    rec = recommendation if isinstance(recommendation, dict) else {}

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm,
                            title="Bolting Application Survey", author=COMPANY)
    W = doc.width
    el = [_header(W, blank), Spacer(1, 8)]

    # ── who / what / when ────────────────────────────────────────────────────
    el += [_section("Request", W), Spacer(1, 2),
           _grid([("Request by", a.get("requestBy")), ("Request date", a.get("requestDate")),
                  ("Industry", a.get("industry")), ("Customer name", a.get("customer")),
                  ("Application", a.get("application")), ("Contact / title", a.get("contact")),
                  ("Date of visit", a.get("visitDate")), ("Phone / fax", a.get("phone")),
                  ("Install date", a.get("installDate")), ("Email", a.get("email"))],
                 W, 2, blank),
           Spacer(1, 8)]

    # ── technical data + position ────────────────────────────────────────────
    unit = _s(a.get("unit")).lower() or "metric"
    tech = _grid([("Quantity", a.get("quantity")),
                  ("Bolt diameter", a.get("boltSize")),
                  ("Bolt T.P.I.", a.get("tpi")),
                  ("Bolt grade", a.get("grade")),
                  ("Bolt coating", a.get("coating")),
                  ("Gasket type", a.get("gasket")),
                  ("Operating temp.", (_s(a.get("tempValue")) + ("  °" + _s(a.get("tempUnit"))
                                       if _s(a.get("tempValue")) else "")))],
                 W * 0.52, 1, blank)
    pos = _s(a.get("position")).lower()
    right = [Paragraph("BOLT APPLICATION POSITION", S_LABEL), Spacer(1, 3),
             _checkrow([("Top-Side", pos == "top-side"), ("Vertical", pos == "vertical"),
                        ("Inverted", pos == "inverted")], W * 0.44, blank),
             Spacer(1, 4),
             _check("Limited Clearance / Limited Radius", bool(a.get("limitedClearance")), blank),
             Spacer(1, 8),
             Paragraph("SPECIFY DIMENSIONS", S_LABEL), Spacer(1, 3),
             _checkrow([("INCH", unit == "inch"), ("METRIC", unit == "metric")], W * 0.44, blank),
             Spacer(1, 3),
             _grid([("A", a.get("dimA")), ("B", a.get("dimB")),
                    ("C", a.get("dimC")), ("D", a.get("dimD"))], W * 0.44, 2, blank),
             _grid([("Distance to closure", a.get("distClosure"))], W * 0.44, 1, blank)]
    two = Table([[tech, right]], colWidths=[W * 0.54, W * 0.46])
    two.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("LEFTPADDING", (1, 0), (1, 0), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.4, HAIR),
    ]))
    el += [_section("Technical data", W), Spacer(1, 4), two, Spacer(1, 8)]

    # ── known bolting values + lubrication + opportunity ────────────────────
    known = _grid([("Load (lbs / kN)", (_s(a.get("loadValue")) +
                                        ("  " + _s(a.get("loadUnit")) if _s(a.get("loadValue")) else ""))),
                   ("Stretch-bolt length (mm / in.)", a.get("stretch")),
                   ("Turn of nut (preload / degrees)", a.get("turnOfNut")),
                   ("Torque (ft·lbs / Nm / kgm)", (_s(a.get("torqueValue")) +
                                                   ("  " + _s(a.get("torqueUnit")).upper()
                                                    if _s(a.get("torqueValue")) else ""))),
                   ("% of yield (psi / N·mm²)", a.get("pctYield"))],
                  W * 0.52, 1, blank)
    opp = _s(a.get("opportunity")).lower()
    rside = [Paragraph("CURRENT LUBRICATION", S_LABEL), Spacer(1, 3),
             _grid([("Type", a.get("lubeType")), ("Brand", a.get("lubeBrand"))], W * 0.44, 2, blank),
             Spacer(1, 6),
             Paragraph("OPPORTUNITY", S_LABEL), Spacer(1, 3),
             _checkrow([("Sell", opp == "sell"), ("Demo", opp == "demo")], W * 0.44, blank)]
    two2 = Table([[known, rside]], colWidths=[W * 0.54, W * 0.46])
    two2.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("LEFTPADDING", (1, 0), (1, 0), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.4, HAIR),
    ]))
    el += [_section("Known bolting values", W), Spacer(1, 4), two2, Spacer(1, 8)]

    # ── notes ────────────────────────────────────────────────────────────────
    el += [_section("Additional application notes", W), Spacer(1, 4),
           _notebox(a.get("notes"), W, blank, lines=3)]

    # ── the recommendation (filled only) ─────────────────────────────────────
    if not blank:
        el += [Spacer(1, 10)]
        block = [_section("Recommendation", W), Spacer(1, 5)]

        target = _num(rec.get("targetNm"))
        src = _s(rec.get("torqueSource"))
        if target > 0:
            ftlb = int(round(target / 1.35582))
            where = ("from the torque specified on this survey" if src == "stated"
                     else "from our reference torque chart" if src == "chart" else "")
            block += [Paragraph("Target torque: {:,} Nm  (~{:,} ft-lb)".format(
                int(round(target)), ftlb), S_REC)]
            if where:
                block += [Paragraph(_esc(where.capitalize()) + ".", S_SMALL)]
            if _s(rec.get("chartNote")):
                block += [Spacer(1, 2), Paragraph(_esc(rec.get("chartNote")), S_SMALL)]
        else:
            block += [Paragraph("No torque figure is given on this sheet.", S_REC),
                      Paragraph("The answers above are recorded in full; the engineer will specify the "
                                "torque.", S_SMALL)]

        tool = rec.get("tool") if isinstance(rec.get("tool"), dict) else None
        if tool and _s(tool.get("name")):
            tag = ("Specified by " + _s(prepared_by) if _s(tool.get("source")) == "user" and _s(prepared_by)
                   else "Specified by the requester" if _s(tool.get("source")) == "user"
                   else "System suggestion")
            block += [Spacer(1, 7),
                      Paragraph("Recommended tool", S_LABEL),
                      Paragraph(_esc(_clip(tool.get("name"), 160)), S_REC),
                      Paragraph("(" + _esc(tag) + ")", S_SMALL)]
        alts = [x for x in (rec.get("alternates") or []) if _s(x)]
        if alts:
            block += [Spacer(1, 3),
                      Paragraph("Also covers this torque: "
                                + _esc(_clip(", ".join(_s(x) for x in alts), 400)), S_SMALL)]

        for f in (rec.get("conditionFlags") or []):
            if _s(f):
                block += [Spacer(1, 5), _warn("Check before tightening", _clip(f, 400), W)]
        for w in (rec.get("warnings") or []):
            if _s(w):
                block += [Spacer(1, 5), _warn("Note", _clip(w, 400), W)]
        if rec.get("needsEngineer"):
            block += [Spacer(1, 6),
                      Paragraph("Needs engineer confirmation — Hi-ESCORP will contact you.",
                                _st("cf", 9.5, 12.5, ACCENT_RED, bold=True))]
        # Keep the whole recommendation together — split across a page break it reads as two
        # unrelated fragments, and this is the part an engineer acts on.
        el += [KeepTogether(block)]

        if _s(prepared_by):
            el += [Spacer(1, 8), Paragraph("Prepared by " + _esc(prepared_by), S_SMALL)]

    el += [Spacer(1, 10),
           Paragraph("Torque values are safety-critical. Confirm against the equipment maker's bolting "
                     "specification before use.", S_SMALL)]

    doc.build(el)
    return buf.getvalue()
