"""Materials Issuance (MI) Blueprint -- mirrors Materials Receiving for issuing materials."""

import os
import logging
import traceback
import threading as _threading
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

from pdf_generators.mi_pdf import MIDocTemplate
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

mi_bp = Blueprint("mi_bp", __name__, template_folder="../templates")

# ---------------------------------------------------------------------------
# Per-user state (keyed by username to isolate concurrent users)
# ---------------------------------------------------------------------------
_user_items: dict[str, list[dict]] = {}
_user_log: dict[str, list[str]] = {}
_user_pdf: dict[str, dict] = {}
_user_submission: dict[str, dict] = {}

MI_GOOGLE_APPS_SCRIPT_URL = os.environ.get("MI_GOOGLE_APPS_SCRIPT_URL", "")
DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")
INVENTORY_SHEET_ID = os.environ.get("INVENTORY_SHEET_ID", "")
MI_SHEET_ID = os.environ.get("MI_SHEET_ID", "")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_key():
    return (request.headers.get('X-User-Key', '') or
            request.args.get('user_key', '') or
            (request.get_json(silent=True) or {}).get('user_key', '') or
            request.form.get('user_key', '') or
            'anonymous')


def _items(uk): return _user_items.setdefault(uk, [])
def _log(uk): return _user_log.setdefault(uk, [])
def _log_reset(uk): _user_log[uk] = []; return _user_log[uk]

def is_valid_pdf(file):
    """Return True if *file* (file-like object) is a valid PDF."""
    try:
        file.seek(0)
        PdfReader(file)
        file.seek(0)
        return True
    except Exception as e:
        logger.error(f"Invalid PDF file: {str(e)}")
        return False


def _upload_mi_pdf_to_drive(created_by: str, uk: str) -> str:
    """Upload stored MI PDF to Google Drive and return the drive link."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return ""
    user_pdf = _user_pdf.get(uk, {})
    if not user_pdf.get("bytes"):
        return ""
    try:
        import base64 as b64mod
        pdf_b64 = b64mod.b64encode(user_pdf["bytes"]).decode("ascii")
        payload = {
            "action": "saveMIPDF",
            "pdfBase64": pdf_b64,
            "fileName": user_pdf.get("filename", "mi.pdf"),
            "creatorName": created_by or "Unknown",
        }
        logger.info("_upload_mi_pdf_to_drive: POSTing %d bytes", len(pdf_b64))
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                  timeout=60, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            redir = resp.headers.get("Location")
            if redir:
                resp = http_requests.get(redir, timeout=60)
        if resp.status_code == 200:
            result = resp.json()
            if result.get("success"):
                return result.get("driveLink", "")
            else:
                logger.warning("MI Drive upload failed: %s", result.get("message", ""))
        else:
            logger.warning("MI Drive upload: status %d", resp.status_code)
    except Exception as e:
        logger.error("MI Drive upload error: %s", e)
    return ""


def submit_to_google_sheet(recipient_name, issuance_date, issuance_no, requisition_no,
                           items_list, remarks, issued_by, drive_link=""):
    """Submit item rows to Google Sheets via Apps Script with redirect handling."""
    try:
        if not MI_GOOGLE_APPS_SCRIPT_URL or not MI_GOOGLE_APPS_SCRIPT_URL.startswith("https://"):
            return False, "Google Apps Script URL not configured."
        if not items_list:
            return False, "No items available to submit."

        rows = []
        for item in items_list:
            row = {
                "recipient_name":  recipient_name,
                "issuance_date":   issuance_date,
                "issuance_no":     issuance_no,
                "requisition_no":  requisition_no,
                "model_no":        item.get("model_no", ""),
                "item_description": item.get("item_description", ""),
                "quantity":        item.get("quantity", 0),
                "remarks":         item.get("item_remarks", ""),
                "issued_by":       issued_by,
                "drive_link":      drive_link,
            }
            rows.append(row)
        payload = {"rows": rows, "inventory_sheet_id": INVENTORY_SHEET_ID}

        response = http_requests.post(
            MI_GOOGLE_APPS_SCRIPT_URL, json=payload, timeout=15,
            allow_redirects=False
        )

        if response.status_code in (301, 302, 303, 307, 308):
            redirect_url = response.headers.get("Location")
            if redirect_url:
                response = http_requests.get(redirect_url, timeout=15)

        if response.status_code == 200:
            raw = response.text[:200]
            try:
                result = response.json()
                if result.get("status") == "error":
                    return False, f"Apps Script error: {result.get('message', 'Unknown error')} | raw: {raw}"
                return True, f"Submitted {len(rows)} row(s). Script response: {raw}"
            except Exception:
                return True, f"Submitted {len(rows)} row(s). Raw response: {raw}"
        else:
            return False, f"Error submitting to Google Sheet: status {response.status_code}"
    except http_requests.exceptions.Timeout:
        return False, "Request timed out. Please try again."
    except Exception as e:
        return False, f"Error submitting to Google Sheet: {str(e)}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@mi_bp.route("/")
def index():
    """Render the MI generator page."""
    return render_template("mi/index.html")


@mi_bp.route("/add_item", methods=["POST"])
def add_item():
    """Add an item to the current MI item list."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)
    data = request.get_json(silent=True)
    if not data:
        log.append("Error: Invalid request data.")
        return jsonify({"success": False, "output_log": log})
    model_no = data.get("model_no")
    item_description = data.get("item_description")
    quantity = data.get("quantity")
    item_remarks = data.get("item_remarks", "")

    try:
        quantity = int(quantity)
        if quantity <= 0:
            log.append("Error: Quantity must be a positive number.")
            return jsonify({"success": False, "output_log": log})
    except (ValueError, TypeError):
        log.append("Error: Invalid quantity.")
        return jsonify({"success": False, "output_log": log})

    if not model_no or not item_description:
        log.append("Error: Model No. and Item Description are required.")
        return jsonify({"success": False, "output_log": log})

    item = {
        "item_no": len(items) + 1,
        "model_no": model_no,
        "item_description": item_description,
        "quantity": quantity,
        "item_remarks": item_remarks,
    }
    items.append(item)
    log.append(f"Success: Item '{item_description}' added.")
    return jsonify({"success": True, "output_log": log, "item": item})


@mi_bp.route("/remove_item/<int:item_no>", methods=["POST"])
def remove_item(item_no):
    """Remove an item by its item number, then re-index."""
    uk = _get_user_key()
    log = _log_reset(uk)
    _user_items[uk] = [item for item in _items(uk) if item["item_no"] != item_no]
    items = _items(uk)
    for idx, item in enumerate(items, 1):
        item["item_no"] = idx
    log.append(f"Success: Removed item {item_no}.")
    return jsonify({"success": True, "items": items, "output_log": log})


@mi_bp.route("/reset_items", methods=["POST"])
def reset_items():
    """Clear all items and the output log."""
    uk = _get_user_key()
    _user_items[uk] = []
    log = _log_reset(uk)
    log.append("Success: Items list cleared.")
    return jsonify({"success": True, "output_log": log})


@mi_bp.route("/generate", methods=["POST"])
def generate():
    """Generate a Materials Issuance PDF."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)

    if not request.form:
        log.append("Error: No form data provided.")
        return jsonify({"success": False, "message": "No form data provided.", "output_log": log})

    data = request.form.to_dict()
    description_type = data.get("description_type", "short").strip().lower()
    if description_type not in ("short", "long"):
        description_type = "short"

    required_fields = [
        "vendor_name", "vendor_address", "vendor_contact_person",
        "vendor_email", "vendor_tin", "sales_invoice", "po_date"
    ]
    client_details = {f: data.get(f, "") for f in required_fields}
    client_details["purchase_order_no"]         = data.get("purchase_order_no", "")
    client_details["special_notes"]             = data.get("special_notes", "")
    client_details["received_checked_name"]     = data.get("received_checked_name", "")
    client_details["received_checked_position"] = data.get("received_checked_position", "")
    client_details["prepared_by_name"]          = data.get("prepared_by_name", "")
    client_details["prepared_by_position"]      = data.get("prepared_by_position", "")

    missing = [f for f in required_fields if not client_details[f]]
    if missing:
        log.append(f"Error: Missing fields: {', '.join(missing)}")
        return jsonify({"success": False, "message": f"Missing: {', '.join(missing)}", "output_log": log})

    if not items:
        log.append("Error: Please add at least one item.")
        return jsonify({"success": False, "message": "No items.", "output_log": log})

    # ── Generate PDF in memory ─────────────────────────────────
    client_name = sanitize_filename(client_details.get("vendor_name", "UnknownRecipient"))
    issuance_no = sanitize_filename(client_details.get("sales_invoice", "NoRef"))
    pdf_filename = f"Materials_Issuance_{client_name}_{issuance_no}.pdf"

    try:
        items_per_page = 10 if description_type == "short" else 3

        buffer = BytesIO()
        doc = MIDocTemplate(
            buffer,
            client_details=client_details,
            items=list(items),
            items_per_page=items_per_page,
        )
        doc.build_pdf()
        log.append("Success: PDF generated.")

        # ── Append brochures in memory ────────────────────────────────
        brochure_files = request.files.getlist("brochure_file")
        valid_brochures = [
            f for f in brochure_files
            if f and f.filename and f.filename.lower().endswith(".pdf") and is_valid_pdf(f)
        ]
        if valid_brochures:
            buffer.seek(0)
            writer = PdfWriter()
            for pg in PdfReader(buffer).pages:
                writer.add_page(pg)
            for bf in valid_brochures:
                bf.seek(0)
                for pg in PdfReader(bf).pages:
                    writer.add_page(pg)
            merged = BytesIO()
            writer.write(merged)
            buffer = merged

        log.append("Success: Materials Issuance document generated.")

        # Store PDF bytes for Drive upload
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()
        _user_pdf[uk] = {"bytes": pdf_bytes, "filename": pdf_filename}

        # Upload to Google Drive in background so PDF is returned immediately.
        if DASHBOARD_APPS_SCRIPT_URL:
            created_by = data.get("prepared_by_name", "").strip()
            def _bg_drive(uk_=uk, cb_=created_by):
                try:
                    link = _upload_mi_pdf_to_drive(cb_, uk_)
                    if link:
                        _user_pdf.setdefault(uk_, {})["drive_link"] = link
                except Exception as e:
                    logger.warning("MI Drive upload (bg) failed: %s", e)
            _threading.Thread(target=_bg_drive, daemon=True).start()
            log.append("PDF generated. Drive upload started in background.")

        buffer = BytesIO(pdf_bytes)
        return send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=pdf_filename,
        )

    except Exception as e:
        log.append(f"Error: {str(e)}")
        logger.error(f"PDF generation failed: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e), "output_log": log}), 500


@mi_bp.route("/submit_to_sheets", methods=["POST"])
def submit_to_sheets():
    """Submit the current MI items to Google Sheets via Apps Script (async)."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Invalid request format", "output_log": log}), 400

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Empty request", "output_log": log}), 400

        issuance_no     = data.get("issuance_no", "").strip()
        requisition_no  = data.get("requisition_no", "").strip()
        recipient_name  = data.get("recipient_name", "").strip()
        issuance_date   = data.get("issuance_date", "").strip()
        remarks         = data.get("remarks", "").strip()
        issued_by       = data.get("issued_by", "").strip()

        if not all([issuance_no, recipient_name, issuance_date, issued_by]):
            return jsonify({"success": False, "message": "Missing required fields", "output_log": log}), 400
        if not items:
            return jsonify({"success": False, "message": "No items to submit", "output_log": log}), 400

        # Get drive link from user_pdf if available
        user_pdf = _user_pdf.get(uk, {})
        drive_link = user_pdf.get("drive_link", "")

        # Async submission
        _user_submission[uk] = {"status": "pending", "time": datetime.now().isoformat()}

        def _async_sheet_submit():
            try:
                success, message = submit_to_google_sheet(
                    recipient_name, issuance_date, issuance_no, requisition_no,
                    items, remarks, issued_by, drive_link=drive_link
                )
                _user_submission[uk] = {
                    "status": "success" if success else "error",
                    "message": message,
                    "time": datetime.now().isoformat(),
                }
            except Exception as e:
                _user_submission[uk] = {
                    "status": "error",
                    "message": str(e),
                    "time": datetime.now().isoformat(),
                }

        _threading.Thread(target=_async_sheet_submit, daemon=True).start()
        log.append("Sheet submission started (async).")
        return jsonify({"success": True, "message": "Sheet submission started (async).", "output_log": log})

    except Exception as e:
        log.append(f"Error: {str(e)}")
        return jsonify({"success": False, "message": str(e), "output_log": log}), 500


@mi_bp.route("/last_submission_info", methods=["GET"])
def last_submission_info():
    """Check status of last async sheet submission."""
    uk = _get_user_key()
    info = _user_submission.get(uk, {"status": "none"})
    return jsonify(info)
