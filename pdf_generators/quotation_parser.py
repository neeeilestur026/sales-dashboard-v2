"""Read a Hi-Escorp quotation PDF that carries no embedded /QuoData.

A system-generated quotation embeds its exact source payload, and the importer prefers that. This
module is the fallback for everything else: documents made before that existed, and any PDF that has
been re-saved, merged, printed-to-PDF or passed through a tool that drops custom metadata.

WHY GEOMETRY RATHER THAN TEXT
The document is laid out in columns. `extract_text()` flattens them into one stream, interleaving
"PREPARED FOR" with "SUBJECT" and the item description with the QTY/PRICE figures — which is why a
line-based regex could never separate them, and why the previous parser returned the customer's
address line as the customer name. `extract_words()` keeps x/y per word, so each field can be read
from the region it actually occupies.

Two specifics that a fixed left/right midpoint gets wrong, and this does not:

  * A long description WRAPS PAST THE MIDPOINT. On the band-saw quotation the word "Heavy" sits at
    x0=312 — visually part of the description, but to the right of centre. Splitting at 52% moved it
    into the figures column. Column edges are therefore taken from the item-table header row itself.
  * The numeric columns are RIGHT-ALIGNED, and a value can be much WIDER than its heading: the unit
    price "3,240,216.00" starts at x0=414 while "UNIT PRICE" starts at x0=421. Neither left edges nor
    midpoints-between-centres survive that — both file the price under QTY and the line imports as
    0.00. Each value is matched to the column whose RIGHT edge it shares, which is width-independent.

Everything is best-effort and nothing is guessed: a field that cannot be read confidently comes back
empty and is named in `warnings`, because a wrong value that looks confident is how a bad quotation
reaches a client.
"""

import logging
import re
from io import BytesIO

from .utils import (ph_date_ymd, QUO_SCOPE_INTABLE_HEADING, QUO_SCOPE_ITEM_HEADING_FMT,
                    QUO_HIDDEN_PRICE_NOTE_FMT, QUO_LETTERHEAD_NAME)

logger = logging.getLogger(__name__)

# Section labels are rendered letter-spaced ("P R E P A R E D  F O R"), so every label test runs on a
# whitespace-stripped, upper-cased form.
_PREPARED_FOR = "PREPAREDFOR"
_SUBJECT = "SUBJECT"
_OUR_OFFER = "OUROFFER"

# Anything at or below these ends the item block. SCOPE/VALIDITY/BANK are page-2 sections; the totals
# rows close the table itself.
# Anything starting with one of these ends the item block. The DISCOUNTED totals block opens with
# "Subtotal / Less: Discount / Net", not "Total Amount" — without those three a discounted quotation
# absorbed its own totals into the last item's description.
_ITEM_STOP = ("TOTALAMOUNT", "VAT(12%)", "TOTAL(VATINCLUSIVE)", "SUBTOTAL", "LESS:", "NET(VAT",
              "SCOPEOFSUPPLY", "EXCLUSIONS", "VALIDITY", "BANKDETAILS", "SINCERELYYOURS",
              "AVAILABLEASOPTIONS")

# A205 alternative offers. The banner and the per-option subtotal rows are furniture INSIDE the item
# table, not the end of it — treating the banner as a terminator silently dropped every option.
# The banner AND each option's own subtotal row sit between item rows, so both must be SKIPPED
# rather than treated as the end of the table — option 2's line comes after option 1's subtotal.
# Note "TOTAL(VATEXCL" is the per-option row; "TOTALAMOUNT" in _ITEM_STOP is the document total.
_ALT_SKIP = ("ALTERNATIVEOFFERS", "TOTAL(VATEXCL")
_OPTION_RE = re.compile(r"^OPTION$", re.IGNORECASE)
# The placeholder drawn when a line carries no photo; it is text in the PDF but not part of the item.
_PLACEHOLDER = ("PRODUCTSHOT", "RECOMMENDED")

_MONEY_RE = re.compile(r"^-?[\d,]+(?:\.\d+)?$")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_INDEX_RE = re.compile(r"^\d{1,3}$")


def _flat(s):
    """'P R E P A R E D  F O R' -> 'PREPAREDFOR'. The anchor form for every label test."""
    return re.sub(r"\s+", "", str(s or "")).upper()

# A213 — the scope of supply now prints INSIDE the item table, so the parser has to recognise its
# heading to know the rows below belong to no item. The string is shared with the renderer so the two
# cannot drift; this assertion is the other half of that contract. If the heading were ever renamed
# to something starting with an _ITEM_STOP prefix, the importer would stop reading items at it and
# silently return fewer lines — the failure that is hardest to notice because it looks like a short
# quotation rather than a broken one.
assert not any(_flat(QUO_SCOPE_INTABLE_HEADING).startswith(s) for s in _ITEM_STOP), (
    "QUO_SCOPE_INTABLE_HEADING must not start with an _ITEM_STOP prefix — it would end the item table")

# A240 — the per-item heading, as a matcher. Built from the renderer's own format string so the two
# cannot drift: whatever the renderer prints, this is what recognises it.
_ITEM_SCOPE_HEAD_RE = re.compile(
    "^" + re.escape(_flat(QUO_SCOPE_ITEM_HEADING_FMT)).replace(re.escape("%S"), r"[^\W_]{1,8}"))
assert not any(_flat(QUO_SCOPE_ITEM_HEADING_FMT % "01").startswith(s) for s in _ITEM_STOP), (
    "QUO_SCOPE_ITEM_HEADING_FMT must not start with an _ITEM_STOP prefix — 'SCOPE OF SUPPLY — ITEM "
    "01' would have ended the item table at item 01 and dropped every item after it")
assert _ITEM_SCOPE_HEAD_RE.match(_flat(QUO_SCOPE_ITEM_HEADING_FMT % "07")), (
    "the per-item scope heading matcher no longer matches what the renderer prints")

# A240 — the hidden-price reconciling note is furniture in the item table too, and without this it is
# concatenated onto the LAST item's name on re-import, exactly the way scope bullets were before A213.
# The tail comes from the renderer's own format string so the two cannot drift; the leading span and
# verb are matched loosely because the numbers vary. Requiring the verb AND the tail is what makes a
# false positive on a real description line unreachable in practice.
_HIDDEN_NOTE_RE = re.compile(r"^ITEMS?\d[\dANDTO,]*(?:IS|ARE)"
                             + re.escape(_flat(QUO_HIDDEN_PRICE_NOTE_FMT.split("%s")[-1])))
assert _HIDDEN_NOTE_RE.match(_flat(QUO_HIDDEN_PRICE_NOTE_FMT % ("s", "03 to 12", "are"))), (
    "the hidden-price note matcher no longer matches what the renderer prints (plural)")
assert _HIDDEN_NOTE_RE.match(_flat(QUO_HIDDEN_PRICE_NOTE_FMT % ("", "03", "is"))), (
    "the hidden-price note matcher no longer matches what the renderer prints (singular)")
assert _HIDDEN_NOTE_RE.match(_flat(QUO_HIDDEN_PRICE_NOTE_FMT % ("s", "03, 05 and 09", "are"))), (
    "the hidden-price note matcher no longer matches what the renderer prints (scattered)")

# A235 — PER-ITEM SCOPE IS NOT SEPARATELY RECOVERABLE, and that is a deliberate trade, not an
# oversight. An item's own scope prints with NO heading — repeating "SCOPE OF SUPPLY" under every
# item is noise, and the heading above already names the section once — so this parser has nothing
# to match on and reads those bullets as part of the item's DESCRIPTION.
#
# Benign in practice: they are descriptive lines sitting under a description, so a re-imported
# quotation keeps every word, in the right order, attached to the right item. What is lost is only
# the DISTINCTION between "description" and "scope" on the way back in, which matters solely if
# somebody re-imports a quotation and then edits it — the scope reappears in the description box
# rather than the scope dialog.
#
# The alternative was a machine-readable marker on every per-item block, which would either be
# visible to the client (a heading nobody wants) or invisible-but-fragile (a zero-width sentinel
# that any PDF round-trip could eat). The embedded JSON payload is the real recovery path anyway:
# _embed_quo_data stores the exact source, item scopes included, and the importer prefers it.
# This text-geometry path is the fallback for documents that never had one.


def _num(s):
    """'3,240,216.00' -> 3240216.0. Returns None when the token is not a number."""
    t = str(s or "").strip().replace(",", "")
    if not t or not _MONEY_RE.match(str(s or "").strip()):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _rows(page, tol=3):
    """Words grouped into visual lines, each sorted left→right. `tol` in points."""
    out = {}
    try:
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    except Exception as exc:                                    # a damaged page must not kill the file
        logger.warning("extract_words failed on a page: %s", exc)
        return []
    for w in words:
        out.setdefault(round(float(w["top"]) / tol), []).append(w)
    return [sorted(out[k], key=lambda w: float(w["x0"])) for k in sorted(out)]


def _text(words):
    return " ".join(str(w["text"]) for w in words).strip()


def _columns(row):
    """Column RIGHT EDGES from the item-table header row, or None if this is not that row.

    Right edges, not centres or left edges. The value columns are right-aligned, so a value wider
    than its heading starts further left than the heading does: on the band-saw quotation the unit
    price "3,240,216.00" begins at x0=414 while "UNIT PRICE" begins at x0=421. Bucketing on left
    edges — or on midpoints between centres, which was the first attempt here — files that price
    under QTY and the line imports as 0.00. Every value shares its column's RIGHT edge, whatever its
    width, so that is the stable anchor."""
    flat = _flat(_text(row))
    if "QTY" not in flat or "AMOUNT" not in flat or "DESCRIPTION" not in flat:
        return None
    right_edge, qty_left = {}, None
    for w in row:
        t = _flat(w["text"])
        if t == "QTY":
            right_edge["qty"] = float(w["x1"])
            qty_left = float(w["x0"])
        elif t == "PRICE":                       # of "UNIT PRICE" — carries the column's right edge
            right_edge["price"] = float(w["x1"])
        elif t == "AMOUNT":
            right_edge["amount"] = float(w["x1"])
    if not all(k in right_edge for k in ("qty", "price", "amount")) or qty_left is None:
        return None
    right_edge["desc_x1_max"] = qty_left - 4      # description ends before the QTY column starts
    return right_edge


def _split_row(row, cols):
    """(description words, qty words, price words, amount words) for one item row."""
    d, q, p, a = [], [], [], []
    buckets = (("qty", q), ("price", p), ("amount", a))
    for w in row:
        if float(w["x1"]) < cols["desc_x1_max"]:
            d.append(w)
            continue
        # nearest column by right edge — width-independent
        name, _dist = min(((n, abs(float(w["x1"]) - cols[n])) for n, _b in buckets),
                          key=lambda t: t[1])
        dict(buckets)[name].append(w)
    return d, q, p, a


def parse_quotation_pdf(pdf_bytes):
    """bytes -> (data|None, warnings, confidence).

    `data` mirrors the shape the importer already consumes. `confidence` maps field -> bool so the UI
    can mark what the parser was unsure of. A field it could not read is EMPTY, never guessed.
    """
    warnings = []
    confidence = {}
    try:
        import pdfplumber
    except Exception:
        return None, ["pdfplumber is not installed on the server."], {}

    if not pdf_bytes:
        return None, ["The file is empty."], {}

    pages = []
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            if getattr(pdf, "pages", None) is None or not len(pdf.pages):
                return None, ["That PDF has no pages."], {}
            for pg in pdf.pages:
                pages.append((float(pg.width or 595), _rows(pg)))
    except Exception as exc:
        # Encrypted, truncated, or not a PDF at all. One clear sentence beats a stack trace.
        logger.warning("quotation parse could not open the file: %s", exc)
        return None, ["Could not read that PDF — it may be encrypted, damaged, or not a PDF."], {}

    if not any(rows for _, rows in pages):
        return None, ["No text could be read from that PDF. If it is a scan, it needs OCR first "
                      "— or type the quotation in manually."], {}

    page_w, rows = pages[0]
    flats = [_flat(_text(r)) for r in rows]

    # ── the header's two boxes ────────────────────────────────────────────────────────────────
    # Boundary from the SUBJECT label's own x0 when present (exact), else the page midpoint.
    boundary = page_w * 0.52
    for r in rows:
        for w in r:
            if _flat(w["text"]).startswith("S") and _flat(_text(r)).find(_SUBJECT) >= 0 \
                    and float(w["x0"]) > page_w * 0.4:
                boundary = min(boundary, float(w["x0"]) - 6)
                break
    def left(r):
        return " ".join(str(w["text"]) for w in r if float(w["x0"]) < boundary).strip()
    def right(r):
        return " ".join(str(w["text"]) for w in r if float(w["x0"]) >= boundary).strip()

    # quotation no — the right-column line under "QUOTATION", which carries no label at all
    quotation_no = ""
    claimed_rows = set()                      # rows already owned by a field, so a wrap-join cannot eat them
    for i, r in enumerate(rows):
        if _flat(right(r)) == "QUOTATION":
            claimed_rows.add(i)
            for j in range(i + 1, min(i + 3, len(rows))):
                cand = right(rows[j]).strip()
                if cand and _flat(cand) != "QUOTATION":
                    quotation_no = cand
                    claimed_rows.add(j)
                    break
            break

    _KNOWN_LABELS = ("DATE", "RFQNO", "PLANTSITE", "SALESPERSON", "QUOTATION")

    def label_value(name):
        """Right-column 'Date August 06, 2026' -> 'August 06, 2026'.

        A long value WRAPS, and because the column is right-aligned the overflow lands on the row
        ABOVE the label: on the Snap-on quotation "RFQ1688 -" sits at x0=503 one row above
        "RFQ No. AKLPRQ/01004886". Taking only the labelled row silently truncates the client's own
        reference. The preceding row is folded in only when it is a bare continuation — non-empty,
        carrying no label of its own — so an adjacent field can never be swallowed."""
        key = _flat(name)
        for i, r in enumerate(rows):
            rt = right(r)
            if not _flat(rt).startswith(key):
                continue
            val = re.sub(r"^\s*" + r"\s*".join(re.escape(c) for c in name) + r"\s*",
                         "", rt, flags=re.IGNORECASE).strip()
            val = val.lstrip(".:").strip()
            # Walk back to the nearest NON-EMPTY right-column line. The rows between are not blank —
            # they carry the company address in the LEFT column — so checking only rows[i-1] finds
            # nothing and the wrap is lost.
            for j in range(i - 1, max(-1, i - 5), -1):
                if j in claimed_rows:
                    break                     # that line belongs to another field — never absorb it
                prev = right(rows[j]).strip()
                if not prev:
                    continue
                pf = _flat(prev)
                if not any(pf.startswith(k) for k in _KNOWN_LABELS):
                    val = (prev + " " + val).strip()
                break
            # "RFQ No. —" means there isn't one.
            return "" if val in ("—", "-", "–", "N/A") else val
        return ""

    date_raw = label_value("Date")
    rfq_no = label_value("RFQ No.") or label_value("RFQ No")
    plant_site = label_value("Plant Site")

    # subject — right column, between the SUBJECT label and the item table
    subject_lines = []
    seen_subject = False
    for i, r in enumerate(rows):
        f = _flat(right(r))
        if not seen_subject:
            if _SUBJECT in f and len(f) <= len(_SUBJECT) + 2:
                seen_subject = True
            continue
        if _columns(r) or any(s in _flat(_text(r)) for s in _ITEM_STOP):
            break
        val = right(r).strip()
        if val:
            subject_lines.append(val)
    subject = " ".join(subject_lines).strip()

    # customer + address — left column, between PREPARED FOR and Attention:
    customer, address_lines = "", []
    seen_prepared = False
    for r in rows:
        lt = left(r).strip()
        f = _flat(lt)
        if not seen_prepared:
            if f.startswith(_PREPARED_FOR):
                seen_prepared = True
            continue
        if f.startswith("ATTENTION:") or _EMAIL_RE.search(lt) or _columns(r):
            break
        if not lt:
            continue
        if not customer:
            customer = lt
        else:
            address_lines.append(lt)
    # A customer name that wrapped onto a second line: an all-caps continuation with no digits and no
    # comma is part of the name, not the street address.
    if customer and address_lines:
        nxt = address_lines[0]
        if nxt.isupper() and not re.search(r"\d", nxt) and "," not in nxt:
            customer = (customer + " " + nxt).strip()
            address_lines = address_lines[1:]

    attention, designation, email = "", "", ""
    for r in rows:
        lt = left(r).strip()
        if _flat(lt).startswith("ATTENTION:"):
            body = lt.split(":", 1)[1].strip()
            if "·" in body:
                attention, designation = [s.strip() for s in body.split("·", 1)]
            else:
                attention = body
        m = _EMAIL_RE.search(lt)
        if m and not email:
            email = m.group(0)

    # ── items ─────────────────────────────────────────────────────────────────────────────────
    items, cols, in_items = [], None, False
    in_scope = False                                            # A213
    printed_ex_vat = None
    for pi, (_w, prows) in enumerate(pages):
        for r in prows:
            if cols is None:
                c = _columns(r)
                if c:
                    cols, in_items = c, True
                    continue
                continue
            # A213 — the table header is REDRAWN at the top of every continuation page (repeatRows=1).
            # Reaching here means cols is already set, so without this the header is parsed as a body
            # row: its text lands in the last item's description, and because _num("QTY") is None the
            # UOM column silently becomes the literal "QTY". Latent before scope moved into the table;
            # routine now that a one-item quotation can span two pages.
            # NOTE it does NOT clear in_scope: a long scope block spans the page break, so the
            # header is an interruption in the middle of the region, not the end of it. Clearing it
            # here let every bullet after the first page break resume being absorbed into item 01.
            if _columns(r):
                continue
            flat_all = _flat(_text(r))
            # A213 — the scope of supply prints INSIDE the item table now, under the first item's
            # description. Its rows belong to NO item: without this state machine every bullet falls
            # into the `elif items:` branch below and is concatenated onto item 01's name, turning a
            # 40-bullet scope into a ~1,500-character product name on re-import. A missing item is
            # visible; a poisoned name is not.
            # A REGION, not a single line: skipping only the heading still absorbs every bullet.
            if in_items and flat_all.startswith(_flat(QUO_SCOPE_INTABLE_HEADING)):
                in_scope = True
                continue
            # A240 — a PER-ITEM block opens the same region. This closes the asymmetry A235 left
            # behind: per-item bullets carried no heading, so nothing marked where they began and
            # every one of them fell into the `elif items:` branch and was concatenated onto that
            # item's product name on re-import. The region ends the same way the document-level one
            # does, at the next item line — which is where the next item's own heading sits anyway.
            if in_items and _ITEM_SCOPE_HEAD_RE.match(flat_all):
                in_scope = True
                continue
            # A240 — the hidden-price note. A REGION, not a single line, because a long span of item
            # numbers wraps and only the first line carries the phrase that identifies it.
            if in_items and _HIDDEN_NOTE_RE.match(flat_all):
                in_scope = True
                continue
            # A240 — the PAGE letterhead, on every page after the first. The repeated TABLE header
            # two branches up was already skipped; this was not, so on any quotation whose item table
            # spans a page the letterhead was concatenated onto the name of the item above the break
            # ("PACKAGE LINE 8 H.O ESTUR CORPORATION"). One line, not a region: the address lines
            # under it carry no words the item table would claim.
            if in_items and flat_all.startswith(_flat(QUO_LETTERHEAD_NAME)):
                continue
            if in_scope:
                # The block ends at the next item line — nothing separates them — or at any of the
                # ordinary terminators, which are then handled by the tests below as usual.
                first = r[0] if r else None
                ftxt = str(first["text"]) if first else ""
                _d, _q, _p, _a = _split_row(r, cols)
                next_item = bool(first and (_INDEX_RE.match(ftxt) or _OPTION_RE.match(ftxt))
                                 and (_q or _p))
                if next_item or any(flat_all.startswith(s) for s in _ITEM_STOP + _ALT_SKIP):
                    in_scope = False
                else:
                    continue
            if in_items and any(flat_all.startswith(x) for x in _ALT_SKIP):
                continue                                        # furniture inside the table
            if in_items and any(flat_all.startswith(s) for s in _ITEM_STOP):
                in_items = False
            if not in_items:
                # totals live just past the table
                if flat_all.startswith("TOTALAMOUNT") and printed_ex_vat is None:
                    nums = [_num(w["text"]) for w in r]
                    nums = [n for n in nums if n is not None]
                    if nums:
                        printed_ex_vat = nums[-1]
                continue
            d, q, p, a = _split_row(r, cols)
            first = r[0] if r else None
            ftxt = str(first["text"]) if first else ""
            # "01 …" is an ordinary line; "OPTION 2 …" is one alternative of a pick-one group (A205).
            opt_no = ""
            if first and _OPTION_RE.match(ftxt) and len(d) > 1:
                m_opt = re.match(r"^\d{1,3}$", str(d[1]["text"]))
                if m_opt:
                    opt_no = m_opt.group(0)
            is_start = bool(first and (_INDEX_RE.match(ftxt) or opt_no) and (q or p))
            if is_start:
                skip = 2 if opt_no else 1                       # drop "OPTION n" or the index
                desc = " ".join(str(w["text"]) for w in d[skip:]
                                if _flat(w["text"]) not in ("PRODUCT", "SHOT")).strip()
                items.append({
                    "itemNo": "", "itemName": desc, "description": desc,
                    "qty": _num(_text(q)) or 0.0,
                    "price": next((n for n in (_num(w["text"]) for w in p) if n is not None), 0.0),
                    "uom": "", "origItemNo": "", "origItemName": "", "_offer": False,
                    "optionNo": opt_no,
                })
            elif items:
                it = items[-1]
                dtxt = " ".join(str(w["text"]) for w in d).strip()
                # the UOM sits under QTY on the line after the item starts
                utxt = _text(q).strip()
                if utxt and not it["uom"] and _num(utxt) is None:
                    it["uom"] = utxt
                if not dtxt or _flat(dtxt) in _PLACEHOLDER:
                    continue                                    # "product shot" is chrome, not text
                if _flat(dtxt).startswith("MODELNO"):
                    it["itemNo"] = re.sub(r"^\s*Model\s*No\.?\s*", "", dtxt, flags=re.IGNORECASE).strip()
                elif _flat(dtxt) == _OUR_OFFER:
                    # A86 pairing: everything ABOVE this divider is what the CLIENT asked for, and
                    # everything below is what we are offering instead. Folding the two together
                    # made the offer read as one long line that repeated the request. 
                    it["origItemName"] = it["description"]
                    it["description"] = ""
                    it["itemName"] = ""
                    it["_offer"] = True
                else:
                    it["description"] = (it["description"] + " " + dtxt).strip()
                    it["itemName"] = it["description"]
        if items and not in_items:
            break                                   # the table lives on one page; do not re-scan

    for it in items:
        if not it["itemNo"]:
            it["itemNo"] = "N/A"
        # an item with a divider but nothing after it: keep the request as the description rather
        # than returning a blank line
        if not it["itemName"] and it.get("origItemName"):
            it["itemName"] = it["description"] = it["origItemName"]
            it["origItemName"] = ""
        it.pop("_offer", None)

    # ── VAT + the money cross-check ───────────────────────────────────────────────────────────
    all_flat = " ".join(_flat(_text(r)) for _w, rr in pages for r in rr)
    vat_option = "inclusive" if "TOTAL(VATINCLUSIVE)" in all_flat else "exclusive"

    computed = sum((it["qty"] or 0) * (it["price"] or 0) for it in items)
    if items and printed_ex_vat is not None and abs(computed - printed_ex_vat) > 0.5:
        warnings.append(
            "The items add up to PHP {:,.2f} but the document's total is PHP {:,.2f} — check the "
            "lines before saving.".format(computed, printed_ex_vat))

    # ── report honestly ───────────────────────────────────────────────────────────────────────
    # The document prints "August 06, 2026"; the editor and the stored record want "2026-08-06".
    # ph_date_ymd is the same Manila-correct helper the generator writes dates with, so an imported
    # date round-trips instead of drifting a day.
    date = ph_date_ymd(date_raw, default="") if date_raw else ""
    if date_raw and not date:
        warnings.append("The date %r could not be understood — please set it." % date_raw[:32])
    fields = {
        "customer": customer, "quotationNo": quotation_no, "date": date,
        "subject": subject, "attention": attention,
    }
    labels = {"customer": "Customer name", "quotationNo": "Quotation No", "date": "Date",
              "subject": "Subject", "attention": "Attention"}
    for k, v in fields.items():
        confidence[k] = bool(v)
        if not v:
            warnings.append("%s could not be read — please fill it in." % labels[k])
    confidence["items"] = bool(items)
    if not items:
        warnings.append("No item table was recognized — add the items manually.")

    data = {
        "customer": customer,
        "date": date,
        "quotationNo": quotation_no,
        "vatOption": vat_option,
        "items": items,
        "doc": {
            "attention": attention,
            "designation": designation,
            "email": email,
            "subject": subject,
            "rfqNo": rfq_no,
            "plantSite": plant_site,
            "address": ", ".join(address_lines),
        },
    }
    return data, warnings, confidence
