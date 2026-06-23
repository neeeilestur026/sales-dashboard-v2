"""Payment Request Blueprint -- form, PDF generation, Google Sheets submission, file uploads."""

import os
import re
import base64
import logging
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
)

from pdf_generators.payment_request_pdf import build_payment_request_pdf
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

payment_request_bp = Blueprint("payment_request_bp", __name__, template_folder="../templates")

# Module-level state — per-user (keyed by user_key to isolate concurrent users)
_user_log: dict[str, list[str]] = {}
_user_files: dict[str, list[dict]] = {}   # {'filename': str, 'data': bytes, 'mimetype': str}
_user_pdf: dict[str, dict] = {}            # {'bytes': bytes, 'filename': str}

PAYMENT_REQUEST_APPS_SCRIPT_URL = os.environ.get("PAYMENT_REQUEST_APPS_SCRIPT_URL", "")
DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")

# Max file size: 5 MB
MAX_FILE_SIZE = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "pdf"}


def _get_user_key():
    return (request.headers.get('X-User-Key', '') or
            request.args.get('user_key', '') or
            (request.get_json(silent=True) or {}).get('user_key', '') or
            request.form.get('user_key', '') or
            'anonymous')


def _files(uk): return _user_files.setdefault(uk, [])
def _log(uk): return _user_log.setdefault(uk, [])


def _allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _upload_supporting_docs_to_drive(pr_number: str, files: list, requested_by: str = "") -> str:
    """Upload each supporting doc to Drive, return comma-separated Drive links."""
    if not DASHBOARD_APPS_SCRIPT_URL or not files:
        return ""
    links = []
    for f in files:
        try:
            file_b64 = base64.b64encode(f["data"]).decode("ascii")
            payload = {
                "action": "savePaymentRequestAttachment",
                "fileBase64": file_b64,
                "fileName": f["filename"],
                "mimeType": f.get("mimetype", "application/octet-stream"),
                "prNumber": pr_number,
                "creatorName": requested_by,
            }
            resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                      timeout=60, allow_redirects=False)
            if resp.status_code in (301, 302, 303, 307, 308):
                redir = resp.headers.get("Location")
                if redir:
                    resp = http_requests.get(redir, timeout=60)
            if resp.status_code == 200:
                result = resp.json()
                if result.get("success"):
                    links.append(result.get("driveLink", ""))
                else:
                    logger.warning("Attachment upload failed for %s: %s",
                                   f["filename"], result.get("message", ""))
            else:
                logger.warning("Attachment upload HTTP %d for %s", resp.status_code, f["filename"])
        except Exception as e:
            logger.warning("_upload_supporting_docs_to_drive: %s — %s", f["filename"], e)
    return ", ".join(lnk for lnk in links if lnk)


def _upload_payment_request_pdf_to_drive(requested_by: str, uk: str) -> str:
    """Upload stored Payment Request PDF to Google Drive and return the drive link."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return ""
    user_pdf = _user_pdf.get(uk, {})
    if not user_pdf.get("bytes"):
        logger.warning("_upload_payment_request_pdf_to_drive: No PDF bytes")
        return ""
    try:
        pdf_b64 = base64.b64encode(user_pdf["bytes"]).decode("ascii")
        payload = {
            "action": "savePaymentRequestPDF",
            "pdfBase64": pdf_b64,
            "fileName": user_pdf.get("filename", "payment_request.pdf"),
            "creatorName": requested_by or "Unknown",
        }
        logger.info("_upload_payment_request_pdf_to_drive: POSTing %d bytes", len(pdf_b64))
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
                logger.warning("Payment Request Drive upload failed: %s", result.get("message", ""))
        else:
            logger.warning("Payment Request Drive upload: status %d", resp.status_code)
    except Exception as e:
        logger.error("Payment Request Drive upload error: %s\n%s", e, traceback.format_exc())
    return ""


# ---------------------------------------------------------------------------
# Submit to Google Sheet
# ---------------------------------------------------------------------------
def _submit_to_google_sheet(details: dict, files_info: list[dict], drive_link: str = "", attachment_links: str = ""):
    """POST payment request data to Google Apps Script."""
    try:
        # Use DASHBOARD_APPS_SCRIPT_URL (same script that handles all other documents).
        # PAYMENT_REQUEST_APPS_SCRIPT_URL is legacy and may not have driveLink support.
        url = DASHBOARD_APPS_SCRIPT_URL or PAYMENT_REQUEST_APPS_SCRIPT_URL
        if not url or not url.startswith("https://"):
            return False, "Google Apps Script URL not configured."

        # Build supporting docs list (filenames only for the sheet)
        doc_names = [f.get("filename", "") for f in files_info] if files_info else []

        payload = {
            "action": "addPaymentRequest",
            "requestDate": details.get("request_date", ""),
            "prNumber": details.get("pr_number", ""),
            "requestedBy": details.get("requested_by", ""),
            "department": details.get("department", ""),
            "purpose": details.get("purpose", ""),
            "priority": details.get("priority", ""),
            "payeeName": details.get("payee_name", ""),
            "payeeType": details.get("payee_type", ""),
            "bankName": details.get("bank_name", ""),
            "bankBranch": details.get("bank_branch", ""),
            "accountName": details.get("account_name", ""),
            "accountNumber": details.get("account_number", ""),
            "paymentMethod": details.get("payment_method", ""),
            "currency": details.get("currency", "PHP"),
            "amount": details.get("amount", ""),
            "dueDate": details.get("due_date", ""),
            "remarks": details.get("remarks", ""),
            "supportingDocs": ", ".join(doc_names) if doc_names else "",
            "driveLink": drive_link,
            "attachmentLinks": attachment_links,
        }

        response = http_requests.post(url, json=payload, timeout=30, allow_redirects=False)

        if response.status_code in (301, 302, 303, 307, 308):
            redirect_url = response.headers.get("Location")
            if redirect_url:
                response = http_requests.get(redirect_url, timeout=30)

        if response.status_code == 200:
            raw = response.text[:200]
            try:
                result = response.json()
                if result.get("status") == "error":
                    return False, f"Apps Script error: {result.get('message', 'Unknown')}"
                return True, f"Submitted successfully. Response: {raw}"
            except Exception:
                return True, f"Submitted. Raw: {raw}"
        else:
            return False, f"Error: status {response.status_code}"

    except http_requests.exceptions.Timeout:
        return False, "Request timed out."
    except Exception as e:
        return False, f"Error: {str(e)}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@payment_request_bp.route("/")
def index():
    """Render the Payment Request form."""
    uk = _get_user_key()
    _user_log[uk] = []
    return render_template("payment_request/index.html")


@payment_request_bp.route("/upload_file", methods=["POST"])
def upload_file():
    """Upload a supporting document (image or PDF)."""
    uk = _get_user_key()
    _user_log[uk] = []

    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file provided."})

    f = request.files["file"]
    if not f.filename:
        return jsonify({"success": False, "message": "No file selected."})

    if not _allowed_file(f.filename):
        return jsonify({"success": False, "message": "File type not allowed. Use PNG, JPG, GIF, or PDF."})

    data = f.read()
    if len(data) > MAX_FILE_SIZE:
        return jsonify({"success": False, "message": "File too large. Max 5 MB."})

    user_files = _files(uk)
    user_files.append({
        "filename": f.filename,
        "data": data,
        "mimetype": f.mimetype or "application/octet-stream",
    })

    return jsonify({
        "success": True,
        "message": f"Uploaded: {f.filename}",
        "files": [{"filename": pf["filename"], "index": i} for i, pf in enumerate(user_files)],
    })


@payment_request_bp.route("/remove_file/<int:file_index>", methods=["POST"])
def remove_file(file_index):
    """Remove a previously uploaded file."""
    uk = _get_user_key()
    user_files = _files(uk)
    if 0 <= file_index < len(user_files):
        removed = user_files.pop(file_index)
        return jsonify({
            "success": True,
            "message": f"Removed: {removed['filename']}",
            "files": [{"filename": pf["filename"], "index": i} for i, pf in enumerate(user_files)],
        })
    return jsonify({"success": False, "message": "File not found."})


@payment_request_bp.route("/generate", methods=["POST"])
def generate():
    """Generate a Payment Request PDF."""
    uk = _get_user_key()
    _user_log[uk] = []

    if not request.form:
        return jsonify({"success": False, "message": "No form data provided."})

    data = request.form.to_dict()

    required_fields = ["request_date", "requested_by", "payee_name", "amount", "payment_method"]
    details = {}
    for key in [
        "request_date", "pr_number", "requested_by", "department", "purpose", "priority",
        "payee_name", "payee_type", "bank_name", "bank_branch", "account_name", "account_number",
        "payment_method", "currency", "amount", "due_date", "remarks",
    ]:
        details[key] = data.get(key, "").strip()

    missing = [f for f in required_fields if not details.get(f)]
    if missing:
        msg = f"Missing required fields: {', '.join(missing)}"
        return jsonify({"success": False, "message": msg})

    # Auto-generate PR number if empty
    if not details["pr_number"]:
        details["pr_number"] = f"PR-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    try:
        buffer = BytesIO()

        # Build supporting doc info for PDF
        user_files = _files(uk)
        doc_info = [{"filename": f["filename"]} for f in user_files] if user_files else None

        build_payment_request_pdf(buffer, details, supporting_docs=doc_info)

        payee_slug = sanitize_filename(details.get("payee_name", "Unknown"))
        pr_slug = sanitize_filename(details.get("pr_number", ""))
        filename = f"Payment_Request_{payee_slug}_{pr_slug}.pdf"

        # Store PDF bytes for Drive upload
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()
        _user_pdf[uk] = {"bytes": pdf_bytes, "filename": filename}

        # Upload to Google Drive
        drive_link = ""
        if DASHBOARD_APPS_SCRIPT_URL:
            try:
                drive_link = _upload_payment_request_pdf_to_drive(
                    details.get("requested_by", ""), uk)
                if drive_link:
                    logger.info("Payment Request uploaded to Drive: %s", drive_link[:80])
            except Exception as e:
                logger.warning("Payment Request Drive upload failed: %s", e)

        # Store drive_link so submit_to_sheets can use it as a fallback
        _user_pdf[uk]["drive_link"] = drive_link

        # Auto-submit record to sheet immediately so driveLink is persisted
        # even if the server restarts before the user clicks "Save to Records".
        # Also upload supporting docs to Drive in the same thread.
        # handleAddPaymentRequest in Code.gs deduplicates by prNumber, so
        # clicking "Save to Records" afterwards is safe (won't double-save).
        if DASHBOARD_APPS_SCRIPT_URL:
            import threading as _threading
            _details_copy = dict(details)
            _drive_link_copy = drive_link
            _files_copy = list(user_files)  # keep reference to file data for upload
            def _async_submit():
                try:
                    _att_links = _upload_supporting_docs_to_drive(
                        _details_copy.get("pr_number", ""), _files_copy,
                        _details_copy.get("requested_by", ""))
                    _submit_to_google_sheet(_details_copy, [], drive_link=_drive_link_copy,
                                            attachment_links=_att_links)
                    if _att_links:
                        _user_pdf.setdefault(uk, {})["attachment_links"] = _att_links
                except Exception as _e:
                    logger.warning("Payment Request auto-submit failed: %s", _e)
            _threading.Thread(target=_async_submit, daemon=True).start()

        buffer = BytesIO(pdf_bytes)
        response = send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
        # Pass driveLink back to browser so the frontend can include it in
        # "Save to Records" without relying on server-side memory surviving restarts.
        if drive_link:
            response.headers["X-Drive-Link"] = drive_link
        return response

    except Exception as e:
        logger.error("Payment Request PDF generation failed: %s\n%s", e, traceback.format_exc())
        return jsonify({"success": False, "message": str(e)}), 500


@payment_request_bp.route("/submit_to_sheets", methods=["POST"])
def submit_to_sheets():
    """Submit payment request data to Google Sheets."""
    uk = _get_user_key()
    _user_log[uk] = []
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Invalid request format."}), 400

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Empty request."}), 400

        details = {}
        for key in [
            "request_date", "pr_number", "requested_by", "department", "purpose", "priority",
            "payee_name", "payee_type", "bank_name", "bank_branch", "account_name", "account_number",
            "payment_method", "currency", "amount", "due_date", "remarks",
        ]:
            details[key] = data.get(key, "").strip() if data.get(key) else ""

        if not details.get("payee_name") or not details.get("amount"):
            return jsonify({"success": False, "message": "Missing required fields."}), 400

        # driveLink priority: (1) from request body (browser-stored), (2) server memory, (3) fresh upload
        drive_link = data.get("driveLink", "").strip()
        if not drive_link:
            drive_link = _user_pdf.get(uk, {}).get("drive_link", "")
        if not drive_link:
            try:
                drive_link = _upload_payment_request_pdf_to_drive(
                    details.get("requested_by", "Unknown"), uk)
                if drive_link:
                    logger.info("Manual submit: PDF uploaded to Drive: %s", drive_link[:80])
            except Exception as e:
                logger.warning("Manual submit: Drive upload failed (proceeding): %s", e)

        # attachment_links priority: (1) server memory (set by background upload thread),
        # (2) upload now if files are still in memory
        attachment_links = _user_pdf.get(uk, {}).get("attachment_links", "")
        if not attachment_links and _files(uk):
            try:
                attachment_links = _upload_supporting_docs_to_drive(
                    details.get("pr_number", ""), _files(uk),
                    details.get("requested_by", ""))
                if attachment_links:
                    _user_pdf.setdefault(uk, {})["attachment_links"] = attachment_links
            except Exception as e:
                logger.warning("Manual submit: attachment upload failed (proceeding): %s", e)

        success, message = _submit_to_google_sheet(details, _files(uk), drive_link=drive_link,
                                                    attachment_links=attachment_links)
        status = 200 if success else 500
        return jsonify({"success": success, "message": message}), status

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
