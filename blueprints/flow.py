"""Flow blueprint — PDF generation for the new Accounting Process Flow.

Produces quotation and purchase-order PDFs whose layout is IDENTICAL to the legacy
generators, by reusing the legacy renderers (`QuotationDocTemplate` via
`flow_quotation_pdf`, and `PODocTemplate`). No Google Apps Script / Excel dependency:
the flow already holds final prices; Drive-save is handled separately by FlowAPI.gs.
"""

import base64
import json
import logging
import os
import re
from io import BytesIO
from datetime import datetime

import requests as http_requests
from flask import Blueprint, request, jsonify, make_response
from PyPDF2 import PdfReader, PdfWriter

from pdf_generators.flow_quotation_pdf import build_quotation_pdf_bytes, build_summary_table
from pdf_generators.quotation_parser import parse_quotation_pdf
from pdf_generators.po_pdf import PODocTemplate
from pdf_generators.flow_pr_pdf import build_pr_pdf_bytes
from pdf_generators.payment_request_pdf import build_payment_request_pdf
from pdf_generators.utils import sanitize_filename, ph_date_ymd, ph_date_long
from blueprints.session_auth import validate_session, display_name_for, INTERNAL_SHARED_SECRET

logger = logging.getLogger(__name__)

flow_bp = Blueprint("flow_bp", __name__)

FLOW_APPS_SCRIPT_URL = os.environ.get("FLOW_APPS_SCRIPT_URL", "")

CURRENCY_SYMBOLS = {
    "USD": "$", "PHP": "₱", "EUR": "€", "JPY": "¥", "GBP": "£",
    "AUD": "A$", "CAD": "C$", "SGD": "S$", "AED": "AED ",
}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _s(v):
    """Coerce any value to a string (renderers call .strip()/format on text fields)."""
    return "" if v is None else str(v)


def _bullets(v):
    """Parse Scope/Exclusions bullets into [{"text", "bold"}].

    Accepts a textarea string (one bullet per line) or an already-split list, so the
    payload works from the dialog and from a script. A leading bullet/dash the user
    pasted is stripped; a line wrapped in **asterisks** is flagged bold."""
    if not v:
        return []
    # A number-looking cell comes back from Sheets as a number, not a string — coerce
    # anything that isn't a string or a sequence rather than crashing on list().
    lines = (v.splitlines() if isinstance(v, str)
             else list(v) if isinstance(v, (list, tuple)) else _s(v).splitlines())
    out = []
    for ln in lines:
        if isinstance(ln, dict):
            text, bold = _s(ln.get("text")).strip(), bool(ln.get("bold"))
        else:
            text, bold = _s(ln).strip(), False
        # Detect **bold** FIRST — the bullet-stripper below eats '*', which would
        # otherwise swallow the opening marker and leave a stray '**' at the end.
        # A173: strip the pasted bullet glyph FIRST. Doing it after the bold test meant a line like
        # '**Note** includes freight' failed endswith('**'), then the stripper (whose character class
        # contains \*) ate the opening marker and the PDF printed a literal '**'.
        text = re.sub(r"^[\u2022\u00b7\-\u2013\u2014]+\s*", "", text).strip()
        if not bold and text.startswith("**") and text.endswith("**") and len(text) > 4:
            text, bold = text[2:-2].strip(), True
        elif text.startswith("*") and not text.startswith("**"):
            text = text[1:].strip()
        if not text:
            continue
        out.append({"text": text, "bold": bold})
    return out


def _options(v):
    """Parse Options into [{"text", "price"}] from 'description | price' lines.

    Split on the LAST '|' so a description may contain one."""
    if not v:
        return []
    lines = (v.splitlines() if isinstance(v, str)
             else list(v) if isinstance(v, (list, tuple)) else _s(v).splitlines())
    out = []
    for ln in lines:
        if isinstance(ln, dict):
            text, price = _s(ln.get("text")).strip(), _s(ln.get("price")).strip()
        else:
            raw = _s(ln).strip()
            text, price = (raw.rsplit("|", 1) + [""])[:2] if "|" in raw else (raw, "")
            text, price = text.strip(), price.strip()
        text = re.sub(r"^[•·\-\*–—]+\s*", "", text).strip()
        if text:
            out.append({"text": text, "price": price})
    return out


def _decode_data_url(s):
    """Decode a base64 data URL or bare base64 string into bytes (or None)."""
    if not s:
        return None
    try:
        if "," in s and s.strip().lower().startswith("data:"):
            s = s.split(",", 1)[1]
        return base64.b64decode(s)
    except Exception as e:
        logger.warning("Could not decode image/brochure data: %s", e)
        return None


def _merge_brochures(pdf_bytes, brochures):
    """Append optional brochure PDFs (list of base64 strings) to the generated PDF."""
    blobs = [_decode_data_url(b) for b in (brochures or [])]
    blobs = [b for b in blobs if b]
    if not blobs:
        return pdf_bytes
    try:
        writer = PdfWriter()
        for pg in PdfReader(BytesIO(pdf_bytes)).pages:
            writer.add_page(pg)
        for blob in blobs:
            try:
                for pg in PdfReader(BytesIO(blob)).pages:
                    writer.add_page(pg)
            except Exception as e:
                logger.warning("Skipping unreadable brochure: %s", e)
        out = BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception as e:
        logger.warning("Brochure merge failed: %s", e)
        return pdf_bytes


def _pdf_response(pdf_bytes, filename):
    resp = make_response(pdf_bytes)
    resp.headers["Content-Type"] = "application/pdf"
    resp.headers["Content-Disposition"] = f'inline; filename="{filename}"'
    return resp


def _embed_quo_data(pdf_bytes, payload):
    """Embed the source quotation payload as base64 JSON in the PDF's /QuoData metadata.

    Lets a later import of a system-generated quotation PDF recover the EXACT data
    (customer/date/items/doc) instead of re-parsing the rendered tables. Best-effort:
    on any failure the original bytes are returned unchanged. Per-item images are stripped
    (too large / not needed for the editable re-import)."""
    try:
        items = []
        for it in (payload.get("items") or []):
            items.append({
                "itemNo": it.get("itemNo"),
                "itemName": it.get("itemName"),
                "qty": it.get("qty"),
                "price": it.get("price"),
                "description": it.get("description"),
                # A147: preserve the requested-vs-offered pairing (A86) + unit across a re-import.
                "origItemNo": it.get("origItemNo"),
                "origItemName": it.get("origItemName"),
                "uom": it.get("uom"),
            })
        data = {
            "customer": payload.get("customer"),
            "date": payload.get("date"),
            "quotationNo": payload.get("quotationNo"),
            "vatOption": payload.get("vatOption", "inclusive"),
            # Without this a re-imported PDF silently loses its discount and re-renders at full price.
            "discountPct": payload.get("discountPct"),
            "items": items,
            "doc": payload.get("doc") or {},
        }
        blob = base64.b64encode(json.dumps(data).encode("utf-8")).decode("ascii")
        reader = PdfReader(BytesIO(pdf_bytes))
        writer = PdfWriter()
        for pg in reader.pages:
            writer.add_page(pg)
        if reader.metadata:
            writer.add_metadata({k: v for k, v in reader.metadata.items()})
        writer.add_metadata({"/QuoData": blob})
        out = BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception as e:
        logger.warning("Embedding /QuoData failed: %s", e)
        return pdf_bytes


def _read_quo_data(pdf_bytes):
    """Return the embedded /QuoData dict from a system-generated quotation PDF, or None."""
    try:
        meta = PdfReader(BytesIO(pdf_bytes)).metadata or {}
        blob = meta.get("/QuoData")
        if not blob:
            return None
        return json.loads(base64.b64decode(str(blob)).decode("utf-8"))
    except Exception as e:
        logger.warning("Reading /QuoData failed: %s", e)
        return None


@flow_bp.route("/flow/quotation-pdf", methods=["POST"])
def quotation_pdf():
    """Render a flow quotation as a branded PDF (identical layout to the legacy generator)."""
    data = request.get_json(force=True, silent=True) or {}
    raw_items = data.get("items") or []
    if not raw_items:
        return jsonify({"success": False, "message": "No items to generate."}), 400

    doc = data.get("doc") or {}
    desc_mode = (data.get("descMode") or doc.get("descMode") or "short").strip().lower()

    # A179: normalise the date ONCE, before it is used twice — printed on the document (long form,
    # below) and embedded in the /QuoData metadata that a re-import reads back. The stored value is a
    # Manila-midnight timestamp, so the embedded copy has to be a plain Manila-correct date rather
    # than an ISO string, or admin-import-quotation cannot populate its date field from it.
    data["date"] = ph_date_ymd(data.get("date"), default=_s(data.get("date")))

    # A205 — alternative offers. A blank option_no is an ordinary charged line; lines sharing a
    # non-blank one are mutually exclusive, so only the recommended group counts toward the total.
    # This is the THIRD total engine (after FlowAPI.gs and flow-api.js) and the only one whose output
    # is printed on the document the client receives — so getting it wrong here is the version of
    # this bug that actually reaches them.
    items, images, total_ex_vat = [], {}, 0.0
    for idx, it in enumerate(raw_items, start=1):
        # A173: a non-dict entry used to raise AttributeError HERE, outside the try that wraps the
        # build — so the caller got Flask's HTML 500 page instead of this route's JSON envelope.
        if not isinstance(it, dict):
            logger.warning("quotation_pdf: skipping non-dict item at position %s", idx)
            continue
        qty, price = _num(it.get("qty")), _num(it.get("price"))
        items.append({
            "item_no": idx,
            "product_name": _s(it.get("itemName") or it.get("itemNo")),
            "product_code": _s(it.get("itemNo")),
            "quantity": qty,
            "total_amount": price,
            "total_unit_price": qty * price,
            "description": _s(it.get("description")),
            "uom": _s(it.get("uom")),   # A147: carry the real unit (from the PR) so it isn't forced to "pc(s)"
            # requested-vs-offered (A86): the client's ORIGINAL code/description when admin
            # replaced them with the supplier's own during sourcing
            "orig_code": _s(it.get("origItemNo")),
            "orig_name": _s(it.get("origItemName")),
            "option_no": _s(it.get("optionNo")).strip(),   # A205
        })
        img = _decode_data_url(it.get("imageDataUrl"))
        if img:
            images[idx] = img

    client_details = {
        "client_name": _s(data.get("customer")),
        "client_address": _s(doc.get("address")),
        "attention": _s(doc.get("attention")),
        "designation": _s(doc.get("designation")),
        "email": _s(doc.get("email")),
        "subject": _s(doc.get("subject")),
        "reference_no": _s(data.get("quotationNo")),
        "reference_rfq_no": _s(doc.get("rfqNo")),
        "plant_site": _s(doc.get("plantSite")),   # A145: plant-site destination carried from the PR
        # A179: the renderer draws this exactly as given, so the long form is produced here.
        # Manila-correct: the stored value is a Manila-midnight timestamp, a day earlier in UTC.
        "quotation_date": ph_date_long(data.get("date"), default=_s(data.get("date"))),
        "signature_name": _s(doc.get("sigName")),
        "signature_designation": _s(doc.get("sigDesignation")),
        "signature_viber": _s(doc.get("sigViber")),
        "signature_mobile": _s(doc.get("sigMobile")),
        "signature_email": _s(doc.get("sigEmail")),
    }
    terms = {
        "validity": _s(doc.get("validity")),
        "delivery": _s(doc.get("delivery")),
        "payment": _s(doc.get("payment")),
        "warranty": _s(doc.get("warranty")) or "1 year warranty against factory defect",
    }
    # A205: resolve the recommendation the same way both other engines do — an explicit choice when
    # it names a real group, otherwise the CHEAPEST. Never the sum.
    _groups: dict[str, float] = {}
    for _it in items:
        _k = _it.get("option_no") or ""
        if _k:
            _groups[_k] = _groups.get(_k, 0.0) + _num(_it.get("total_unit_price"))
    _rec = _s(data.get("recommendedOption")).strip()
    if _groups and _rec not in _groups:
        _rec = min(_groups, key=lambda k: _groups[k])
    if not _groups:
        _rec = ""
    total_ex_vat = sum(_num(i.get("total_unit_price")) for i in items
                       if not i.get("option_no") or i.get("option_no") == _rec)

    summary = build_summary_table(total_ex_vat, data.get("vatOption", "inclusive"),
                                  _num(data.get("discountPct")))

    try:
        pdf_bytes = build_quotation_pdf_bytes(items, images, client_details, terms,
                                              summary, desc_mode=desc_mode, note=_s(doc.get("note")),
                                              scope=_bullets(doc.get("scope")),
                                              exclusions=_bullets(doc.get("exclusions")),
                                              options=_options(doc.get("options")),
                                              recommended_option=_rec)
        pdf_bytes = _merge_brochures(pdf_bytes, data.get("brochures"))
        pdf_bytes = _embed_quo_data(pdf_bytes, data)
    except Exception as e:
        logger.exception("Flow quotation PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    fname = f"Quotation_{sanitize_filename(data.get('quotationNo', 'NoRef'))}.pdf"
    return _pdf_response(pdf_bytes, fname)


@flow_bp.route("/flow/po-pdf", methods=["POST"])
def po_pdf():
    """Render a flow purchase order as a branded PDF (identical layout to the legacy generator)."""
    data = request.get_json(force=True, silent=True) or {}
    raw_items = data.get("items") or []
    if not raw_items:
        return jsonify({"success": False, "message": "No items to generate."}), 400

    doc = data.get("doc") or {}
    currency = (data.get("currency") or "PHP").strip()
    currency_symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
    description_type = (doc.get("descriptionType") or "short").strip().lower()

    items = []
    for idx, it in enumerate(raw_items, start=1):
        qty, price = _num(it.get("qty")), _num(it.get("price"))
        items.append({
            "item_no": idx,
            "item_code": _s(it.get("itemNo")),
            "item_description": _s(it.get("itemName")),
            "quantity": qty,
            "unit_price": price,
            "total_amount": qty * price,
        })

    # A147: pass the raw YYYY-MM-DD through so po_pdf does the single, correct formatting. The old code
    # pre-formatted to "January 15, 2026", then po_pdf re-parsed it with strict "%Y-%m-%d" → ValueError →
    # datetime.now(), which printed TODAY's date on every back-dated / later-regenerated PO.
    raw_date = _s(data.get("date"))

    client_details = {
        "vendor_name": _s(data.get("supplier")),
        "vendor_address": _s(doc.get("vendorAddress")),
        "vendor_contact_person": _s(doc.get("vendorContact")),
        "vendor_email": _s(doc.get("vendorEmail")),
        "vendor_tin": _s(doc.get("vendorTin")),
        "payment_terms": _s(doc.get("paymentTerms")),
        # A179: po_pdf prints this one raw, directly under a long-form PO Date — match it.
        "date_needed": ph_date_long(doc.get("dateNeeded"), default=_s(doc.get("dateNeeded"))),
        "po_number": _s(data.get("poNo")),
        # A179: normalised but kept as YYYY-MM-DD — po_pdf parses this one strictly.
        "po_date": ph_date_ymd(raw_date, default=raw_date),
        "invoice_contact_person": _s(doc.get("invoiceContact")),
        "invoice_email": _s(doc.get("invoiceEmail")),
        "reference_no": _s(doc.get("referenceNo")) or _s(data.get("soNo")),
        "currency": currency,
        "currency_symbol": currency_symbol,
        "description_type": description_type,
    }

    try:
        buffer = BytesIO()
        po_doc = PODocTemplate(
            buffer, client_details=client_details, items=items,
            items_per_page=10 if description_type == "short" else 3,
            currency_symbol=currency_symbol,
        )
        if description_type == "long":
            po_doc.repeat_vendor_terms = True
        po_doc.build_pdf()
        pdf_bytes = _merge_brochures(buffer.getvalue(), data.get("brochures"))
    except Exception as e:
        logger.exception("Flow PO PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    fname = (f"Purchase_Order_{sanitize_filename(data.get('supplier', 'Vendor'))}_"
             f"{sanitize_filename(data.get('poNo', 'NoPO'))}.pdf")
    return _pdf_response(pdf_bytes, fname)


@flow_bp.route("/flow/pr-pdf", methods=["POST"])
def pr_pdf():
    """Render a flow pricing/purchase request as a branded PDF (identical layout to the legacy PR generator)."""
    data = request.get_json(force=True, silent=True) or {}
    raw_items = data.get("items") or []
    if not raw_items:
        return jsonify({"success": False, "message": "No items to generate."}), 400

    doc = data.get("doc") or {}
    desc_mode = (data.get("descMode") or doc.get("descMode") or "short").strip().lower()

    items = []
    for idx, it in enumerate(raw_items, start=1):
        items.append({
            # Item No. is the SEQUENCE (1, 2, 3…) like the reference form + the quotation;
            # the inventory item number belongs in Model / Part No.
            "item_no": str(idx),
            "item_description": _s(it.get("itemName")),
            "model_no": _s(it.get("modelNo") or it.get("itemNo")),
            "quantity": _s(it.get("qty")),
            "unit_of_measure": _s(it.get("uom")),
            "item_remarks": _s(it.get("remarks")),
        })

    pr_details = {
        "company_name": _s(doc.get("companyName") or data.get("customer")),
        "company_address": _s(doc.get("companyAddress")),
        "contact_person": _s(doc.get("contactPerson")),
        "contact_email": _s(doc.get("contactEmail")),
        "contact_phone": _s(doc.get("contactPhone")),
        "designation": _s(doc.get("designation")),
        # A179: pr_pdf formats these itself — give it a Manila-correct plain date so it
        # cannot render the day before off an ISO timestamp.
        "pr_date": ph_date_ymd(data.get("date"), default=_s(data.get("date"))),
        "date_needed": ph_date_ymd(doc.get("dateNeeded"), default=_s(doc.get("dateNeeded"))),
        "urgency": _s(doc.get("urgency")),
        "reference_number": _s(doc.get("referenceNumber") or data.get("prNo")),
        "pr_number_client": _s(doc.get("prNumberClient")),
        "prepared_by_name": _s(doc.get("preparedByName") or data.get("requestedBy")),
        "prepared_by_position": _s(doc.get("preparedByPosition")),
    }

    try:
        pdf_bytes = build_pr_pdf_bytes(pr_details, items, desc_mode=desc_mode)
    except Exception as e:
        logger.exception("Flow PR PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    fname = f"Purchase_Request_{sanitize_filename(data.get('prNo', 'NoRef'))}.pdf"
    return _pdf_response(pdf_bytes, fname)


@flow_bp.route("/flow/bolting-survey-pdf", methods=["GET", "POST"])
def bolting_survey_pdf():
    """A177 — the Bolting Application Survey, from ONE generator in two modes.

    GET  ?blank=1  → the printable empty hard copy (a plain link/window.open is enough).
    POST           → the filled survey + its recommendation block.

    Sharing the generator is deliberate: the sheet a rep fills by hand and the sheet the system
    prints are described in one place, so they cannot drift apart.
    """
    from pdf_generators.bolting_survey_pdf import build_bolting_survey_pdf_bytes

    blank = request.method == "GET" or _s(request.args.get("blank")) in ("1", "true", "yes")
    data = request.get_json(silent=True) or {}
    answers = data.get("answers") if isinstance(data.get("answers"), dict) else {}
    rec = data.get("recommendation") if isinstance(data.get("recommendation"), dict) else {}
    prepared_by = _s(data.get("preparedBy"))

    try:
        pdf_bytes = build_bolting_survey_pdf_bytes(answers=answers, recommendation=rec,
                                                   blank=blank, prepared_by=prepared_by)
    except Exception as e:
        logger.exception("Bolting survey PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    who = answers.get("customer") if not blank else ""
    stem = "Bolting_Survey_BLANK" if blank else f"Bolting_Survey_{sanitize_filename(who or 'Survey')}"
    return _pdf_response(pdf_bytes, f"{stem}.pdf")


@flow_bp.route("/flow/puller-survey-pdf", methods=["GET", "POST"])
def puller_survey_pdf():
    """A185 — the Hydraulic Puller Application Survey, same two modes from one generator.

    GET  ?blank=1  → the printable empty hard copy.
    POST           → the filled survey + its recommendation block.
    """
    from pdf_generators.puller_survey_pdf import build_puller_survey_pdf_bytes

    blank = request.method == "GET" or _s(request.args.get("blank")) in ("1", "true", "yes")
    data = request.get_json(silent=True) or {}
    answers = data.get("answers") if isinstance(data.get("answers"), dict) else {}
    rec = data.get("recommendation") if isinstance(data.get("recommendation"), dict) else {}
    prepared_by = _s(data.get("preparedBy"))

    try:
        pdf_bytes = build_puller_survey_pdf_bytes(answers=answers, recommendation=rec,
                                                  blank=blank, prepared_by=prepared_by)
    except Exception as e:
        logger.exception("Puller survey PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    who = answers.get("customer") if not blank else ""
    stem = "Puller_Survey_BLANK" if blank else f"Puller_Survey_{sanitize_filename(who or 'Survey')}"
    return _pdf_response(pdf_bytes, f"{stem}.pdf")


@flow_bp.route("/flow/payment-request-pdf", methods=["POST"])
def payment_request_pdf():
    """Render a flow Payment Request (PRF) using the legacy generator — identical output."""
    data = request.get_json(silent=True) or {}
    details = {
        # A179: payment_request_pdf formats these — hand it Manila-correct plain dates.
        "request_date": ph_date_ymd(data.get("requestDate") or data.get("date"),
                                    default=_s(data.get("requestDate") or data.get("date"))),
        "pr_number": _s(data.get("prNo")),
        "requested_by": _s(data.get("requestedBy")),
        "department": _s(data.get("department")),
        "purpose": _s(data.get("purpose")),
        "priority": _s(data.get("priority")),
        "payee_name": _s(data.get("payee") or data.get("payeeName") or data.get("supplier")),
        "payee_type": _s(data.get("payeeType")),
        "bank_name": _s(data.get("bankName")),
        "bank_branch": _s(data.get("bankBranch")),
        "account_name": _s(data.get("accountName")),
        "account_number": _s(data.get("accountNumber")),
        "payment_method": _s(data.get("paymentMethod")),
        "currency": _s(data.get("currency")) or "PHP",
        "amount": _s(data.get("amount")),
        "due_date": ph_date_ymd(data.get("dueDate"), default=_s(data.get("dueDate"))),
        "remarks": _s(data.get("remarks")),
        # A180: which slice of the PO this is, plus the payable snapshot it was measured against.
        # The renderer prints nothing unless po_total > 0, so the legacy /payment-request/ route —
        # which builds its details from a fixed key list and never sends these — is unaffected.
        "payment_portion": _s(data.get("paymentPortion")),
        "po_total": _s(data.get("poTotal")),
        "po_paid_before": _s(data.get("poPaidBefore")),
    }
    try:
        buffer = BytesIO()
        build_payment_request_pdf(buffer, details, supporting_docs=None)
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()
    except Exception as e:
        logger.exception("Flow payment-request PDF failed")
        return jsonify({"success": False, "message": f"PDF error: {e}"}), 500

    fname = f"Payment_Request_{sanitize_filename(data.get('prNo', 'NoRef'))}.pdf"
    return _pdf_response(pdf_bytes, fname)


# ══════════════════════════════════════════════════════════════════════════════
#  SECURED MUTATIONS  (A158)
# ══════════════════════════════════════════════════════════════════════════════
# Approvals, payments, deletions and pricing used to be enforced by a role string the
# browser supplied — anyone with the /exec URL could post actorRole:'director' and
# approve or pay anything. Those actions now come through here instead: the session
# token is validated against Code.gs, the caller's REAL role is read from the Users
# sheet, and only then is the request forwarded to FlowAPI with a shared secret it
# checks. The role and actor name the browser sent are discarded, not trusted.
#
# Reads are deliberately NOT routed here — they stay direct and cached. This pass
# locks down writes.

# Mirrors _SECURED in FlowAPI.gs. Kept as a list the client also fetches (/flow/secured-actions)
# so the two can't silently drift apart.
SECURED_ACTIONS = [
    "approveQuotation", "rejectQuotation", "approvePO", "rejectPO",
    "approvePaymentRequest", "rejectPaymentRequest", "markPaymentRequestPaid",
    "setMgmtPricing", "rejectMgmtPricing", "verifyReturnToSales",
    "deleteQuotation", "deleteSalesOrder", "deletePurchaseOrder", "deletePaymentRequest",
    "deleteAPEntry", "updateAPAging", "recordCollection", "correctCollection",
    "voidCollection", "voidInvoice",
    # A190 — must stay in step with _SECURED in FlowAPI.gs and FLOW_SECURED_ACTIONS in flow-api.js.
    "approveWeeklyItinerary", "rejectWeeklyItinerary",
    # A193 — bulk Drive filing. previewDriveMigration stays out: it is read-only.
    "seedClientAliases", "runDriveMigration", "buildDriveSkeleton",
    # A194 run-it-all wrappers + the folder setup call. previewDriveMigration,
    # previewDriveMigrationReport and verifyDriveIntegrity stay out: all three are read-only.
    "buildDriveSkeletonAll", "runDriveMigrationAll", "setupFlowDrive",
    "cleanupLegacyFolders", "cleanupLegacyFoldersApply",
    # A207 — commission decides what a named person is PAID, so identity must come from the session.
    # submitCommissionRequest is here too: submitting freezes the payable figure and takes exclusive
    # hold of the collections behind it.
    "submitCommissionRequest", "approveCommissionRequest", "rejectCommissionRequest",
    "adjustCommissionRequest", "markCommissionReleased",
    "setCommissionRate", "deleteCommissionRate", "deleteCommissionRequest",
    # A211 — the rest of the commission surface, including two READS, which is the one place this
    # file deliberately breaks its own "reads stay direct and cached" rule. getCommissionRequests
    # with no salesperson returns every claim in the company; the only honest way to scope it is to
    # know who is asking, and a name the browser sent is not that. createCommissionRequest's
    # "you can only claim on your own quotations" guard read the browser's own actorRole, so it
    # answered to whoever it was defending against.
    "createCommissionRequest", "updateCommissionRequest", "reviseCommissionRequest",
    "getCommissionRequests", "getCommissionClaimable",
    "seedCommissionDemo", "clearCommissionDemo",
    # A212 — the travel surface. The READ is here for the same reason as the commission reads:
    # getTravelReplenishments with no `user` returns everybody's weeks, and scoping it honestly
    # means knowing who is asking. saveTravelReplenishment decides whose name a claim is banked
    # under, so identity cannot come from the browser either.
    "getTravelReplenishments", "saveTravelReplenishment", "deleteTravelReplenishment",
]


@flow_bp.route("/flow/secured-actions", methods=["GET"])
def secured_actions():
    """The list of actions the client must route through /flow/secure."""
    return jsonify({"success": True, "actions": SECURED_ACTIONS})


@flow_bp.route("/flow/secure", methods=["POST"])
def secure_mutation():
    """Validate the caller, stamp their real identity, and forward to FlowAPI."""
    if not FLOW_APPS_SCRIPT_URL:
        return jsonify({"success": False, "message":
                        "Secured actions are not configured on the server: FLOW_APPS_SCRIPT_URL "
                        "is not set. Add it to the deployment's Environment."}), 503
    if not INTERNAL_SHARED_SECRET:
        return jsonify({"success": False, "message":
                        "Secured actions are not configured on the server: INTERNAL_SHARED_SECRET "
                        "is not set."}), 503

    body = request.get_json(silent=True) or {}
    token = body.get("sessionToken", "") or request.headers.get("X-Session-Token", "")
    session = validate_session(token)
    if not session:
        return jsonify({"success": False, "message": "Your session has expired — sign in again."}), 401

    action = str(body.get("action") or "").strip()
    if action not in SECURED_ACTIONS:
        return jsonify({"success": False, "message": f"'{action}' is not a secured action."}), 400

    params = body.get("params")
    if not isinstance(params, dict):
        params = {}

    # The caller's claimed identity is replaced, never merged: whatever the browser said about
    # who it is stops mattering here.
    params = dict(params)
    params.pop("flowSecret", None)
    params["action"] = action
    params["actorRole"] = str(session.get("role") or "").strip().lower()
    params["actorName"] = display_name_for(session.get("username", ""))
    params["actorUsername"] = session.get("username", "")
    params["flowSecret"] = INTERNAL_SHARED_SECRET

    try:
        resp = http_requests.post(FLOW_APPS_SCRIPT_URL, json=params,
                                  timeout=60, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location")
            if loc:
                resp = http_requests.get(loc, timeout=60)
        text = resp.text or ""
        if text.lstrip().startswith("<"):
            # The known Apps Script flake: an HTML error page returned with HTTP 200. Mutations
            # are NOT retried here — the first attempt may well have committed.
            logger.warning("secure_mutation: HTML response for %s", action)
            return jsonify({"success": False, "message":
                            "The backend returned an error page. Refresh and check the record "
                            "before retrying — the action may have gone through."}), 502
        return jsonify(json.loads(text))
    except Exception as exc:
        logger.exception("secure_mutation failed for %s", action)
        return jsonify({"success": False, "message": str(exc)}), 502


# ── Google Sheet CSV proxy (for the reconcile-2026-costs tool) ─────────────────
# Browsers can't fetch the docs.google.com CSV export cross-origin. This is NOT an
# open proxy: the URL is constructed server-side from two validated params only.
@flow_bp.route("/flow/sheet-csv", methods=["GET"])
def sheet_csv():
    import re as _re
    import requests as http_requests
    sheet_id = (request.args.get("id") or "").strip()
    gid = (request.args.get("gid") or "0").strip()
    if not _re.fullmatch(r"[A-Za-z0-9_-]{10,80}", sheet_id):
        return jsonify({"success": False, "message": "Invalid sheet id."}), 400
    if not _re.fullmatch(r"\d{1,12}", gid):
        return jsonify({"success": False, "message": "Invalid gid."}), 400
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    try:
        resp = http_requests.get(url, timeout=30, allow_redirects=True)
        if resp.status_code != 200:
            return jsonify({"success": False, "message": f"Sheet fetch failed (HTTP {resp.status_code}). Is the sheet link-accessible?"}), 502
        out = make_response(resp.content)
        out.headers["Content-Type"] = "text/csv; charset=utf-8"
        return out
    except Exception as e:
        logger.exception("sheet-csv proxy failed")
        return jsonify({"success": False, "message": f"Sheet fetch failed: {e}"}), 502


def _pp_num(v):
    """Parse a currency/number string like '₱1,250.00' or '16' → float (0.0 on failure)."""
    if v is None:
        return 0.0
    s = re.sub(r"[^0-9.\-]", "", str(v))
    try:
        return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError:
        return 0.0


# A206 — the old text-scraping parser lived here. It targeted a different, older layout: it hunted
# for 'Date:' / 'Subject:' / 'Ref No:' WITH colons and a table headed 'Item No. | Description |
# Model No.', none of which this document has. Measured against the embedded payload of four real
# quotations it scored 0/4 on customer, quotation no, date, subject and attention — and reported no
# warnings while returning the address line ('City 1550') as the customer name. Replaced by
# pdf_generators/quotation_parser.py, which reads the page geometry instead.

@flow_bp.route("/flow/import-quotation-pdf", methods=["POST"])
def import_quotation_pdf():
    """Read an uploaded quotation PDF → return editable draft data.

    Prefers the exact embedded /QuoData (system-generated PDFs); otherwise falls back
    to a best-effort pdfplumber parse. Read-only: never writes to the flow."""
    f = request.files.get("pdf")
    if not f:
        return jsonify({"success": False, "message": "No PDF uploaded."}), 400
    try:
        pdf_bytes = f.read()
    except Exception as e:
        return jsonify({"success": False, "message": f"Could not read upload: {e}"}), 400
    if not pdf_bytes:
        return jsonify({"success": False, "message": "Empty file."}), 400

    exact = _read_quo_data(pdf_bytes)
    if exact:
        exact.setdefault("doc", {})
        return jsonify({"success": True, "source": "exact", "warnings": [], **exact})

    # A206 — this PDF carries no embedded payload, so it is reconstructed from the page layout.
    # `confidence` maps field -> bool: a field the parser could not read comes back EMPTY and is
    # named in `warnings`, so the admin fills a blank box rather than trusting a wrong value.
    data, warnings, confidence = parse_quotation_pdf(pdf_bytes)
    if data is None:
        return jsonify({"success": False, "message": (warnings or ["Could not parse PDF."])[0]}), 422
    return jsonify({"success": True, "source": "parsed", "warnings": warnings,
                    "confidence": confidence, **data})


@flow_bp.errorhandler(413)
def _upload_too_large(_e):
    """A186 — an oversized upload must answer in JSON, not Flask's HTML error page.

    The stamping UI reads `message` off the response; without this the rep sees a bare browser
    error and has no idea the file was simply too big.
    """
    return jsonify({"success": False, "reason": "too-large",
                    "message": "That file is larger than 16 MB. Attach the original unstamped, or "
                               "ask the client for a smaller copy."}), 413


@flow_bp.route("/flow/stamp-po-received", methods=["POST"])
def stamp_po_received():
    """A186 — stamp an uploaded client PO 'RECEIVED <date>' on page 1.

    Read-only with respect to the flow: this returns the stamped copy and nothing else. The
    caller stores the client's original separately and unmodified.

    Answers JSON by default because the stamp carries warnings the rep must see BEFORE filing —
    "this page was a scan so the stamp is on an added strip", "this file was already stamped" —
    and a warning inside a PDF blob reaches nobody. `?inline=1` returns the plain PDF for preview.
    """
    from pdf_generators.po_stamp_pdf import build_stamped_po_bytes

    f = request.files.get("pdf")
    if not f:
        return jsonify({"success": False, "reason": "empty",
                        "message": "No PDF uploaded."}), 400
    try:
        pdf_bytes = f.read()
    except Exception as e:
        return jsonify({"success": False, "reason": "unreadable",
                        "message": f"Could not read upload: {e}"}), 400
    if not pdf_bytes:
        return jsonify({"success": False, "reason": "empty", "message": "Empty file."}), 400

    received_date = _s(request.form.get("receivedDate"))
    if not received_date:
        # Deliberately not defaulted. The whole point of the feature is that this date is the real
        # one someone chose, so inventing it here would quietly defeat it.
        return jsonify({"success": False, "reason": "bad-date",
                        "message": "Pick the date the PO was received before stamping."}), 400

    try:
        stamped, report = build_stamped_po_bytes(
            pdf_bytes, received_date,
            received_by=_s(request.form.get("receivedBy")),
            po_number=_s(request.form.get("poNumber")),
            so_number=_s(request.form.get("soNumber")))
    except Exception as e:                      # the builder swallows its own errors; belt and braces
        logger.exception("PO stamp failed")
        return jsonify({"success": False, "reason": "stamp-failed",
                        "message": f"Stamping error: {e}"}), 500

    if not stamped:
        msg = {
            "bad-date": "That received date could not be read. Pick it again.",
            "unreadable": "That file could not be read as a PDF. Attach the original unstamped.",
            "encrypted": "That PDF is password-protected. Ask the client for an unlocked copy, or "
                         "attach it unstamped.",
            "no-pages": "That PDF has no pages.",
            "empty": "Empty file.",
        }.get(report.get("reason"), "The PO could not be stamped. Attach the original unstamped.")
        code = 400 if report.get("reason") in ("bad-date", "empty") else 422
        return jsonify({"success": False, "reason": report.get("reason"),
                        "message": msg, "report": report}), code

    if _s(request.args.get("inline")) in ("1", "true", "yes"):
        stem = sanitize_filename(_s(request.form.get("soNumber")) or "Client_PO")
        return _pdf_response(stamped, f"{stem}_RECEIVED.pdf")

    return jsonify({"success": True, "report": report,
                    "pdf": base64.b64encode(stamped).decode("ascii")})
