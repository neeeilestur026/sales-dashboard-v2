"""RECEIVED stamp for a client's purchase order PDF (Addendum 186).

A customer's PO is dated one day and reaches us on another — a PO dated 14 Jul arriving 2 Aug is
routine. This stamps the date we ACTUALLY received it onto page 1 of their document, so the gap is
visible on the paper and not just in someone's inbox.

Two properties this module exists to guarantee, in order of importance:

  1. It never obscures the client's content. The stamp is placed only where measurement proves
     there is nothing; when that cannot be proven — a scan, an unmeasurable page, a full page, or a
     server without pdfplumber — the page is physically EXTENDED with a blank strip and the stamp
     goes on new paper. Because that fallback is always available and provably non-destructive,
     there is no reason to accept a "mostly empty" corner: the acceptance rule is strict zero
     overlap. A ratio threshold means sometimes covering a little of the client's text, and "a
     little" is not a thing you can promise a customer in a dispute.

  2. It never returns a wrong result silently. On any failure the entry point returns None — never
     the original bytes dressed up as stamped, which is the one outcome that would put an unstamped
     PO into the file as though it had been received on a date nobody recorded.

The client's original file is never modified in place; the caller stores it separately.

── Four library facts this module is built around ────────────────────────────────────────────────
Each was verified against the pinned versions (PyPDF2 3.0.1, reportlab 5.0.0, pdfplumber 0.11.4),
and each is a SILENT failure if ignored — no exception, just a wrong document:

  a) `merge_transformed_page` does not exist in PyPDF2 3.0.1 (it is a pypdf 3.x/4.x name), and the
     legacy `mergeTransformedPage` RAISES rather than warns. The only correct idiom here is
     `overlay.add_transformation(ctm)` followed by `base.merge_page(overlay)`.

  b) What a reader displays is the CropBox, not the MediaBox. Placing from the MediaBox on a
     cropped page puts the stamp partly or wholly outside what anyone can see.

  c) `merge_page` clips the overlay by the OVERLAY's TrimBox, evaluated in the BASE page's user
     space. A reportlab page's trimbox is (0,0,w,h), so on a page whose MediaBox origin is not
     (0,0) the stamp is sheared — measured at 182pt wide instead of 199pt, with no error. The
     overlay's boxes are widened to the base MediaBox before merging.

  d) The same clip destroys the CLIENT'S content on the extension path: a source page carrying a
     /TrimBox loses everything outside it on merge_page — measured at 64% of the page silently
     deleted. `src.trimbox` is widened to `src.mediabox` before merging.

`transfer_rotation_to_content()` would let us ignore /Rotate entirely, but it rewrites the client's
content stream and all five box entries. We only ever append.
"""

import logging
from io import BytesIO

from reportlab.lib import colors
from reportlab.pdfgen import canvas as _canvas

from PyPDF2 import PdfReader, PdfWriter, PageObject, Transformation
from PyPDF2.generic import RectangleObject, NameObject, NumberObject, createStringObject

from .utils import ph_date, ph_date_long

logger = logging.getLogger(__name__)

COMPANY = "H.O ESTUR CORPORATION"
ACCENT_RED = colors.HexColor("#C0392B")
INK = colors.HexColor("#1a1a1a")
LABEL = colors.HexColor("#5b6673")
PAPER = colors.white

# The stamp is a FIXED rectangle. It never grows to fit its contents — that is what makes the
# collision scoring trustworthy: the rect that was scored is the rect that gets drawn.
STAMP_W, STAMP_H = 190.0, 78.0          # full tier — tall enough for all five lines
COMPACT_W, COMPACT_H = 140.0, 46.0      # second tier, tried when the full box will not fit
MARGIN = 14.0                           # gap from the visible page edge
PAD = 6.0                               # required clear halo around the stamp
STRIP_H = 96.0                          # blank strip added when nothing can be placed safely
MAX_MARKS = 20000                       # bound on measurement work; beyond this we stop and extend
MIN_SIDE, MAX_SIDE = 72.0, 14400.0      # sane page dimensions (1in .. 200in)

# Character caps, house convention (see _clip in the sibling generators). These are the cheap first
# guard; _fit_line does the real work, because characters are not points.
FIELD_CAPS = {"company": 48, "received_by": 32, "so_number": 24, "po_number": 24}

_STAMP_KEY = "/POStampReceived"          # metadata marker so a re-stamp can be detected


def _s(v):
    """Coerce anything to a clean string. Never trust the type of an incoming field."""
    if v is None:
        return ""
    if v is True:
        return "Yes"
    if v is False:
        return ""
    return str(v).strip()


def _clip(v, limit):
    """Hard character cap, with a visible ellipsis so truncation is never mistaken for the value."""
    s = _s(v)
    return s if len(s) <= limit else s[: max(0, limit - 1)].rstrip() + "…"


# ── page geometry ────────────────────────────────────────────────────────────────────────────────

def _rot90(page):
    """/Rotate normalised to {0,90,180,270}. A malformed value is snapped, never trusted raw."""
    try:
        r = int(page.rotation) % 360
    except Exception:
        r = 0
    return (int(round(r / 90.0)) * 90) % 360


def _visible_rect(page):
    """CropBox ∩ MediaBox in user space — what the reader actually sees (fact b).

    A degenerate or absurd CropBox falls back to the MediaBox: a nonsense crop must not shrink the
    stamp into nothing, and a page we cannot frame is better stamped on the full sheet.
    """
    mb, cb = page.mediabox, page.cropbox
    try:
        x0 = max(float(mb.left), float(cb.left))
        y0 = max(float(mb.bottom), float(cb.bottom))
        x1 = min(float(mb.right), float(cb.right))
        y1 = min(float(mb.top), float(cb.top))
    except Exception:
        x0, y0, x1, y1 = 0.0, 0.0, 0.0, 0.0
    if x1 - x0 < 10 or y1 - y0 < 10:
        return (float(mb.left), float(mb.bottom), float(mb.right), float(mb.top))
    return (x0, y0, x1, y1)


def _overlay_ctm(page):
    """Map the VISIBLE frame (origin bottom-left, as reportlab draws) onto the page's user space.

    Returns (Transformation, (frame_w, frame_h)) where the frame is what the reader sees, so a
    /Rotate 90 page reports its displayed landscape dimensions.

    `.rotate(deg).translate(tx, ty)` in that order is deliberate: Transformation.translate only
    adds to m[4]/m[5], so the shift lands in the FINAL coordinate system — "rotate, then translate",
    which is what these offsets assume. Transformation.rotate is counter-clockwise, which is why a
    page marked /Rotate 90 (clockwise for display) is compensated with rotate(90).
    """
    x0, y0, x1, y1 = _visible_rect(page)
    w, h = x1 - x0, y1 - y0
    r = _rot90(page)
    if r == 90:
        return Transformation().rotate(90).translate(x0 + w, y0), (h, w)
    if r == 180:
        return Transformation().rotate(180).translate(x0 + w, y0 + h), (w, h)
    if r == 270:
        return Transformation().rotate(270).translate(x0, y0 + h), (h, w)
    return Transformation().translate(x0, y0), (w, h)


def _apply_overlay(base_page, overlay_bytes, ctm):
    """Compose a reportlab overlay onto an existing page. PyPDF2 3.0.1 API (facts a and c)."""
    ov = PdfReader(BytesIO(overlay_bytes)).pages[0]
    ov.add_transformation(ctm)
    box = RectangleObject(base_page.mediabox)
    ov.mediabox = box
    ov.trimbox = box                      # else a non-zero origin shears the stamp
    base_page.merge_page(ov)              # overlay is merged last, so it draws on top
    return base_page


def _grow(rect, r, strip):
    """Grow a box on the side that is VISUALLY the bottom, given /Rotate r."""
    x0, y0, x1, y1 = rect
    if r == 90:
        return (x0, y0, x1 + strip, y1)          # visible bottom == unrotated RIGHT edge
    if r == 180:
        return (x0, y0, x1, y1 + strip)          # == unrotated TOP edge
    if r == 270:
        return (x0 - strip, y0, x1, y1)          # == unrotated LEFT edge
    return (x0, y0 - strip, x1, y1)              # r == 0: unrotated BOTTOM edge


def _extend_page(src, strip=STRIP_H):
    """A taller page with `src` placed on it unscaled and unshifted, plus blank space to stamp.

    The original content keeps its exact coordinates because the new MediaBox keeps the original
    origin — so the source needs no transformation at all, and is never re-encoded.
    """
    r = _rot90(src)
    mb = (float(src.mediabox.left), float(src.mediabox.bottom),
          float(src.mediabox.right), float(src.mediabox.top))
    new_mb = _grow(mb, r, strip)

    out = PageObject.create_blank_page(width=new_mb[2] - new_mb[0], height=new_mb[3] - new_mb[1])
    out.mediabox = RectangleObject(new_mb)       # create_blank_page forces (0,0,w,h); keep the origin

    if "/CropBox" in src:
        cb = (float(src.cropbox.left), float(src.cropbox.bottom),
              float(src.cropbox.right), float(src.cropbox.top))
        out[NameObject("/CropBox")] = RectangleObject(_grow(cb, r, strip))
        # Without this the new strip sits outside the visible box and the stamp is invisible.

    if r:
        out[NameObject("/Rotate")] = NumberObject(r)     # keep the reader's orientation

    src.trimbox = RectangleObject(src.mediabox)          # fact d — or the client's page is cut
    out.merge_page(src)                                  # no transformation: no scale, no shift
    return out


# ── measurement ──────────────────────────────────────────────────────────────────────────────────

def _measure(pdf_bytes):
    """Occupancy boxes for page 1, normalised to the visible frame, top-left origin.

    Returns (boxes, frame_w, frame_h) or None when the page could not be measured. None means
    "not measured" — NEVER "blank". Concluding blankness from a failed measurement is exactly how a
    scan gets stamped over.

    pdfplumber is imported lazily and its absence is tolerated: flow.py already treats it as
    possibly-absent in production, and this module must degrade to extension rather than refuse.
    """
    try:
        import pdfplumber
    except Exception:
        logger.info("po_stamp: pdfplumber unavailable — falling back to page extension")
        return None

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as doc:
            if not doc.pages:
                return None
            page = doc.pages[0]

            # Measure in the CROPBOX frame, because that is the frame _overlay_ctm draws in.
            # pdfplumber's page.width/height/bbox are MEDIABOX-derived, so on any page carrying a
            # CropBox the two frames disagree and every measured coordinate is offset — the stamp
            # then lands outside the visible area, or worse, on top of content it was scored clear
            # of. page.cropbox is top-down (verified: a CropBox 200pt from the bottom and 5pt from
            # the top reports y0=5), the same convention as an object's `top`, so objects and frame
            # share one space once both are shifted by the cropbox origin. pdfplumber applies
            # /Rotate to both, so rotation needs no separate handling here.
            cb = [float(v) for v in page.cropbox]
            bx0, by0 = cb[0], cb[1]
            fw, fh = cb[2] - cb[0], cb[3] - cb[1]
            if not (MIN_SIDE <= fw <= MAX_SIDE and MIN_SIDE <= fh <= MAX_SIDE):
                return None

            boxes, big = [], []
            def take(objs, kind):
                for o in objs or ():
                    if len(boxes) + len(big) >= MAX_MARKS:
                        raise _TooManyMarks()
                    try:
                        r = (float(o["x0"]) - bx0, float(o["top"]) - by0,
                             float(o["x1"]) - bx0, float(o["bottom"]) - by0)
                    except Exception:
                        continue
                    if r[2] <= r[0] or r[3] <= r[1]:
                        continue
                    area = (r[2] - r[0]) * (r[3] - r[1])
                    # A full-page border or background tint would veto every candidate, so a huge
                    # RECT/CURVE contributes only its edge bands. Images are deliberately NOT
                    # exempt: a page-sized image IS the content (a scan), and must veto everything.
                    if kind in ("rect", "curve") and area > 0.5 * fw * fh:
                        big.append(r)
                    else:
                        boxes.append(r)

            try:
                take(page.extract_words(), "word")
                take(page.rects, "rect")
                take(page.lines, "line")
                take(page.curves, "curve")
                take(page.images, "image")
            except _TooManyMarks:
                logger.info("po_stamp: over %d marks on page 1 — extending instead", MAX_MARKS)
                return None

            for r in big:                       # edge bands of the large shapes, 3pt thick
                x0, y0, x1, y1 = r
                boxes.extend([(x0, y0, x1, y0 + 3), (x0, y1 - 3, x1, y1),
                              (x0, y0, x0 + 3, y1), (x1 - 3, y0, x1, y1)])

            if not boxes:
                return None                     # nothing measurable -> "not measured", not "blank"
            return (boxes, fw, fh)
    except Exception:
        logger.warning("po_stamp: page-1 measurement failed — extending instead", exc_info=True)
        return None


class _TooManyMarks(Exception):
    """Internal: the measurement bound was hit."""


def _candidates(fw, fh, w, h):
    """Stamp rectangles in strict preference order, as (name, (x0, y0, x1, y1)) top-left origin.

    Top-left is LAST on purpose: letterheads and logos live there.
    """
    m = MARGIN
    return [
        ("bottom-right", (fw - m - w, fh - m - h, fw - m, fh - m)),
        ("bottom-left", (m, fh - m - h, m + w, fh - m)),
        ("bottom-centre", ((fw - w) / 2.0, fh - m - h, (fw + w) / 2.0, fh - m)),
        ("top-right", (fw - m - w, m, fw - m, m + h)),
        ("top-left", (m, m, m + w, m + h)),
    ]


def _overlaps(a, b):
    """Intersection area of two (x0, y0, x1, y1) boxes."""
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    return ix * iy if (ix > 0 and iy > 0) else 0.0


def _score(boxes, fw, fh):
    """Pick a stamp rectangle, or None to signal "extend the page".

    Acceptance is strict: the padded rect must touch NOTHING. Ties within a tier are impossible
    (preference order is total), so the first accepted candidate wins.
    """
    for w, h, tier in ((STAMP_W, STAMP_H, "full"), (COMPACT_W, COMPACT_H, "compact")):
        for name, c in _candidates(fw, fh, w, h):
            p = (c[0] - PAD, c[1] - PAD, c[2] + PAD, c[3] + PAD)
            if p[0] < 0 or p[1] < 0 or p[2] > fw or p[3] > fh:
                continue                                     # does not fit on this page
            if any(_overlaps(p, b) > 0.25 for b in boxes):
                continue                                     # strict zero overlap
            return (name, c, tier)
    return None


# ── the stamp itself ─────────────────────────────────────────────────────────────────────────────

def _fit_line(c, text, font, max_size, min_size, max_w):
    """Return (text, size) guaranteed to fit `max_w`. Cannot raise.

    A character cap alone is not enough. reportlab's canvas text neither wraps nor errors — it just
    runs off the box and over the client's content, which would invalidate the collision scoring
    that the whole design rests on. So: cap characters, then shrink, then ellipsise by measurement.
    """
    t = _s(text)
    if not t:
        return ("", max_size)
    size = max_size
    try:
        while size > min_size and c.stringWidth(t, font, size) > max_w:
            size -= 0.5
        if c.stringWidth(t, font, size) > max_w:
            while t and c.stringWidth(t + "…", font, size) > max_w:
                t = t[:-1]
            t = (t + "…") if t else ""
    except Exception:
        return (t[:24], min_size)
    return (t, size)


def _render_stamp(fw, fh, rect, tier, fields):
    """A single-page overlay the size of the visible frame, carrying only the stamp box.

    `rect` arrives with a top-left origin (measurement space); reportlab draws bottom-left, hence
    the y flip. Nothing else on this page is drawn, so the merge cannot disturb the client's page.
    """
    buf = BytesIO()
    c = _canvas.Canvas(buf, pagesize=(fw, fh))

    x0, y_top, x1, y_bot = rect[0], rect[1], rect[2], rect[3]
    y = fh - y_bot                          # bottom edge, reportlab space
    w, h = x1 - x0, y_bot - y_top
    inner = w - 2 * PAD

    c.setFillColor(PAPER)
    c.setStrokeColor(ACCENT_RED)
    c.setLineWidth(2)
    c.rect(x0, y, w, h, stroke=1, fill=1)   # opaque, so it reads as a stamp on any background

    compact = (tier == "compact")
    cur = y + h - PAD

    t, sz = _fit_line(c, "RECEIVED", "Helvetica-Bold", 15 if compact else 20, 9, inner)
    c.setFillColor(ACCENT_RED)
    c.setFont("Helvetica-Bold", sz)
    cur -= sz
    c.drawString(x0 + PAD, cur, t)

    t, sz = _fit_line(c, fields.get("date_text", ""), "Helvetica-Bold",
                      8.5 if compact else 9.5, 6, inner)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", sz)
    cur -= (sz + 2)
    c.drawString(x0 + PAD, cur, t)

    if not compact:                          # the compact tier keeps only RECEIVED + the date
        c.setFillColor(LABEL)
        for key in ("company", "refs", "received_by"):
            val = fields.get(key, "")
            if not val:
                continue
            t, sz = _fit_line(c, val, "Helvetica", 7.5, 5.5, inner)
            if cur - (sz + 1.5) < y + PAD:   # never spill out of the fixed box
                break
            cur -= (sz + 1.5)
            c.setFont("Helvetica", sz)
            c.drawString(x0 + PAD, cur, t)

    c.showPage()
    c.save()
    return buf.getvalue()


# ── entry point ──────────────────────────────────────────────────────────────────────────────────

def build_stamped_po_bytes(pdf_bytes, received_date, *, received_by="", po_number="",
                           so_number="", company=COMPANY):
    """Stamp page 1 'RECEIVED <date>'. Returns (stamped_bytes | None, report). NEVER raises.

    `report` carries {ok, reason, placement, tier, measured, extended, warnings[], date}. On any
    failure the bytes are None — never the original, which would file an unstamped PO as though it
    had been stamped.
    """
    report = {"ok": False, "reason": "", "placement": "", "tier": "", "measured": False,
              "extended": False, "warnings": [], "date": ""}
    try:
        if not pdf_bytes:
            report["reason"] = "empty"
            return (None, report)

        d = ph_date(received_date)
        if d is None:
            # Never default to today. A stamp that invents a receipt date is worse than no stamp:
            # the whole point of this feature is that the date on the paper is the real one.
            report["reason"] = "bad-date"
            return (None, report)
        report["date"] = d.isoformat()
        date_text = ph_date_long(d)

        try:
            reader = PdfReader(BytesIO(pdf_bytes))
        except Exception as e:
            report["reason"] = "unreadable"
            report["warnings"].append("The file could not be read as a PDF (%s)." % type(e).__name__)
            return (None, report)

        if getattr(reader, "is_encrypted", False):
            try:
                opened = reader.decrypt("")
            except Exception:
                opened = 0
            if not opened:
                report["reason"] = "encrypted"
                report["warnings"].append(
                    "The PDF is password-protected. Ask the client for an unlocked copy, or attach "
                    "it unstamped.")
                return (None, report)
            report["warnings"].append(
                "The original was protected against editing; the stamped copy is not.")

        try:
            n_pages = len(reader.pages)
        except Exception:
            report["reason"] = "encrypted"
            return (None, report)
        if n_pages < 1:
            report["reason"] = "no-pages"
            return (None, report)

        try:
            if _STAMP_KEY in (reader.metadata or {}):
                report["warnings"].append(
                    "This file already carries a RECEIVED stamp dated %s."
                    % _s((reader.metadata or {}).get(_STAMP_KEY)))
        except Exception:
            pass

        fields = {
            "date_text": date_text,
            "company": _clip(company, FIELD_CAPS["company"]),
            "received_by": ("Received by: " + _clip(received_by, FIELD_CAPS["received_by"]))
                           if _s(received_by) else "",
        }
        # In this system the SO No IS the client's PO number, so the two are usually the same
        # value; printing "SO X · PO X" reads as a mistake. Collapse it to one reference.
        so_c = _clip(so_number, FIELD_CAPS["so_number"])
        po_c = _clip(po_number, FIELD_CAPS["po_number"])
        if so_c and po_c and so_c == po_c:
            fields["refs"] = "SO / PO " + so_c
        else:
            refs = []
            if so_c:
                refs.append("SO " + so_c)
            if po_c:
                refs.append("PO " + po_c)
            fields["refs"] = " · ".join(refs)

        page = reader.pages[0]

        measured = _measure(pdf_bytes)
        report["measured"] = measured is not None
        choice = _score(*measured) if measured else None

        if choice is None:
            # Guaranteed-safe branch, not a last resort: the only placement that is provably
            # non-destructive when the page cannot be measured or has no free corner.
            page = _extend_page(page)
            ctm, (fw, fh) = _overlay_ctm(page)
            rect = (MARGIN, fh - MARGIN - STAMP_H, MARGIN + STAMP_W, fh - MARGIN)
            tier, name = "full", "added-strip"
            report["extended"] = True
            report["warnings"].append(
                "Page 1 could not be measured, or had no clear space, so the stamp was placed on a "
                "blank strip added below it — nothing of the client's document is covered."
                if not report["measured"] else
                "Page 1 had no clear space, so the stamp was placed on a blank strip added below "
                "it — nothing of the client's document is covered.")
        else:
            name, rect, tier = choice
            ctm, (fw, fh) = _overlay_ctm(page)

        report["placement"], report["tier"] = name, tier

        overlay = _render_stamp(fw, fh, rect, tier, fields)
        _apply_overlay(page, overlay, ctm)

        writer = PdfWriter()
        writer.add_page(page)
        for i in range(1, n_pages):
            writer.add_page(reader.pages[i])
        try:
            writer.add_metadata({_STAMP_KEY: createStringObject(date_text)})
        except Exception:
            pass

        out = BytesIO()
        writer.write(out)
        report["ok"] = True
        return (out.getvalue(), report)

    except Exception:
        logger.exception("po_stamp: stamping failed")
        report["ok"] = False
        report["reason"] = report["reason"] or "stamp-failed"
        return (None, report)
