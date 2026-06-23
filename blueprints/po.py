"""Purchase Order Blueprint – ports the standalone PO app into the unified Flask application."""

import os
import logging
import time
import traceback
from io import BytesIO
from datetime import datetime

import requests as http_requests
from flask import (
    Blueprint,
    render_template,
    request,
    send_file,
    jsonify,
    current_app,
)
from PyPDF2 import PdfReader, PdfWriter

from pdf_generators.po_pdf import PODocTemplate
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

po_bp = Blueprint("po_bp", __name__, template_folder="../templates")

# ---------------------------------------------------------------------------
# Per-user state (keyed by username to isolate concurrent users)
# ---------------------------------------------------------------------------
_user_items: dict[str, list[dict]] = {}
_user_log: dict[str, list[str]] = {}
_user_brochures: dict[str, list[bytes]] = {}
_user_pdf: dict[str, dict] = {}
_user_submission: dict[str, dict] = {}

PO_GOOGLE_APPS_SCRIPT_URL = os.environ.get("PO_GOOGLE_APPS_SCRIPT_URL", "")
DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")


def _get_user_key():
    return (request.headers.get('X-User-Key', '') or
            request.args.get('user_key', '') or
            (request.get_json(silent=True) or {}).get('user_key', '') or
            request.form.get('user_key', '') or
            'anonymous')


def _items(uk): return _user_items.setdefault(uk, [])
def _log(uk): return _user_log.setdefault(uk, [])
def _log_reset(uk): _user_log[uk] = []; return _user_log[uk]
def _brochures(uk): return _user_brochures.setdefault(uk, [])

CURRENCY_SYMBOLS = {
    "USD": "$",
    "PHP": "\u20B1",
    "EUR": "\u20AC",
    "JPY": "\u00A5",
    "GBP": "\u00A3",
    "AUD": "A$",
    "CAD": "C$",
    "SGD": "S$",
    "AED": "AED ",
}


def _upload_po_pdf_to_drive(created_by: str, uk: str) -> str:
    """Upload stored PO PDF to Google Drive and return the drive link."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        logger.warning("_upload_po_pdf_to_drive: DASHBOARD_APPS_SCRIPT_URL not configured")
        return ""
    user_pdf = _user_pdf.get(uk, {})
    if not user_pdf.get("bytes"):
        logger.warning("_upload_po_pdf_to_drive: No PDF bytes available for uk=%s", uk)
        return ""
    try:
        import base64 as b64mod
        pdf_b64 = b64mod.b64encode(user_pdf["bytes"]).decode("ascii")
        payload = {
            "action": "savePOPDF",
            "pdfBase64": pdf_b64,
            "fileName": user_pdf.get("filename", "po.pdf"),
            "creatorName": created_by or "Unknown",
        }
        logger.info("_upload_po_pdf_to_drive: POSTing %d bytes to %s...", len(pdf_b64), DASHBOARD_APPS_SCRIPT_URL[:60])
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload, timeout=60)
        logger.info("_upload_po_pdf_to_drive: Response status=%d", resp.status_code)
        if resp.status_code in (301, 302, 303, 307, 308):
            redir = resp.headers.get("Location")
            logger.info("_upload_po_pdf_to_drive: Redirecting (GET) to %s", redir[:80] if redir else "None")
            if redir:
                resp = http_requests.get(redir, timeout=60)
                logger.info("_upload_po_pdf_to_drive: Redirect response status=%d", resp.status_code)
        if resp.status_code == 200:
            result = resp.json()
            logger.info("_upload_po_pdf_to_drive: result=%s", str(result)[:200])
            if result.get("success"):
                return result.get("driveLink", "")
            else:
                logger.warning("_upload_po_pdf_to_drive: API returned success=false: %s", result.get("message", ""))
        else:
            logger.warning("_upload_po_pdf_to_drive: Non-200 response: %d, body=%s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.error("PO Drive upload error: %s\n%s", e, traceback.format_exc())
    return ""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@po_bp.route("/")
def index():
    """Render the PO generator page."""
    return render_template("po/index.html")


@po_bp.route("/add_item", methods=["POST"])
def add_item():
    """Add an item to the current PO item list."""
    uk = _get_user_key()
    items = _items(uk)
    data = request.get_json(force=True)
    item = {
        "item_no": len(items) + 1,
        "item_code": data.get("item_code", ""),
        "item_description": data.get("item_description", ""),
        "quantity": float(data.get("quantity", 0)),
        "unit_price": float(data.get("unit_price", 0)),
    }
    items.append(item)
    return jsonify({"status": "ok", "items": items})


@po_bp.route("/remove_item/<int:item_no>", methods=["POST"])
def remove_item(item_no):
    """Remove an item by its item number, then re-index."""
    uk = _get_user_key()
    _user_items[uk] = [i for i in _items(uk) if i["item_no"] != item_no]
    items = _items(uk)
    for idx, item in enumerate(items, start=1):
        item["item_no"] = idx
    return jsonify({"status": "ok", "items": items})


@po_bp.route("/reset_items", methods=["POST"])
def reset_items():
    """Clear all items and the output log."""
    uk = _get_user_key()
    _user_items[uk] = []
    _user_log[uk] = []
    _user_brochures[uk] = []
    return jsonify({"status": "ok", "items": [], "log": []})


@po_bp.route("/generate", methods=["POST"])
def generate():
    """Generate a Purchase Order PDF."""
    uk = _get_user_key()
    items = _items(uk)
    brochures = _brochures(uk)
    log = _log_reset(uk)
    try:
        # ---- Form data ----
        vendor_name = request.form.get("vendor_name", "").strip()
        vendor_address = request.form.get("vendor_address", "").strip()
        vendor_contact_person = request.form.get("vendor_contact_person", "").strip()
        vendor_email = request.form.get("vendor_email", "").strip()
        vendor_tin = request.form.get("vendor_tin", "").strip()
        payment_terms = request.form.get("payment_terms", "").strip()
        date_needed = request.form.get("date_needed", "").strip()
        po_number = request.form.get("po_number", "").strip()
        po_date = request.form.get("po_date", "").strip()
        invoice_contact_person = request.form.get("invoice_contact_person", "").strip()
        invoice_email = request.form.get("invoice_email", "").strip()
        reference_no = request.form.get("reference_no", "").strip()
        currency = request.form.get("currency", "PHP").strip()
        description_type = request.form.get("description_type", "short").strip()

        if not items:
            return jsonify({"status": "error", "message": "No items to generate."}), 400

        currency_symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")

        # ---- Build items table rows ----
        items_table = []
        for item in items:
            qty = item["quantity"]
            unit_price = item["unit_price"]
            total_amount = qty * unit_price
            items_table.append({
                "item_no": item["item_no"],
                "item_code": item["item_code"],
                "item_description": item["item_description"],
                "quantity": qty,
                "unit_price": unit_price,
                "total_amount": total_amount,
            })

        # ---- Pagination settings ----
        items_per_page = 10 if description_type == "short" else 3

        # ---- Format PO date for display ----
        try:
            po_date_display = datetime.strptime(po_date, "%Y-%m-%d").strftime("%B %d, %Y")
        except (ValueError, TypeError):
            po_date_display = po_date

        # ---- Client details dict consumed by PODocTemplate ----
        client_details = {
            "vendor_name": vendor_name,
            "vendor_address": vendor_address,
            "vendor_contact_person": vendor_contact_person,
            "vendor_email": vendor_email,
            "vendor_tin": vendor_tin,
            "payment_terms": payment_terms,
            "date_needed": date_needed,
            "po_number": po_number,
            "po_date": po_date_display,
            "invoice_contact_person": invoice_contact_person,
            "invoice_email": invoice_email,
            "reference_no": reference_no,
            "currency": currency,
            "currency_symbol": currency_symbol,
            "description_type": description_type,
        }

        # ---- Generate PDF in memory ----
        safe_vendor = sanitize_filename(vendor_name)
        safe_po = sanitize_filename(po_number)
        filename = f"Purchase_Order_{safe_vendor}_{safe_po}.pdf"

        buffer = BytesIO()
        doc = PODocTemplate(
            buffer,
            client_details=client_details,
            items=items_table,
            items_per_page=items_per_page,
            currency_symbol=currency_symbol,
        )
        if description_type == "long":
            doc.repeat_vendor_terms = True

        doc.build_pdf()

        # ---- Merge brochure PDFs from form upload ----
        brochure_files = request.files.getlist("brochure_file")
        if brochure_files:
            buffer.seek(0)
            writer = PdfWriter()
            for pg in PdfReader(buffer).pages:
                writer.add_page(pg)
            for bf in brochure_files:
                if bf and bf.filename and bf.filename.lower().endswith(".pdf"):
                    try:
                        bf.seek(0)
                        for pg in PdfReader(bf).pages:
                            writer.add_page(pg)
                    except Exception as merge_err:
                        logger.warning("Could not merge brochure: %s", merge_err)
            merged = BytesIO()
            writer.write(merged)
            buffer = merged

        log_entry = f"[{datetime.now().strftime('%H:%M:%S')}] Generated: {filename}"
        log.append(log_entry)

        # Store PDF bytes for the response and Drive upload
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()
        _user_pdf[uk] = {
            "bytes": pdf_bytes,
            "filename": filename,
            "po_number": po_number,
        }

        # ── Auto-submit: upload PDF to Drive + save PO record ──
        created_by = request.form.get("created_by", "").strip()
        creator_role = request.form.get("creator_role", "").strip()
        vendor_email_val = vendor_email
        total_amount = sum(i["quantity"] * i["unit_price"] for i in items)
        items_descs = [i["item_description"] for i in items if i.get("item_description")]
        items_summary = "; ".join(items_descs)

        # Run Drive upload + Sheets submissions in a background thread so the
        # PDF response returns immediately. Failures are logged but invisible
        # to the current request (the log entry is best-effort anyway).
        legacy_rows = [
            {
                "po_number": po_number,
                "vendor_name": vendor_name,
                "item_code": item["item_code"],
                "item_description": item["item_description"],
                "quantity": item["quantity"],
                "unit_price": item["unit_price"],
                "po_date": po_date,
                "total_cost": item["quantity"] * item["unit_price"],
            }
            for item in items
        ] if PO_GOOGLE_APPS_SCRIPT_URL else []

        def _async_submit():
            drive_link = ""
            record_saved = False
            record_message = ""
            try:
                if DASHBOARD_APPS_SCRIPT_URL:
                    # Step 1: Upload PDF to Drive (failure here must NOT block record save)
                    try:
                        drive_link = _upload_po_pdf_to_drive(created_by, uk)
                        logger.info("PO auto-submit: drive_link=%s", drive_link[:80] if drive_link else "(empty)")
                    except Exception as pdf_err:
                        logger.warning("PO Drive upload failed (record save will continue): %s", pdf_err)

                    # Step 2: Always save the PO record, even if drive link is empty
                    try:
                        dashboard_payload = {
                            "action": "savePORecord",
                            "poNo": po_number,
                            "date": po_date,
                            "vendorName": vendor_name,
                            "vendorEmail": vendor_email_val,
                            "totalAmount": total_amount,
                            "currency": currency,
                            "referenceNo": reference_no,
                            "itemsSummary": items_summary,
                            "createdBy": created_by,
                            "driveLink": drive_link,
                            "creatorRole": creator_role,
                        }
                        rec_resp = None
                        last_err = None
                        # Retry up to 3 times — Apps Script can return transient 502/timeout
                        for attempt in range(3):
                            try:
                                rec_resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=dashboard_payload, timeout=60)
                                logger.info("PO auto-submit savePORecord attempt %d: status=%d, body=%s",
                                            attempt + 1, rec_resp.status_code, rec_resp.text[:200])
                                if rec_resp.status_code == 200:
                                    break
                                last_err = f"HTTP {rec_resp.status_code}"
                            except Exception as attempt_err:
                                last_err = str(attempt_err)
                                logger.warning("PO savePORecord attempt %d failed: %s", attempt + 1, attempt_err)
                            if attempt < 2:
                                time.sleep(2 * (attempt + 1))

                        if rec_resp is not None and rec_resp.status_code == 200:
                            rec_result = rec_resp.json()
                            record_saved = bool(rec_result.get("success"))
                            record_message = rec_result.get("message", "")
                        else:
                            record_message = last_err or "savePORecord did not return HTTP 200 after retries"
                            logger.error("PO savePORecord FAILED after retries — vendor=%s poNo=%s driveLink=%s err=%s",
                                         vendor_name, po_number, drive_link, record_message)
                    except Exception as rec_err:
                        record_message = str(rec_err)
                        logger.warning("PO savePORecord failed: %s", rec_err)

                if legacy_rows:
                    try:
                        http_requests.post(PO_GOOGLE_APPS_SCRIPT_URL, json={"rows": legacy_rows}, timeout=30)
                    except Exception as leg_err:
                        logger.warning("Legacy PO sheet submission failed: %s", leg_err)

                if record_saved:
                    _user_submission[uk] = {
                        "status": "success",
                        "message": "PO saved to approvals." + (" Drive link attached." if drive_link else " (No drive link — PDF upload failed.)"),
                        "driveLink": drive_link,
                        "time": datetime.now().isoformat(),
                    }
                else:
                    _user_submission[uk] = {
                        "status": "error",
                        "message": record_message or "PO record was not saved. Check Apps Script logs.",
                        "driveLink": drive_link,
                        "time": datetime.now().isoformat(),
                    }
            except Exception as e:
                logger.warning("PO async submit failed: %s", e)
                _user_submission[uk] = {"status": "error", "message": str(e), "time": datetime.now().isoformat()}

        if DASHBOARD_APPS_SCRIPT_URL or legacy_rows:
            _user_submission[uk] = {"status": "pending", "time": datetime.now().isoformat()}
            import threading as _threading
            _threading.Thread(target=_async_submit, daemon=True).start()
            log.append(f"[{datetime.now().strftime('%H:%M:%S')}] PO Approvals submission started (async)")

        buffer = BytesIO(pdf_bytes)
        return send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )

    except Exception as exc:
        logger.error("PO generate error: %s\n%s", exc, traceback.format_exc())
        return jsonify({"status": "error", "message": str(exc)}), 500


@po_bp.route("/submit_to_sheets", methods=["POST"])
def submit_to_sheets():
    """Submit the current PO items to Google Sheets via Apps Script."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)
    try:
        data = request.get_json(force=True)
        po_number    = data.get("po_number", "")
        vendor_name  = data.get("vendor_name", "")
        po_date      = data.get("po_date", "")
        vendor_email = data.get("vendor_email", "")
        reference_no = data.get("reference_no", "")
        currency     = data.get("currency", "PHP")
        total_amount = data.get("total_amount", 0)
        items_summary = data.get("items_summary", "")
        created_by   = data.get("created_by", "")
        creator_role = data.get("creator_role", "")

        if not items:
            return jsonify({"status": "error", "message": "No items to submit."}), 400

        # ── 1. Submit to legacy PO Google Sheet (existing behaviour) ──
        if PO_GOOGLE_APPS_SCRIPT_URL:
            rows = []
            for item in items:
                total_cost = item["quantity"] * item["unit_price"]
                rows.append({
                    "po_number": po_number,
                    "vendor_name": vendor_name,
                    "item_code": item["item_code"],
                    "item_description": item["item_description"],
                    "quantity": item["quantity"],
                    "unit_price": item["unit_price"],
                    "po_date": po_date,
                    "total_cost": total_cost,
                })
            try:
                http_requests.post(PO_GOOGLE_APPS_SCRIPT_URL, json={"rows": rows}, timeout=30)
            except Exception as e:
                logger.warning("Legacy PO sheet submission failed: %s", e)

        # ── 2. Upload PDF to Drive + save PO record to dashboard ────
        if DASHBOARD_APPS_SCRIPT_URL:
            drive_link = _upload_po_pdf_to_drive(created_by, uk)
            dashboard_payload = {
                "action": "savePORecord",
                "poNo": po_number,
                "date": po_date,
                "vendorName": vendor_name,
                "vendorEmail": vendor_email,
                "totalAmount": total_amount,
                "currency": currency,
                "referenceNo": reference_no,
                "itemsSummary": items_summary,
                "createdBy": created_by,
                "driveLink": drive_link,
                "creatorRole": creator_role,
            }
            try:
                resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=dashboard_payload, timeout=30, allow_redirects=False)
                if resp.status_code in (301, 302, 303, 307, 308):
                    redir = resp.headers.get("Location")
                    if redir:
                        resp = http_requests.get(redir, timeout=30)
            except Exception as e:
                logger.warning("Dashboard PO record save failed: %s", e)

        log_entry = f"[{datetime.now().strftime('%H:%M:%S')}] Submitted to Google Sheets"
        log.append(log_entry)
        return jsonify({"status": "ok", "message": "Submitted successfully.", "log": log})

    except Exception as exc:
        logger.error("PO submit_to_sheets error: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 500


@po_bp.route("/upload_brochure", methods=["POST"])
def upload_brochure():
    """Store brochure PDF bytes in memory for merging during generate."""
    uk = _get_user_key()
    brochures = _brochures(uk)
    files = request.files.getlist("brochure_file")
    count = 0
    for f in files:
        if f and f.filename and f.filename.lower().endswith(".pdf"):
            brochures.append(f.read())
            count += 1
    return jsonify({"status": "ok", "brochures_added": count, "total": len(brochures)})


@po_bp.route("/last_submission_info", methods=["GET"])
def last_submission_info():
    """Check status of last async PO sheet submission."""
    uk = _get_user_key()
    info = _user_submission.get(uk, {"status": "none"})
    return jsonify(info)
