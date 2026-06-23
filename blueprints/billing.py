"""Billing Blueprint — Payment Slip and Cash Voucher PDF generation for Accounting."""

import os
import base64
import logging
from io import BytesIO
from datetime import datetime, timezone

import requests as http_requests
from flask import Blueprint, request, jsonify, send_file

from pdf_generators.payment_slip_pdf import build_payment_slip_pdf
from pdf_generators.cash_voucher_pdf import build_cash_voucher_pdf
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

billing_bp = Blueprint("billing_bp", __name__)

DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")

MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB


def _gs_post(payload: dict) -> dict:
    """POST to Apps Script, following one redirect."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return {"success": False, "message": "DASHBOARD_APPS_SCRIPT_URL not configured"}
    try:
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                   timeout=60, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location")
            if loc:
                resp = http_requests.get(loc, timeout=60)
        return resp.json()
    except Exception as exc:
        logger.error("_gs_post error: %s", exc)
        return {"success": False, "message": str(exc)}


def _gs_get(params: dict) -> dict:
    """GET from Apps Script."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        return {"success": False, "message": "DASHBOARD_APPS_SCRIPT_URL not configured"}
    try:
        resp = http_requests.get(DASHBOARD_APPS_SCRIPT_URL, params=params, timeout=60)
        return resp.json()
    except Exception as exc:
        logger.error("_gs_get error: %s", exc)
        return {"success": False, "message": str(exc)}


def _upload_pdf_to_drive(pdf_bytes: bytes, filename: str, pr_number: str, folder_type: str) -> str:
    """Upload PDF bytes to Google Drive via Apps Script, return drive link."""
    if not DASHBOARD_APPS_SCRIPT_URL or not pdf_bytes:
        return ""
    try:
        payload = {
            "action": "saveBillingPdf",
            "fileBase64": base64.b64encode(pdf_bytes).decode("ascii"),
            "fileName": filename,
            "mimeType": "application/pdf",
            "prNumber": pr_number,
            "folderType": folder_type,   # 'payment_slip' | 'cash_voucher'
        }
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload,
                                   timeout=60, allow_redirects=False)
        if resp.status_code in (301, 302, 303, 307, 308):
            loc = resp.headers.get("Location")
            if loc:
                resp = http_requests.get(loc, timeout=60)
        result = resp.json()
        return result.get("driveLink", "") if result.get("success") else ""
    except Exception as exc:
        logger.warning("_upload_pdf_to_drive failed for %s: %s", filename, exc)
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@billing_bp.route("/mark-paid", methods=["POST"])
def mark_paid():
    """Mark a PR as Paid, generate a Payment Slip PDF, upload to Drive, save link."""
    body = request.get_json(silent=True) or {}
    row_index   = body.get("rowIndex")
    pr_number   = body.get("prNumber", "")
    paid_by     = body.get("paidBy", "")
    details     = body.get("details", {})   # full billing record passed from frontend

    if not row_index or not pr_number:
        return jsonify({"success": False, "message": "rowIndex and prNumber are required"}), 400

    paid_at = datetime.now(timezone.utc).isoformat()

    # 1. Generate Payment Slip PDF
    buf = BytesIO()
    try:
        build_payment_slip_pdf(buf, details, paid_at=paid_at, paid_by=paid_by)
    except Exception as exc:
        logger.error("build_payment_slip_pdf failed: %s", exc)
        return jsonify({"success": False, "message": f"PDF generation failed: {exc}"}), 500

    pdf_bytes = buf.getvalue()
    filename  = f"PaymentSlip_{sanitize_filename(pr_number)}.pdf"

    # 2. Upload to Drive (best-effort)
    drive_link = _upload_pdf_to_drive(pdf_bytes, filename, pr_number, "payment_slip")

    # 3. Update sheet
    gs_result = _gs_post({
        "action":           "markBillPaid",
        "rowIndex":         row_index,
        "paidBy":           paid_by,
        "paymentSlipLink":  drive_link,
    })
    if not gs_result.get("success"):
        return jsonify({"success": False, "message": gs_result.get("message", "Sheet update failed")}), 500

    return jsonify({
        "success":      True,
        "paidAt":       paid_at,
        "paidBy":       paid_by,
        "driveLink":    drive_link,
        "pdfBase64":    base64.b64encode(pdf_bytes).decode("ascii"),
        "filename":     filename,
    })


@billing_bp.route("/download-payment-slip", methods=["POST"])
def download_payment_slip():
    """Re-generate and return a Payment Slip PDF as a file download."""
    body    = request.get_json(silent=True) or {}
    details = body.get("details", {})
    paid_at = body.get("paidAt", "")
    paid_by = body.get("paidBy", "")
    pr_no   = details.get("pr_number") or details.get("prNumber", "slip")

    buf = BytesIO()
    try:
        build_payment_slip_pdf(buf, details, paid_at=paid_at, paid_by=paid_by)
    except Exception as exc:
        logger.error("download_payment_slip failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 500

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"PaymentSlip_{sanitize_filename(pr_no)}.pdf",
    )


@billing_bp.route("/generate-cash-voucher", methods=["POST"])
def generate_cash_voucher():
    """Generate Cash Voucher PDF, upload to Drive, save link + CV number in sheet."""
    body        = request.get_json(silent=True) or {}
    row_index   = body.get("rowIndex")
    pr_number   = body.get("prNumber", "")
    pr_details  = body.get("prDetails", {})
    cv_details  = body.get("cvDetails", {})

    if not row_index or not pr_number:
        return jsonify({"success": False, "message": "rowIndex and prNumber are required"}), 400

    # Auto-assign CV number if not provided
    if not cv_details.get("cv_number"):
        cv_details["cv_number"] = f"CV-{datetime.now().strftime('%Y%m%d')}-{sanitize_filename(pr_number)}"

    buf = BytesIO()
    try:
        build_cash_voucher_pdf(buf, pr_details, cv_details)
    except Exception as exc:
        logger.error("build_cash_voucher_pdf failed: %s", exc)
        return jsonify({"success": False, "message": f"PDF generation failed: {exc}"}), 500

    pdf_bytes = buf.getvalue()
    cv_no     = cv_details["cv_number"]
    filename  = f"CashVoucher_{sanitize_filename(cv_no)}.pdf"

    # Upload to Drive (best-effort)
    drive_link = _upload_pdf_to_drive(pdf_bytes, filename, pr_number, "cash_voucher")

    # Save to sheet
    gs_result = _gs_post({
        "action":           "saveCashVoucher",
        "rowIndex":         row_index,
        "cvNumber":         cv_no,
        "cashVoucherLink":  drive_link,
    })
    if not gs_result.get("success"):
        return jsonify({"success": False, "message": gs_result.get("message", "Sheet update failed")}), 500

    return jsonify({
        "success":      True,
        "cvNumber":     cv_no,
        "driveLink":    drive_link,
        "pdfBase64":    base64.b64encode(pdf_bytes).decode("ascii"),
        "filename":     filename,
    })


@billing_bp.route("/download-cash-voucher", methods=["POST"])
def download_cash_voucher():
    """Re-generate and return a Cash Voucher PDF as a file download."""
    body        = request.get_json(silent=True) or {}
    pr_details  = body.get("prDetails", {})
    cv_details  = body.get("cvDetails", {})
    pr_no       = pr_details.get("pr_number") or pr_details.get("prNumber", "cv")

    buf = BytesIO()
    try:
        build_cash_voucher_pdf(buf, pr_details, cv_details)
    except Exception as exc:
        logger.error("download_cash_voucher failed: %s", exc)
        return jsonify({"success": False, "message": str(exc)}), 500

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"CashVoucher_{sanitize_filename(pr_no)}.pdf",
    )
