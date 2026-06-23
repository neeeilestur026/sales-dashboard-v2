"""Purchase Request Blueprint -- ports the standalone PR app into the unified Flask application."""

import os
import re
import locale
import html
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
    current_app,
)
from PyPDF2 import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    PageBreak,
)
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch

from pdf_generators.pr_pdf import PRDocTemplate
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

pr_bp = Blueprint("pr_bp", __name__, template_folder="../templates")

# ---------------------------------------------------------------------------
# Per-user state (keyed by username to isolate concurrent users)
# ---------------------------------------------------------------------------
_user_items: dict[str, list[dict]] = {}
_user_log: dict[str, list[str]] = {}
_user_pdf: dict[str, dict] = {}

PR_GOOGLE_APPS_SCRIPT_URL = os.environ.get("PR_GOOGLE_APPS_SCRIPT_URL", "")
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


# ---------------------------------------------------------------------------
# Helper: submit to Google Sheets
# ---------------------------------------------------------------------------
def _submit_to_google_sheet(details: dict, items_list: list[dict], pr_sheet_id: str, drive_link: str = ""):
    """POST rows to dashboard Apps Script which writes to the agent's PR sheet."""
    try:
        if not DASHBOARD_APPS_SCRIPT_URL:
            return False, "DASHBOARD_APPS_SCRIPT_URL not configured."
        if not pr_sheet_id:
            return False, "No PR Sheet ID provided."
        if not items_list:
            return False, "No items available to submit."

        rows = []
        for item in items_list:
            row = [
                details.get("company_name", ""),
                details.get("contact_person", ""),
                details.get("reference_number", ""),
                details.get("pr_number_client", ""),
                details.get("pr_date", ""),
                item.get("item_description", ""),
                item.get("model_no", ""),
                item.get("quantity", 0),
                item.get("unit_of_measure", ""),
                item.get("item_remarks", ""),
                "",   # K - Status (set separately)
                "",   # L - Follow Up Date (set separately)
                "",   # M - Unit Price (set by pricing engine)
                "",   # N - Total Price (set by pricing engine)
                drive_link,  # O - Drive Link
            ]
            rows.append(row)

        payload = {
            "action": "savePRToSheet",
            "sheetId": pr_sheet_id,
            "rows": rows,
        }
        logger.info("_submit_to_google_sheet: POSTing %d rows to dashboard script for sheet %s", len(rows), pr_sheet_id[:20])
        response = http_requests.post(
            DASHBOARD_APPS_SCRIPT_URL,
            json=payload,
            timeout=30,
            allow_redirects=False,
        )

        # Google Apps Script typically redirects POST -> 302 -> GET
        if response.status_code in (301, 302, 303, 307, 308):
            redirect_url = response.headers.get("Location")
            if redirect_url:
                response = http_requests.get(redirect_url, timeout=30)

        if response.status_code == 200:
            raw = response.text[:200]
            logger.info("_submit_to_google_sheet: raw response=%s", raw)
            try:
                result = response.json()
                if result.get("success") is False:
                    return False, f"Apps Script error: {result.get('message', 'Unknown error')}"
                return True, f"Submitted {len(rows)} row(s)."
            except Exception:
                return True, f"Submitted {len(rows)} row(s). Raw: {raw}"
        else:
            return False, f"Error submitting: status {response.status_code}"

    except http_requests.exceptions.Timeout:
        return False, "Request timed out. Please try again."
    except Exception as e:
        logger.error("_submit_to_google_sheet error: %s\n%s", e, traceback.format_exc())
        return False, f"Error submitting to Google Sheet: {str(e)}"


# ---------------------------------------------------------------------------
# Helper: upload PR PDF to Google Drive
# ---------------------------------------------------------------------------
def _upload_pr_pdf_to_drive(created_by: str, uk: str) -> str:
    """Upload stored PR PDF to Google Drive and return the drive link."""
    if not DASHBOARD_APPS_SCRIPT_URL:
        logger.warning("_upload_pr_pdf_to_drive: DASHBOARD_APPS_SCRIPT_URL not configured")
        return ""
    user_pdf = _user_pdf.get(uk, {})
    if not user_pdf.get("bytes"):
        logger.warning("_upload_pr_pdf_to_drive: No PDF bytes available for uk=%s", uk)
        return ""
    try:
        import base64 as b64mod
        pdf_b64 = b64mod.b64encode(user_pdf["bytes"]).decode("ascii")
        payload = {
            "action": "savePRPDF",
            "pdfBase64": pdf_b64,
            "fileName": user_pdf.get("filename", "pr.pdf"),
            "creatorName": created_by or "Unknown",
        }
        logger.info("_upload_pr_pdf_to_drive: POSTing %d bytes to %s...", len(pdf_b64), DASHBOARD_APPS_SCRIPT_URL[:60])
        resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=payload, timeout=60)
        logger.info("_upload_pr_pdf_to_drive: Response status=%d", resp.status_code)
        if resp.status_code in (301, 302, 303, 307, 308):
            redir = resp.headers.get("Location")
            logger.info("_upload_pr_pdf_to_drive: Redirecting (GET) to %s", redir[:80] if redir else "None")
            if redir:
                resp = http_requests.get(redir, timeout=60)
                logger.info("_upload_pr_pdf_to_drive: Redirect response status=%d", resp.status_code)
        if resp.status_code == 200:
            result = resp.json()
            logger.info("_upload_pr_pdf_to_drive: result=%s", str(result)[:200])
            if result.get("success"):
                return result.get("driveLink", "")
            else:
                logger.warning("_upload_pr_pdf_to_drive: API returned success=false: %s", result.get("message", ""))
        else:
            logger.warning("_upload_pr_pdf_to_drive: Non-200 response: %d, body=%s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.error("PR Drive upload error: %s\n%s", e, traceback.format_exc())
    return ""
def _format_description(description: str, description_style):
    """Format description text, supporting markdown-like bullets."""
    if not description or not description.strip():
        return Paragraph("", description_style)
    lines = description.splitlines()
    out = []
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            out.append("<br/>")
            continue
        stripped = line.lstrip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            out.append(f"&bull; {html.escape(stripped[2:].strip())}")
        elif re.match(r"^\d+\.\s+", stripped):
            m = re.match(r"^(\d+\.)\s+(.*)$", stripped)
            if m:
                out.append(f"{m.group(1)} {html.escape(m.group(2).strip())}")
            else:
                out.append(html.escape(stripped))
        else:
            leading = len(line) - len(stripped)
            prefix = "&nbsp;" * leading if leading else ""
            out.append(f"{prefix}{html.escape(stripped)}")
    return Paragraph("<br/>".join(out), description_style)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@pr_bp.route("/")
def index():
    """Render the PR generator page."""
    return render_template("pr/index.html")


@pr_bp.route("/add_item", methods=["POST"])
def add_item():
    """Add an item to the current PR item list."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)

    data = request.get_json(force=True)
    item_description = data.get("item_description", "").strip()
    model_no = data.get("model_no", "").strip()
    quantity = data.get("quantity")
    unit_of_measure = data.get("unit_of_measure", "").strip()
    item_remarks = data.get("item_remarks", "").strip()

    try:
        quantity = int(quantity)
        if quantity <= 0:
            log.append("Error: Quantity must be a positive number.")
            return jsonify({"success": False, "output_log": log})
    except (ValueError, TypeError):
        log.append("Error: Invalid quantity.")
        return jsonify({"success": False, "output_log": log})

    if not item_description:
        log.append("Error: Item Description is required.")
        return jsonify({"success": False, "output_log": log})

    item = {
        "item_no": len(items) + 1,
        "item_description": item_description,
        "model_no": model_no,
        "quantity": quantity,
        "unit_of_measure": unit_of_measure,
        "item_remarks": item_remarks,
    }
    items.append(item)
    log.append(f"Success: Item '{item_description}' added.")
    return jsonify({"success": True, "output_log": log, "item": item})


@pr_bp.route("/remove_item/<int:item_no>", methods=["POST"])
def remove_item(item_no):
    """Remove an item by its item number, then re-index."""
    uk = _get_user_key()
    log = _log_reset(uk)
    _user_items[uk] = [i for i in _items(uk) if i["item_no"] != item_no]
    items = _items(uk)
    for idx, i in enumerate(items, 1):
        i["item_no"] = idx
    log.append(f"Success: Removed item {item_no}.")
    return jsonify({"success": True, "items": items, "output_log": log})


@pr_bp.route("/update_item/<int:item_no>", methods=["POST"])
def update_item(item_no):
    """Update an existing item in place. Returns the updated item list."""
    uk = _get_user_key()
    log = _log_reset(uk)
    items = _items(uk)
    target = next((i for i in items if i["item_no"] == item_no), None)
    if target is None:
        log.append(f"Error: Item {item_no} not found.")
        return jsonify({"success": False, "output_log": log})

    data = request.get_json(force=True)
    item_description = (data.get("item_description") or "").strip()
    if not item_description:
        log.append("Error: Item Description is required.")
        return jsonify({"success": False, "output_log": log})
    try:
        quantity = int(data.get("quantity"))
        if quantity <= 0:
            log.append("Error: Quantity must be a positive number.")
            return jsonify({"success": False, "output_log": log})
    except (ValueError, TypeError):
        log.append("Error: Invalid quantity.")
        return jsonify({"success": False, "output_log": log})

    target["item_description"] = item_description
    target["model_no"]         = (data.get("model_no") or "").strip()
    target["quantity"]         = quantity
    target["unit_of_measure"]  = (data.get("unit_of_measure") or "").strip()
    target["item_remarks"]     = (data.get("item_remarks") or "").strip()
    log.append(f"Success: Updated item {item_no}.")
    return jsonify({"success": True, "items": items, "output_log": log})


@pr_bp.route("/reset_items", methods=["POST"])
def reset_items():
    """Clear all items and the output log."""
    uk = _get_user_key()
    _user_items[uk] = []
    log = _log_reset(uk)
    log.append("Success: Items list cleared.")
    return jsonify({"success": True, "output_log": log})


@pr_bp.route("/generate", methods=["POST"])
def generate():
    """Generate a Purchase Request PDF."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)

    try:
        locale.setlocale(locale.LC_ALL, "en_US.UTF-8")
    except locale.Error:
        pass

    def _format_number(n):
        """Thread-safe number formatting without locale."""
        return f"{n:,.2f}"

    if not request.form:
        log.append("Error: No form data provided.")
        return jsonify({"success": False, "message": "No form data provided.", "output_log": log})

    data = request.form.to_dict()
    description_type = data.get("description_type", "short").strip().lower()
    if description_type not in ("short", "long"):
        description_type = "short"

    # ---- Collect form fields ----
    required_fields = [
        "company_name", "company_address", "contact_person",
        "contact_email", "contact_phone", "pr_date", "date_needed",
    ]
    pr_details = {f: data.get(f, "").strip() for f in required_fields}
    pr_details["designation"] = data.get("designation", "").strip()
    pr_details["urgency"] = data.get("urgency", "").strip()
    pr_details["reference_number"] = data.get("reference_number", "").strip()
    pr_details["pr_number_client"] = data.get("pr_number_client", "").strip()
    pr_details["prepared_by_name"] = data.get("prepared_by_name", "").strip()
    pr_details["prepared_by_position"] = data.get("prepared_by_position", "").strip()

    missing = [f for f in required_fields if not pr_details[f]]
    if missing:
        msg = f"Missing fields: {', '.join(missing)}"
        log.append(f"Error: {msg}")
        return jsonify({"success": False, "message": msg, "output_log": log})

    if not items:
        log.append("Error: Please add at least one item.")
        return jsonify({"success": False, "message": "No items.", "output_log": log})

    # ---- Paragraph styles ----
    normal_style = ParagraphStyle(
        name="normal", fontName="Helvetica", fontSize=9,
        leading=12, textColor=colors.black, alignment=0, wordWrap="CJK",
    )
    header_style = ParagraphStyle(
        name="header", fontName="Helvetica-Bold", fontSize=9,
        textColor=colors.black, alignment=1,
    )
    description_style = ParagraphStyle(
        name="description", fontName="Helvetica", fontSize=8,
        leading=10, textColor=colors.black, alignment=0,
        leftIndent=8, wordWrap="CJK",
    )
    sig_label_style = ParagraphStyle(
        name="sig_label", fontName="Helvetica-Bold", fontSize=9,
        textColor=colors.black, alignment=0,
    )
    sig_name_style = ParagraphStyle(
        name="sig_name", fontName="Helvetica", fontSize=9,
        textColor=colors.black, alignment=0,
    )
    sig_pos_style = ParagraphStyle(
        name="sig_pos", fontName="Helvetica-Oblique", fontSize=8,
        textColor=colors.black, alignment=0,
    )
    qty_style = ParagraphStyle(
        name="qty", fontName="Helvetica", fontSize=9,
        textColor=colors.black, alignment=1,
    )

    # ---- Output to memory ----
    company_slug = sanitize_filename(pr_details.get("company_name", "Unknown"))
    ref_slug = sanitize_filename(pr_details.get("reference_number", "NoRef"))
    filename = f"Purchase_Request_{company_slug}_{ref_slug}.pdf"

    try:
        buffer = BytesIO()
        doc = PRDocTemplate(buffer, items_count=len(items), pagesize=A4)
        doc.pr_details = pr_details

        elements = []

        # ---- Build PDF rows ----
        pdf_rows = [
            [
                item["item_no"],
                _format_description(item["item_description"], description_style),
                item.get("model_no", ""),
                Paragraph(str(item["quantity"]), qty_style),
                item.get("unit_of_measure", ""),
                item.get("item_remarks", ""),
            ]
            for item in items
        ]

        # ---- Table builder ----
        def create_item_table(data_rows, per_page):
            header_row = [
                Paragraph("Item No.", header_style),
                Paragraph("Item Description", header_style),
                Paragraph("Model / Part No.", header_style),
                Paragraph("Quantity", header_style),
                Paragraph("Unit", header_style),
                Paragraph("Remarks", header_style),
            ]

            empty_row = [Paragraph("", normal_style)] * 6

            # Scale columns to frame width
            BASE_COL_WIDTHS = [32, 140, 105, 56, 58, 109]
            total_base = sum(BASE_COL_WIDTHS)
            scale = doc.frame_width / float(total_base)
            COL_WIDTHS = [w * scale for w in BASE_COL_WIDTHS]

            DESC_IDX = 1
            DEFAULT_ROW_H = 38.0
            EXTRA_PAD = 6.0
            desc_col_w = COL_WIDTHS[DESC_IDX]

            visible_rows = list(data_rows[:per_page])
            while len(visible_rows) < per_page:
                visible_rows.append(empty_row)

            row_heights = []
            for row in visible_rows:
                desc_obj = row[DESC_IDX]
                try:
                    wrap_w = max(10, desc_col_w - 8)
                    _, h = desc_obj.wrap(wrap_w, 10000) if hasattr(desc_obj, "wrap") else (wrap_w, 0)
                except Exception:
                    h = 0
                row_heights.append(max(DEFAULT_ROW_H, h + EXTRA_PAD))

            table_data = [header_row] + visible_rows
            final_heights = [38.0] + row_heights

            # Trailing empty row
            table_data.append([Paragraph("", normal_style)] * 6)
            final_heights.append(38.0)

            table = Table(table_data, colWidths=COL_WIDTHS, rowHeights=final_heights)
            table.setStyle(TableStyle([
                ("TEXTCOLOR",     (0, 0), (-1, -1), colors.black),
                ("ALIGN",         (0, 0), (-1,  0), "CENTER"),
                ("ALIGN",         (0, 1), ( 0, -2), "CENTER"),
                ("ALIGN",         (1, 1), ( 1, -2), "LEFT"),
                ("ALIGN",         (2, 1), (-1, -2), "CENTER"),
                ("FONTNAME",      (0, 0), (-1,  0), "Helvetica-Bold"),
                ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE",      (0, 0), (-1, -1), 9),
                ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING",   (0, 0), (-1, -1), 4),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                ("TOPPADDING",    (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("BOX",           (0, 0), (-1, -1), 0.5, colors.black),
                ("LINEBELOW",     (0, 0), (-1,  0), 0.5, colors.black),
            ]))

            outer = Table([[table]], colWidths=[doc.frame_width])
            outer.setStyle(TableStyle([
                ("ALIGN",  (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            return outer

        # ---- Signature block ("Prepared by") ----
        prepared_by_name = pr_details.get("prepared_by_name", "")
        prepared_by_position = pr_details.get("prepared_by_position", "")

        sig_line_w = 2.5 * inch
        underline = Table([[""]], colWidths=[sig_line_w], rowHeights=[0.5])
        underline.setStyle(TableStyle([
            ("LINEABOVE",     (0, 0), (-1, 0), 0.5, colors.black),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        sig_inner = Table(
            [
                [Spacer(1, 0.5 * inch)],
                [underline],
                [Spacer(1, 0.04 * inch)],
                [Paragraph(prepared_by_name if prepared_by_name else "&nbsp;", sig_name_style)],
                [Paragraph(prepared_by_position if prepared_by_position else "&nbsp;", sig_pos_style)],
                [Spacer(1, 0.06 * inch)],
                [Paragraph("<b>Prepared by:</b>", sig_label_style)],
            ],
            colWidths=[sig_line_w],
        )
        sig_inner.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        sig_row = Table([[sig_inner]], colWidths=[doc.frame_width])
        sig_row.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "LEFT"),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))

        # ---- Paginate ----
        per_page = 10 if description_type == "short" else 3
        chunks = [pdf_rows[i:i + per_page] for i in range(0, len(pdf_rows), per_page)]

        for idx, chunk in enumerate(chunks):
            is_last = (idx == len(chunks) - 1)
            elements.append(Spacer(1, 0.08 * inch))
            elements.append(create_item_table(chunk, per_page))
            elements.append(Spacer(1, 0.2 * inch))
            if is_last:
                elements.append(Spacer(1, 0.25 * inch))
                elements.append(sig_row)
            if not is_last:
                elements.append(PageBreak())

        doc.build(elements)
        log.append("Success: Purchase Request Form generated.")

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

        # ---- Store PDF bytes ----
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()
        _user_pdf[uk] = {
            "bytes": pdf_bytes,
            "filename": filename,
        }

        # ── Auto-submit: upload PDF to Drive ──
        drive_link = ""
        created_by = request.form.get("created_by", "").strip()
        if DASHBOARD_APPS_SCRIPT_URL:
            try:
                drive_link = _upload_pr_pdf_to_drive(created_by, uk)
                logger.info("PR auto-submit: drive_link=%s", drive_link[:80] if drive_link else "(empty)")
                if drive_link:
                    log.append("Uploaded to Google Drive.")
            except Exception as e:
                logger.warning("PR Drive upload failed: %s", e)

        # ── Auto-submit: save to agent's PR Google Sheet ──
        pr_sheet_id = request.form.get("pr_sheet_id", "").strip()
        if DASHBOARD_APPS_SCRIPT_URL and pr_sheet_id:
            sheet_details = {
                "company_name":     pr_details.get("company_name", ""),
                "contact_person":   pr_details.get("contact_person", ""),
                "reference_number": pr_details.get("reference_number", ""),
                "pr_number_client": pr_details.get("pr_number_client", ""),
                "pr_date":          pr_details.get("pr_date", ""),
                "prepared_by_name": pr_details.get("prepared_by_name", ""),
            }
            try:
                success, message = _submit_to_google_sheet(sheet_details, items, pr_sheet_id, drive_link=drive_link)
                logger.info("PR auto-submit to sheet: success=%s, msg=%s", success, message[:100])
                if success:
                    log.append("Submitted to Google Sheet.")
                else:
                    log.append(f"Warning: Sheet submission issue: {message}")
            except Exception as e:
                logger.warning("PR auto-submit to sheet failed: %s", e)

        buffer = BytesIO(pdf_bytes)
        import json as _json
        response = send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
        response.headers["X-PR-Log"] = _json.dumps(log)
        response.headers["Access-Control-Expose-Headers"] = "X-PR-Log"
        return response

    except Exception as e:
        log.append(f"Error: {str(e)}")
        logger.error("PR PDF generation failed: %s\n%s", e, traceback.format_exc())
        return jsonify({"success": False, "message": str(e), "output_log": log}), 500


@pr_bp.route("/submit_to_sheets", methods=["POST"])
def submit_to_sheets():
    """Submit current PR items to Google Sheets via Apps Script."""
    uk = _get_user_key()
    items = _items(uk)
    log = _log_reset(uk)
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Invalid request format", "output_log": log}), 400
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Empty request", "output_log": log}), 400

        details = {
            "company_name":     data.get("company_name", "").strip(),
            "contact_person":   data.get("contact_person", "").strip(),
            "reference_number": data.get("reference_number", "").strip(),
            "pr_number_client": data.get("pr_number_client", "").strip(),
            "pr_date":          data.get("pr_date", "").strip(),
            "prepared_by_name": data.get("prepared_by_name", "").strip(),
        }

        if not all([details["company_name"], details["pr_date"]]):
            return jsonify({"success": False, "message": "Missing required fields", "output_log": log}), 400
        if not items:
            return jsonify({"success": False, "message": "No items in request", "output_log": log}), 400

        pr_sheet_id = data.get("pr_sheet_id", "").strip()
        success, message = _submit_to_google_sheet(details, items, pr_sheet_id)
        log.append(message)
        status = 200 if success else 500
        return jsonify({"success": success, "message": message, "output_log": log}), status

    except Exception as e:
        log.append(f"Error: {str(e)}")
        return jsonify({"success": False, "message": str(e), "output_log": log}), 500

