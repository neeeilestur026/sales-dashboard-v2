"""Flow blueprint — PDF generation for the new Accounting Process Flow.

Produces quotation and purchase-order PDFs whose layout is IDENTICAL to the legacy
generators, by reusing the legacy renderers (`QuotationDocTemplate` via
`flow_quotation_pdf`, and `PODocTemplate`). No Google Apps Script / Excel dependency:
the flow already holds final prices; Drive-save is handled separately by FlowAPI.gs.
"""

import base64
import json
import logging
import re
from io import BytesIO
from datetime import datetime

from flask import Blueprint, request, jsonify, make_response
from PyPDF2 import PdfReader, PdfWriter

from pdf_generators.flow_quotation_pdf import build_quotation_pdf_bytes, build_summary_table
from pdf_generators.po_pdf import PODocTemplate
from pdf_generators.flow_pr_pdf import build_pr_pdf_bytes
from pdf_generators.payment_request_pdf import build_payment_request_pdf
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

flow_bp = Blueprint("flow_bp", __name__)

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
            })
        data = {
            "customer": payload.get("customer"),
            "date": payload.get("date"),
            "quotationNo": payload.get("quotationNo"),
            "vatOption": payload.get("vatOption", "inclusive"),
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

    items, images, total_ex_vat = [], {}, 0.0
    for idx, it in enumerate(raw_items, start=1):
        qty, price = _num(it.get("qty")), _num(it.get("price"))
        total_ex_vat += qty * price
        items.append({
            "item_no": idx,
            "product_name": _s(it.get("itemName") or it.get("itemNo")),
            "product_code": _s(it.get("itemNo")),
            "quantity": qty,
            "total_amount": price,
            "total_unit_price": qty * price,
            "description": _s(it.get("description")),
            # requested-vs-offered (A86): the client's ORIGINAL code/description when admin
            # replaced them with the supplier's own during sourcing
            "orig_code": _s(it.get("origItemNo")),
            "orig_name": _s(it.get("origItemName")),
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
        "quotation_date": _s(data.get("date")),
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
    summary = build_summary_table(total_ex_vat, data.get("vatOption", "inclusive"),
                                  _num(data.get("discountPct")))

    try:
        pdf_bytes = build_quotation_pdf_bytes(items, images, client_details, terms,
                                              summary, desc_mode=desc_mode, note=_s(doc.get("note")))
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

    raw_date = _s(data.get("date"))
    try:
        po_date_display = datetime.strptime(raw_date, "%Y-%m-%d").strftime("%B %d, %Y")
    except (ValueError, TypeError):
        po_date_display = raw_date

    client_details = {
        "vendor_name": _s(data.get("supplier")),
        "vendor_address": _s(doc.get("vendorAddress")),
        "vendor_contact_person": _s(doc.get("vendorContact")),
        "vendor_email": _s(doc.get("vendorEmail")),
        "vendor_tin": _s(doc.get("vendorTin")),
        "payment_terms": _s(doc.get("paymentTerms")),
        "date_needed": _s(doc.get("dateNeeded")),
        "po_number": _s(data.get("poNo")),
        "po_date": po_date_display,
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
        "pr_date": _s(data.get("date")),
        "date_needed": _s(doc.get("dateNeeded")),
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


@flow_bp.route("/flow/payment-request-pdf", methods=["POST"])
def payment_request_pdf():
    """Render a flow Payment Request (PRF) using the legacy generator — identical output."""
    data = request.get_json(silent=True) or {}
    details = {
        "request_date": _s(data.get("requestDate") or data.get("date")),
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
        "due_date": _s(data.get("dueDate")),
        "remarks": _s(data.get("remarks")),
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


def _parse_quotation_pdf(pdf_bytes):
    """Best-effort scrape of a flow-layout quotation PDF via pdfplumber.

    Returns (data_dict, warnings). Targets the item table header
    Item No. | Description | Model No. | QTY (UOM) | Unit Price (PHP) | Total Amount (PHP)
    and the header text (customer, date, subject, ref/RFQ, VAT)."""
    warnings = []
    try:
        import pdfplumber
    except Exception:
        return None, ["pdfplumber is not installed on the server."]

    items = []
    full_text = ""
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                full_text += "\n" + (page.extract_text() or "")
                for table in (page.extract_tables() or []):
                    if not table:
                        continue
                    header = [str(c or "").strip().lower() for c in table[0]]
                    joined = " ".join(header)
                    if "item no" not in joined or "description" not in joined:
                        continue
                    def _col(*names):
                        for i, h in enumerate(header):
                            if any(n in h for n in names):
                                return i
                        return None
                    c_desc = _col("description")
                    c_model = _col("model")
                    c_itemno = _col("item no")
                    c_qty = _col("qty", "uom")
                    c_price = _col("unit price")
                    for row in table[1:]:
                        cells = [str(c or "").strip() for c in row]
                        def _get(i):
                            return cells[i] if (i is not None and i < len(cells)) else ""
                        desc = _get(c_desc)
                        model = _get(c_model)
                        itemno = _get(c_itemno)
                        qty = _pp_num(_get(c_qty))
                        price = _pp_num(_get(c_price))
                        if not desc and not model and not itemno:
                            continue
                        if not qty and not price and not desc:
                            continue
                        items.append({
                            "itemNo": (model or itemno or "").replace("\n", " ").strip(),
                            "itemName": desc.replace("\n", " ").strip(),
                            "qty": qty,
                            "price": price,
                            "description": desc.replace("\n", " ").strip(),
                        })
    except Exception as e:
        logger.warning("pdfplumber parse failed: %s", e)
        return None, [f"Could not read the PDF: {e}"]

    # Fallback: pdfplumber's table detection sometimes captures only the header row
    # (the Description cell is a nested Paragraph). Scrape the item lines from the text.
    # Line format: "<n> <Description...> <ModelNo> <qty> <unitPrice> <lineTotal>"
    if not items:
        row_re = re.compile(
            r"^\s*(\d+)\s+(.+?)\s+(\S+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$")
        for ln in full_text.splitlines():
            m = row_re.match(ln)
            if not m:
                continue
            desc = m.group(2).strip()
            model = m.group(3).strip()
            qty = _pp_num(m.group(4))
            price = _pp_num(m.group(5))
            if not desc or (not qty and not price):
                continue
            items.append({
                "itemNo": model, "itemName": desc, "qty": qty,
                "price": price, "description": desc,
            })

    if not items:
        warnings.append("No item table was recognized — add the items manually.")

    def _find(pattern):
        m = re.search(pattern, full_text, re.IGNORECASE)
        return m.group(1).strip() if m else ""

    subject = _find(r"Subject:\s*(.+)")
    ref_no = _find(r"Ref\s*No:\s*(.+)")
    rfq_no = _find(r"RFQ\s*No:\s*(.+)")
    attention = _find(r"Attention:\s*(.+)")
    designation = _find(r"Designation:\s*(.+)")
    email = _find(r"Email:\s*(.+)")
    date = _find(r"Date:\s*(.+)")
    vat_option = "inclusive" if re.search(r"VAT\s*Inclusive", full_text, re.IGNORECASE) else "exclusive"

    # Customer name: the bold line just before "Attention:" is hard to isolate from text;
    # fall back to the first non-empty line if present. Admin edits this anyway.
    customer = ""
    if attention:
        before = full_text.split("Attention:")[0].strip().splitlines()
        _skip = ("quotation", "date:", "ref no", "rfq", "office address", "h.o estur",
                 "blk", "district", "philippines", "san jose")
        for ln in reversed(before):
            ln = ln.strip()
            low = ln.lower()
            if not ln or any(s in low for s in _skip) or re.fullmatch(r"[\d,.\s]+", ln):
                continue
            customer = ln
            break

    data = {
        "customer": customer,
        "date": date,
        "quotationNo": ref_no,
        "vatOption": vat_option,
        "items": items,
        "doc": {
            "attention": attention,
            "designation": designation,
            "email": email,
            "subject": subject,
            "rfqNo": rfq_no,
        },
    }
    if not customer:
        warnings.append("Customer name could not be detected — please fill it in.")
    return data, warnings


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

    data, warnings = _parse_quotation_pdf(pdf_bytes)
    if data is None:
        return jsonify({"success": False, "message": (warnings or ["Could not parse PDF."])[0]}), 422
    return jsonify({"success": True, "source": "parsed", "warnings": warnings, **data})
