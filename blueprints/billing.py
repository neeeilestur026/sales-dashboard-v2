"""Billing Blueprint — Payment Slip and Cash Voucher PDF generation for Accounting."""

import os
import base64
import logging
from io import BytesIO
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_file, g

from pdf_generators.payment_slip_pdf import build_payment_slip_pdf
from pdf_generators.cash_voucher_pdf import build_cash_voucher_pdf
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

billing_bp = Blueprint("billing_bp", __name__)

from blueprints import _config
from blueprints.session_auth import require_session, display_name_for

# A325 — marking a bill paid debits a bank account and feeds the books: accounting, admin and the
# director only (it was any signed-in login). Who paid it comes from the session, not the page.
BILLING_ROLES = ["accounting", "admin", "director"]
from blueprints._upstream import gs_json

DASHBOARD_APPS_SCRIPT_URL = _config.DASHBOARD_APPS_SCRIPT_URL

MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB


def _gs_post(payload: dict) -> dict:
    """POST to Code.gs through the shared upstream client."""
    return gs_json(DASHBOARD_APPS_SCRIPT_URL, json=payload, timeout=60)


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@billing_bp.route("/mark-paid", methods=["POST"])
@require_session(roles=BILLING_ROLES)
def mark_paid():
    """Mark a PR as Paid, generate a Payment Slip PDF, upload to Drive, save link."""
    body = request.get_json(silent=True) or {}
    row_index   = body.get("rowIndex")
    pr_number   = body.get("prNumber", "")
    paid_by     = display_name_for((getattr(g, "session", None) or {}).get("username", "")) or body.get("paidBy", "")
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
    drive_link = ""   # A299: the Drive save called an action no Apps Script has; the slip is returned inline below

    # 2. Update sheet. Code.gs requires bankAccountCode; it is passed through whenever the UI sends it.
    gs_payload = {
        "action":           "markBillPaid",
        "rowIndex":         row_index,
        "paidBy":           paid_by,
        "paymentSlipLink":  drive_link,
    }
    # A321 — the bank's date and, for a foreign request, the pesos the bank took (Code.gs v5 checks both)
    for key in ("bankAccountCode", "valueDate", "amountPHP"):
        if body.get(key):
            gs_payload[key] = str(body.get(key))
    gs_result = _gs_post(gs_payload)
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
@require_session()
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
@require_session(roles=BILLING_ROLES)
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
    drive_link = ""   # A299: see mark_paid

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

