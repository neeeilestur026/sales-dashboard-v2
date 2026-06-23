"""Quotation Generator Blueprint -- ports the standalone quotation app into the unified Flask application."""

import os
import re
import logging
import traceback
from datetime import datetime

import requests as http_requests
import pandas as pd
from flask import (
    Blueprint,
    render_template,
    request,
    send_file,
    jsonify,
    current_app,
)
import base64
from io import BytesIO

from PIL import Image as PILImage
from PyPDF2 import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader

from pdf_generators.quotation_pdf import QuotationDocTemplate
from pdf_generators.utils import sanitize_filename

logger = logging.getLogger(__name__)

quotation_bp = Blueprint("quotation_bp", __name__, template_folder="../templates")

QUOTATION_GOOGLE_APPS_SCRIPT_URL = os.environ.get("QUOTATION_GOOGLE_APPS_SCRIPT_URL", "")
DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")

# ---------------------------------------------------------------------------
# Module-level state — PER-USER (keyed by username from request)
# ---------------------------------------------------------------------------
_user_items: dict[str, list[dict]] = {}
_user_images: dict[str, dict[int, bytes]] = {}
_user_log: dict[str, list[str]] = {}
_user_pdf: dict[str, dict] = {}
_user_submission: dict[str, dict] = {}


def _get_user_key():
    """Extract user key from any request type (header, query, form, or JSON body)."""
    return (request.headers.get('X-User-Key', '') or
            request.args.get('user_key', '') or
            (request.get_json(silent=True) or {}).get('user_key', '') or
            request.form.get('user_key', '') or
            'anonymous')


def _items(uk): return _user_items.setdefault(uk, [])
def _images(uk): return _user_images.setdefault(uk, {})
def _log_reset(uk): _user_log[uk] = []; return _user_log[uk]
def _log(uk): return _user_log.setdefault(uk, [])

# ---------------------------------------------------------------------------
# Principal data
# ---------------------------------------------------------------------------
principals_data = [
    {"Principal": "CEJN", "Origin": "Singapore", "Currency": "SGD", "Forex": 55, "Shipping and Duties": 15, "ExcelFile": "listCejn.xlsx"},
    {"Principal": "SPX POWERTEAM", "Origin": "Singapore", "Currency": "USD", "Forex": 62, "Shipping and Duties": 30, "ExcelFile": "listSPX.xlsx"},
    {"Principal": "Others", "Origin": "Philippines", "Currency": "PHP", "Forex": 1, "Shipping and Duties": 0.1, "ExcelFile": None},
]
principals_df = pd.DataFrame(principals_data)

# Global data caches (loaded via /load_data)
destinations_df = None
products_by_principal: dict = {}

# TTL cache for _load_excel_data — avoids re-parsing Excel on every form open
import time as _time
_load_data_cache: dict = {"ts": 0, "result": None}
_LOAD_DATA_TTL = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_valid_pdf(file):
    """Check if the uploaded file is a valid PDF."""
    try:
        file.seek(0)
        PdfReader(file)
        file.seek(0)
        return True
    except Exception:
        return False


def is_valid_image(file):
    """Check if the uploaded file is a valid image (PNG, JPEG, JPG)."""
    try:
        valid_types = ['image/png', 'image/jpeg', 'image/jpg']
        if file.content_type not in valid_types:
            return False
        img = PILImage.open(file)
        img.verify()
        file.seek(0)
        return True
    except Exception:
        return False


def _build_quotation_json(details: dict, items: list[dict]) -> str:
    """Serialize form fields + items as JSON for persistence in Google Sheets column P.

    Strips image_data_url from items (too large for cell storage).
    Truncates item descriptions if total JSON exceeds 45K chars.
    """
    import json as _json

    clean_items = []
    for it in items:
        clean = {k: v for k, v in it.items() if k != "image_data_url"}
        clean_items.append(clean)

    blob = {
        "form": {
            "clientName": details.get("client_name", ""),
            "clientAddress": details.get("client_address", ""),
            "attention": details.get("attention", ""),
            "clientDesignation": details.get("client_designation", ""),
            "clientEmail": details.get("client_email", ""),
            "subject": details.get("subject", ""),
            "referenceNo": details.get("reference_no", ""),
            "referenceRfqNo": details.get("reference_rfq_no", ""),
            "quotationDate": details.get("quotation_date", ""),
            "sigName": details.get("sig_name", ""),
            "sigDesignation": details.get("sig_designation", ""),
            "sigViber": details.get("sig_viber", ""),
            "sigMobile": details.get("sig_mobile", ""),
            "sigEmail": details.get("sig_email", ""),
            "principal": details.get("principal", ""),
            "destination": details.get("destination", ""),
            "discountPercentage": details.get("discount_percentage", ""),
            "vatOption": details.get("vat_option", ""),
            "descMode": details.get("desc_mode", ""),
            "note": details.get("note", ""),
        },
        "terms": {
            "validity": details.get("validity", ""),
            "delivery": details.get("delivery", ""),
            "payment": details.get("payment", ""),
            "warranty": details.get("warranty", ""),
        },
        "items": clean_items,
    }
    result = _json.dumps(blob, ensure_ascii=False)
    # Safety: truncate descriptions if approaching Google Sheets cell limit
    if len(result) > 45000:
        for ci in clean_items:
            if ci.get("description") and len(ci["description"]) > 100:
                ci["description"] = ci["description"][:100] + "..."
        result = _json.dumps(blob, ensure_ascii=False)
    return result


def _load_excel_data():
    """Load destinations and product data from Excel files in DATA_DIR.

    Results are cached for _LOAD_DATA_TTL seconds to avoid re-parsing
    Excel files on every form open (~200-500ms saved per call).
    """
    global destinations_df, products_by_principal, _load_data_cache

    now = _time.time()
    if (now - _load_data_cache["ts"]) < _LOAD_DATA_TTL and _load_data_cache["result"] is not None:
        cached = _load_data_cache["result"]
        destinations_df = cached["destinations_df"]
        products_by_principal = cached["products_by_principal"]
        return cached["output_log"], cached["success"], cached["product_codes"], cached["product_price_types"]

    data_dir = current_app.config["DATA_DIR"]
    output_log = []
    product_codes = {}
    product_price_types = {}

    # Load destinations
    dest_path = os.path.join(data_dir, "Destination.xlsx")
    try:
        destinations_df = pd.read_excel(dest_path, sheet_name="Sheet1")
        destinations_df.columns = [str(col).replace("\n", " ").strip() for col in destinations_df.columns]
        destinations_df.rename(columns={
            next(col for col in destinations_df.columns if col in ["Destination", "Dest", "Location"]): "Destination",
            next(col for col in destinations_df.columns if col in ["CBM", "Cubic Meter", "Volume"]): "CBM",
            next(col for col in destinations_df.columns if col in ["Minimum Charge", "Min Charge", "MinimumCharge", "MinCharge", "MINIMUM CHARGE"]): "Minimum Charge"
        }, inplace=True)
        output_log.append(f"Loaded {len(destinations_df)} destinations successfully.")
    except FileNotFoundError:
        output_log.append(f"Error: {dest_path} file not found.")
        return output_log, False, product_codes, product_price_types
    except Exception as e:
        output_log.append(f"Error loading destinations: {str(e)}")
        return output_log, False, product_codes, product_price_types

    # Load products for each principal
    for principal in principals_df["Principal"]:
        excel_file = principals_df[principals_df["Principal"] == principal]["ExcelFile"].iloc[0]
        if excel_file and not (isinstance(excel_file, float) and pd.isna(excel_file)) and str(excel_file).strip():
            excel_path = os.path.join(data_dir, excel_file)
            try:
                df = pd.read_excel(excel_path, sheet_name="Sheet1", header=None)
                df.columns = ["Product Code", "Product Price", "Product Name"]
                products_by_principal[principal] = df
                product_codes[principal] = [
                    str(c) for c in df["Product Code"].tolist()
                    if c and not (isinstance(c, float) and pd.isna(c))
                ]
                product_price_types[principal] = {
                    str(code): "POR" if str(price).strip().upper() == "POR" or pd.isna(price) or str(price).strip() == ""
                    else "numeric"
                    for code, price in zip(df["Product Code"], df["Product Price"])
                    if code and not (isinstance(code, float) and pd.isna(code))
                }
                output_log.append(f"Loaded {len(df)} products from {excel_file} for {principal} successfully.")
            except FileNotFoundError:
                output_log.append(f"Error: {excel_file} file not found for {principal}.")
                return output_log, False, product_codes, product_price_types
            except Exception as e:
                output_log.append(f"Error loading products from {excel_file} for {principal}: {str(e)}")
                return output_log, False, product_codes, product_price_types
        else:
            products_by_principal[principal] = None
            product_price_types[principal] = {}
            output_log.append(f"No product Excel file for {principal}. Use manual item input.")

    # Cache the parsed result for _LOAD_DATA_TTL seconds
    _load_data_cache.update({
        "ts": _time.time(),
        "result": {
            "output_log": output_log,
            "success": True,
            "product_codes": product_codes,
            "product_price_types": product_price_types,
            "destinations_df": destinations_df,
            "products_by_principal": products_by_principal,
        },
    })

    return output_log, True, product_codes, product_price_types


def calculate_selling_price_vat(product_price, forex, shipping_duties, cbm_rate, user_cbm, quantity):
    """Calculate selling price with VAT for a product.

    - Convert product price (foreign currency) to PHP per unit.
    - Compute brokerage/freight per unit (percentage of price_bought_peso_per_unit).
    - Compute landed cost per unit = price + brokerage_per_unit.
    - Compute delivery cost per unit = user_cbm * cbm_rate.
    - Total COGS per unit = landed_cost_per_unit + delivery_cost_per_unit.
    - Selling price per unit = total_cogs_per_unit / 0.90
    - Total price (for quantity) = selling_price_per_unit * quantity
    """
    price_bought_peso_per_unit = float(product_price) * float(forex)
    brokerage_freight_per_unit = price_bought_peso_per_unit * (float(shipping_duties) / 100.0)
    landed_cost_per_unit = price_bought_peso_per_unit + brokerage_freight_per_unit
    delivery_cost_per_unit = float(user_cbm) * float(cbm_rate)
    total_cogs_per_unit = landed_cost_per_unit + delivery_cost_per_unit
    selling_price_per_unit = total_cogs_per_unit / 0.90
    total_price = selling_price_per_unit * int(quantity)

    return {
        "Price Bought in Peso Per Unit": price_bought_peso_per_unit,
        "Brokerage Freight Per Unit": brokerage_freight_per_unit,
        "Landed Cost Per Unit": landed_cost_per_unit,
        "Delivery Cost Per Unit": delivery_cost_per_unit,
        "Total COGS Per Unit": total_cogs_per_unit,
        "selling_price_per_unit": selling_price_per_unit,
        "total_price": total_price,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@quotation_bp.route("/")
def index():
    """Render the quotation generator page."""
    return render_template(
        "quotation/index.html",
        principals=principals_df["Principal"].tolist(),
    )


@quotation_bp.route("/load_data", methods=["GET", "POST"])
def load_data_route():
    """Load data and return destinations and product codes.

    Only returns product codes for the requested principal to keep the
    response under Render's 96KB proxy buffer limit. Sending all principals'
    product codes at once caused "Unterminated string in JSON at position 98304".
    """
    output_log, success, product_codes, product_price_types = _load_excel_data()
    destinations = (
        [str(d) for d in destinations_df["Destination"].tolist()
         if d and not (isinstance(d, float) and pd.isna(d))]
        if destinations_df is not None else []
    )

    # Filter to only the requested principal's codes — avoids 96KB response limit
    data = request.get_json(silent=True) or {}
    selected_principal = (
        data.get("principal")
        or request.form.get("principal")
        or request.args.get("principal")
        or ""
    )
    if selected_principal and selected_principal in product_codes:
        filtered_codes = {selected_principal: product_codes[selected_principal]}
        filtered_types = {selected_principal: product_price_types.get(selected_principal, {})}
    else:
        # Fallback: return all (only for GET/no-principal calls from page init)
        filtered_codes = product_codes
        filtered_types = product_price_types

    return jsonify({
        "output_log": output_log,
        "success": success,
        "destinations": destinations,
        "product_codes": filtered_codes,
        "product_price_types": filtered_types,
    })


@quotation_bp.route("/add_item", methods=["POST"])
def add_item():
    """Add an item to the quotation with optional image."""
    global destinations_df, products_by_principal
    uk = _get_user_key()
    items = _items(uk)
    images = _images(uk)
    output_log = _log_reset(uk)

    product_code = request.form.get("product_code")
    user_cbm = request.form.get("cbm")
    quantity = request.form.get("quantity")
    selected_principal = request.form.get("principal")
    selected_destination = request.form.get("destination")
    user_product_price = request.form.get("product_price")
    input_mode = request.form.get("input_mode", "excel")
    product_name = request.form.get("product_name")
    description = request.form.get("description", "")
    item_image = request.files.get("item_image")

    # Check data is loaded first so users get the actionable error instead of
    # a confusing "Invalid CBM" when the real issue is unloaded Excel data.
    if destinations_df is None:
        output_log.append("Error: Destinations data not loaded. Please load data first.")
        return jsonify({"success": False, "output_log": output_log})

    # Validate inputs
    try:
        user_cbm = float(user_cbm)
        quantity = int(quantity)
        if user_cbm <= 0 or quantity <= 0:
            output_log.append("Error: CBM and quantity must be positive numbers.")
            return jsonify({"success": False, "output_log": output_log})
    except (ValueError, TypeError):
        output_log.append("Error: Invalid CBM or quantity. Please enter valid numbers.")
        return jsonify({"success": False, "output_log": output_log})

    # Validate principal
    principal_data = principals_df[principals_df["Principal"] == selected_principal]
    if principal_data.empty:
        output_log.append(f"Error: Principal '{selected_principal}' not found.")
        return jsonify({"success": False, "output_log": output_log})
    principal_data = principal_data.iloc[0]
    forex = principal_data["Forex"]
    shipping_duties = principal_data["Shipping and Duties"]
    excel_file = principal_data["ExcelFile"]

    # Validate destination
    destination_data = destinations_df[destinations_df["Destination"] == selected_destination]
    if destination_data.empty:
        output_log.append(f"Error: Destination '{selected_destination}' not found.")
        return jsonify({"success": False, "output_log": output_log})
    destination_data = destination_data.iloc[0]
    cbm_rate = destination_data["CBM"]

    # Handle image upload
    image_data_url = None
    item_no = len(items) + 1
    if item_image and item_image.filename:
        if not is_valid_image(item_image):
            output_log.append(f"Error: Invalid image file '{item_image.filename}'. Must be PNG, JPEG, or JPG.")
            return jsonify({"success": False, "output_log": output_log})

        # Check file size
        try:
            item_image.seek(0, os.SEEK_END)
            file_size = item_image.tell()
            item_image.seek(0)
            if file_size > 5 * 1024 * 1024:  # 5MB limit
                output_log.append(f"Error: Image file '{item_image.filename}' exceeds 5MB limit.")
                return jsonify({"success": False, "output_log": output_log})
        except Exception as e:
            output_log.append(f"Error: Failed to check image size for '{item_image.filename}': {str(e)}")
            return jsonify({"success": False, "output_log": output_log})

        try:
            image_bytes = item_image.read()
            images[item_no] = image_bytes
            image_data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode()
            output_log.append(f"Success: Image '{item_image.filename}' stored successfully.")
        except Exception as e:
            output_log.append(f"Error: Failed to read image '{item_image.filename}': {str(e)}")
            return jsonify({"success": False, "output_log": output_log})

    # Process product details
    if excel_file and input_mode == "excel":
        products_df = products_by_principal.get(selected_principal)
        if products_df is None:
            output_log.append(f"Error: Product data not loaded for {selected_principal}.")
            return jsonify({"success": False, "output_log": output_log})
        product_row = products_df[products_df["Product Code"].astype(str).str.lower() == str(product_code).lower()]
        if product_row.empty:
            output_log.append(f"Error: Product code '{product_code}' not found for {selected_principal}.")
            return jsonify({"success": False, "output_log": output_log})
        product_name = product_row.iloc[0]["Product Name"]
        product_price_raw = str(product_row.iloc[0]["Product Price"]).strip()
        logger.info(f"Processing product {product_code} with price raw: {product_price_raw}")

        if product_price_raw.upper() == "POR" or product_price_raw == "" or pd.isna(product_row.iloc[0]["Product Price"]):
            if user_product_price is None:
                logger.warning(f"Error: No product price provided for POR or blank product {product_code}")
                output_log.append(f"Error: Product price required for '{product_code}' (POR or blank).")
                return jsonify({"success": False, "output_log": output_log})
            try:
                product_price = float(user_product_price)
                if product_price <= 0:
                    raise ValueError
                total_amount = product_price
                total_unit_price = total_amount * quantity
            except (ValueError, TypeError):
                logger.warning(f"Error: Invalid product price {user_product_price} for POR or blank product {product_code}")
                output_log.append("Error: Invalid product price for POR or blank product. Please enter a positive number.")
                return jsonify({"success": False, "output_log": output_log})
        else:
            try:
                product_price = float(product_price_raw)
                calc_results = calculate_selling_price_vat(product_price, forex, shipping_duties, cbm_rate, user_cbm, quantity)
                total_amount = calc_results["selling_price_per_unit"]
                total_unit_price = calc_results["total_price"]
            except (ValueError, TypeError, KeyError) as e:
                logger.warning(f"Error: Invalid product price '{product_price_raw}' for {product_code}: {e}")
                output_log.append(f"Error: Invalid product price '{product_price_raw}' for '{product_code}'.")
                return jsonify({"success": False, "output_log": output_log})
    else:
        # Manual input mode or "Others" principal
        try:
            product_price = float(user_product_price)
            if product_price <= 0:
                raise ValueError
            total_amount = product_price
            total_unit_price = total_amount * quantity
        except (ValueError, TypeError):
            output_log.append(f"Error: Invalid product price for '{selected_principal}'. Please enter a valid positive number.")
            return jsonify({"success": False, "output_log": output_log})

    output_log.append(f"Success: Item '{product_name}' (Code: {product_code}) added successfully.")
    item = {
        "item_no": item_no,
        "product_name": product_name,
        "product_code": product_code,
        "cbm": user_cbm,
        "total_amount": total_amount,
        "quantity": quantity,
        "total_unit_price": total_unit_price,
        "description": description,
        "image_data_url": image_data_url,
    }
    items.append(item)

    response = {"success": True, "output_log": output_log, "item": item, "items": items}
    logger.info(f"add_item response: item_no={item['item_no']}")
    return jsonify(response)


@quotation_bp.route("/remove_item/<int:item_no>", methods=["POST"])
def remove_item(item_no):
    """Remove an item from the quotation and delete its image if present."""
    uk = _get_user_key()
    items = _items(uk)
    images = _images(uk)
    output_log = _log_reset(uk)

    if item_no in images:
        del images[item_no]
        output_log.append(f"Success: Removed image for item {item_no}.")

    _user_items[uk] = [item for item in items if item["item_no"] != item_no]
    items = _items(uk)
    # Renumber items and rebuild image store with new keys
    new_image_store = {}
    for idx, item in enumerate(items, 1):
        old_no = item["item_no"]
        if old_no in images:
            new_image_store[idx] = images[old_no]
        item["item_no"] = idx
    images.clear()
    images.update(new_image_store)
    output_log.append(f"Success: Removed item {item_no}.")
    return jsonify({"success": True, "items": items, "output_log": output_log})


@quotation_bp.route("/clear_items", methods=["POST"])
def clear_items():
    """Clear all items and attempt to delete uploaded images."""
    uk = _get_user_key()
    output_log = _log_reset(uk)
    try:
        _user_images[uk] = {}
        _user_items[uk] = []
        output_log.append("Success: Cleared all items.")
        return jsonify({"success": True, "items": [], "output_log": output_log})
    except Exception as e:
        logger.error(f"clear_items: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@quotation_bp.route("/attach_item_image", methods=["POST"])
def attach_item_image():
    """Attach or replace an image for an existing item. Accepts multipart/form-data."""
    uk = _get_user_key()
    items = _items(uk)
    images = _images(uk)
    output_log = _log(uk)
    try:
        item_no = request.form.get("item_no")
        if item_no is None:
            return jsonify({"success": False, "message": "item_no required"}), 400
        item_no = int(item_no)

        idx = next((i for i, it in enumerate(items) if it.get("item_no") == item_no), None)
        if idx is None:
            return jsonify({"success": False, "message": f"Item {item_no} not found"}), 404

        item_image = request.files.get("item_image")
        if not item_image:
            return jsonify({"success": False, "message": "No image file provided"}), 400

        # Validate image
        fname = item_image.filename or ""
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        if ext not in ("png", "jpg", "jpeg"):
            return jsonify({"success": False, "message": "Only PNG/JPEG images allowed"}), 400

        img_bytes = item_image.read()
        if len(img_bytes) > 5 * 1024 * 1024:
            return jsonify({"success": False, "message": "Image must be under 5MB"}), 400

        # Store in _user_images
        images[item_no] = img_bytes

        # Build data URL for frontend preview
        import base64
        mime = "image/png" if ext == "png" else "image/jpeg"
        data_url = f"data:{mime};base64,{base64.b64encode(img_bytes).decode()}"
        items[idx]["image_data_url"] = data_url

        output_log.append(f"Image attached to item {item_no}.")
        return jsonify({"success": True, "items": items, "output_log": output_log})
    except Exception as e:
        logger.error(f"attach_item_image: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@quotation_bp.route("/update_item", methods=["POST"])
def update_item():
    """Update an existing item identified by item_no. Accepts JSON payload."""
    uk = _get_user_key()
    items = _items(uk)
    output_log = _log(uk)
    try:
        data = request.get_json() or {}
        item_no = data.get("item_no")
        if item_no is None:
            return jsonify({"success": False, "message": "item_no required"}), 400
        try:
            item_no = int(item_no)
        except Exception:
            return jsonify({"success": False, "message": "invalid item_no"}), 400

        idx = next((i for i, it in enumerate(items) if it.get("item_no") == item_no), None)
        if idx is None:
            return jsonify({"success": False, "message": f"Item {item_no} not found"}), 404

        # Update allowed fields
        it = items[idx]
        for field in ["product_name", "product_code", "description"]:
            if field in data:
                it[field] = data[field]
        # numeric fields with safe conversion
        if "cbm" in data:
            try:
                it["cbm"] = float(data["cbm"])
            except Exception:
                pass
        if "quantity" in data:
            try:
                it["quantity"] = int(data["quantity"])
            except Exception:
                pass
        if "total_amount" in data:
            try:
                it["total_amount"] = float(data["total_amount"])
            except Exception:
                pass
        if "total_unit_price" in data:
            try:
                it["total_unit_price"] = float(data["total_unit_price"])
            except Exception:
                pass

        items[idx] = it
        # Always recalculate total_unit_price for consistency
        it["total_unit_price"] = it.get("total_amount", 0) * it.get("quantity", 1)
        output_log.append(f"Success: Updated item {item_no}.")
        return jsonify({"success": True, "items": items, "item": it, "output_log": output_log})
    except Exception as e:
        logger.error(f"update_item: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


def _get_next_quotation_number() -> tuple[int, int]:
    """Fetch and atomically increment the central quotation counter.

    Returns (year, count). Retries once on failure. count=0 means failure.
    """
    if not DASHBOARD_APPS_SCRIPT_URL:
        logger.warning("_get_next_quotation_number: DASHBOARD_APPS_SCRIPT_URL not configured")
        return datetime.now().year, 0

    import time as _time

    for attempt in range(2):
        try:
            resp = http_requests.get(
                DASHBOARD_APPS_SCRIPT_URL,
                params={"action": "getNextQuotationNumber"},
                timeout=30, allow_redirects=False,
            )
            logger.info("_get_next_quotation_number: attempt=%d status=%d", attempt + 1, resp.status_code)
            if resp.status_code in (301, 302, 303, 307, 308):
                redir = resp.headers.get("Location")
                if redir:
                    resp = http_requests.get(redir, timeout=30)
                    logger.info("_get_next_quotation_number: redirect status=%d", resp.status_code)
            if resp.status_code == 200:
                result = resp.json()
                logger.info("_get_next_quotation_number: result=%s", str(result)[:200])
                if result.get("success"):
                    return int(result["year"]), int(result["count"])
                else:
                    logger.warning("_get_next_quotation_number: API returned success=false: %s", result.get("message", ""))
            else:
                logger.warning("_get_next_quotation_number: non-200 status=%d, body=%s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.warning("Failed to get next quotation number (attempt %d): %s", attempt + 1, e)
        if attempt == 0:
            _time.sleep(1)

    return datetime.now().year, 0


def _upload_pdf_to_drive(agent_name: str, uk: str) -> str:
    """Upload last_generated_pdf to Google Drive and return drive link (or empty string).

    Retries once on failure to handle transient GAS timeouts.
    """
    if not DASHBOARD_APPS_SCRIPT_URL:
        logger.warning("_upload_pdf_to_drive: DASHBOARD_APPS_SCRIPT_URL not configured")
        return ""
    user_pdf = _user_pdf.get(uk, {})
    if not user_pdf.get("bytes"):
        logger.warning("_upload_pdf_to_drive: No PDF bytes available")
        return ""

    import base64 as b64mod
    pdf_b64 = b64mod.b64encode(user_pdf["bytes"]).decode("ascii")
    drive_payload = {
        "action": "saveQuotationPDF",
        "pdfBase64": pdf_b64,
        "fileName": user_pdf.get("filename", "quotation.pdf"),
        "agentName": agent_name or "Unknown",
        "quotationNumber": user_pdf.get("quotation_number", ""),
    }

    for attempt in range(2):
        try:
            logger.info("_upload_pdf_to_drive: attempt=%d POSTing %d bytes (~%.1f KB) to %s...",
                        attempt + 1, len(pdf_b64), len(pdf_b64) / 1024, DASHBOARD_APPS_SCRIPT_URL[:60])
            drive_resp = http_requests.post(DASHBOARD_APPS_SCRIPT_URL, json=drive_payload,
                                             timeout=90, allow_redirects=False)
            logger.info("_upload_pdf_to_drive: Initial response status=%d", drive_resp.status_code)
            # Google Apps Script often returns 302 after a POST — follow the redirect as GET
            if drive_resp.status_code in (301, 302, 303, 307, 308):
                redir = drive_resp.headers.get("Location")
                logger.info("_upload_pdf_to_drive: Redirecting (GET) to %s", redir[:80] if redir else "None")
                if redir:
                    drive_resp = http_requests.get(redir, timeout=90)
                    logger.info("_upload_pdf_to_drive: Redirect response status=%d", drive_resp.status_code)
            if drive_resp.status_code == 200:
                try:
                    drive_result = drive_resp.json()
                except Exception:
                    logger.warning("_upload_pdf_to_drive: Could not parse JSON, body=%s", drive_resp.text[:300])
                    if attempt == 0:
                        _time.sleep(2)
                        continue
                    return ""
                logger.info("_upload_pdf_to_drive: result=%s", str(drive_result)[:200])
                if drive_result.get("success"):
                    link = drive_result.get("driveLink", "")
                    if not link:
                        logger.warning("_upload_pdf_to_drive: success=true but driveLink is empty")
                    return link
                else:
                    logger.warning("_upload_pdf_to_drive: API returned success=false: %s", drive_result.get("message", ""))
                    if attempt == 0:
                        _time.sleep(2)
                        continue
            else:
                logger.warning("_upload_pdf_to_drive: Non-200 response: %d, body=%s",
                               drive_resp.status_code, drive_resp.text[:300])
                if attempt == 0:
                    _time.sleep(2)
                    continue
        except Exception as e:
            logger.error("Drive PDF upload error (attempt %d): %s\n%s", attempt + 1, e, traceback.format_exc())
            if attempt == 0:
                _time.sleep(2)
                continue
    return ""


@quotation_bp.route("/generate", methods=["POST"])
def generate():
    """Generate a quotation PDF with items, images, and optional brochures."""
    global destinations_df
    uk = _get_user_key()
    items = _items(uk)
    images = _images(uk)
    output_log = _log_reset(uk)

    try:
        def format_number(n):
            try:
                return f"{float(n):,.2f}"
            except Exception:
                return str(n)

        if request.is_json:
            data = request.get_json() or {}
        elif request.form:
            data = request.form.to_dict()
            # revision_context arrives as a JSON string from FormData
            rc = data.get("revision_context")
            if rc and isinstance(rc, str):
                try:
                    import json as json_mod
                    data["revision_context"] = json_mod.loads(rc)
                except Exception:
                    data["revision_context"] = None
        else:
            output_log.append("Error: No form data provided.")
            return jsonify({"success": False, "message": "No form data provided.", "output_log": output_log})

        note = data.get("note", "").strip()
        desc_mode = data.get("desc_mode", "short").strip().lower()
        selected_principal = data.get("principal")
        selected_destination = data.get("destination")
        vat_option = data.get("vat_option", "inclusive")
        discount_percentage = data.get("discount_percentage", "")
        client_details = {
            "client_name": data.get("client_name", ""),
            "client_address": data.get("client_address", ""),
            "attention": data.get("attention", ""),
            "designation": data.get("designation", ""),
            "email": data.get("email", ""),
            "subject": data.get("subject", ""),
            "reference_no": data.get("reference_no", ""),
            "reference_rfq_no": data.get("reference_rfq_no", ""),
            "quotation_date": data.get("quotation_date", ""),
            # Accept both sig_* (from JS JSON) and signature_* (from form)
            "signature_name": data.get("sig_name") or data.get("signature_name", ""),
            "signature_designation": data.get("sig_designation") or data.get("signature_designation", ""),
            "signature_viber": data.get("sig_viber") or data.get("signature_viber", ""),
            "signature_mobile": data.get("sig_mobile") or data.get("signature_mobile", ""),
            "signature_email": data.get("sig_email") or data.get("signature_email", ""),
        }

        # Fail fast on empty cart BEFORE any network calls (Google Apps Script
        # counter fetch below can take several seconds).
        if not items:
            output_log.append("Error: Please add at least one item.")
            return jsonify({"success": False, "message": "Please add at least one item.", "output_log": output_log})

        discount_amount = 0
        if discount_percentage:
            try:
                discount_percentage = float(discount_percentage)
                if not 0 <= discount_percentage <= 100:
                    output_log.append("Error: Discount percentage must be between 0 and 100.")
                    return jsonify({"success": False, "message": "Invalid discount percentage.", "output_log": output_log})
            except (ValueError, TypeError):
                output_log.append("Error: Invalid discount percentage. Please enter a valid number.")
                return jsonify({"success": False, "message": "Invalid discount percentage.", "output_log": output_log})

        # Auto-generate reference number: YYYY-NNN-suffix
        is_revision = bool(data.get("revision_context"))
        if not is_revision:
            ref_suffix = data.get("reference_no", "").strip()
            year, count = _get_next_quotation_number()
            if count > 0:
                auto_ref = f"{year}-{count:03d}-{ref_suffix}" if ref_suffix else f"{year}-{count:03d}"
            else:
                output_log.append("Error: Could not generate quotation number. Please try again.")
                return jsonify({"success": False, "message": "Could not generate quotation number. Please try again.", "output_log": output_log})
            client_details["reference_no"] = auto_ref
            data["reference_no"] = auto_ref

        terms_and_conditions = {
            "validity": data.get("validity", ""),
            "delivery": data.get("delivery", ""),
            "payment": data.get("payment", ""),
            "warranty": data.get("warranty", "1 year warranty against factory defect"),
        }

        principal_data = principals_df[principals_df["Principal"] == selected_principal]
        if principal_data.empty:
            output_log.append(f"Error: Principal '{selected_principal}' not found.")
            return jsonify({"success": False, "message": f"Principal '{selected_principal}' not found.", "output_log": output_log})

        if destinations_df is None:
            output_log.append("Error: Destinations not loaded.")
            return jsonify({"success": False, "message": "Destinations not loaded.", "output_log": output_log})

        destination_data = destinations_df[destinations_df["Destination"] == selected_destination]
        if destination_data.empty:
            output_log.append(f"Error: Destination '{selected_destination}' not found.")
            return jsonify({"success": False, "message": f"Destination '{selected_destination}' not found.", "output_log": output_log})
        destination_data = destination_data.iloc[0]
        cbm_rate = destination_data["CBM"]
        minimum_charge = destination_data["Minimum Charge"]

        total_volume = sum(item["cbm"] * item["quantity"] for item in items)
        total_unit_price_sum = sum(item["total_unit_price"] for item in items)
        freight_cost = max(total_volume, minimum_charge)
        total_amount_vat_exclusive = total_unit_price_sum

        if discount_percentage:
            discount_amount = total_amount_vat_exclusive * (discount_percentage / 100)
            discounted_total = total_amount_vat_exclusive - discount_amount
        else:
            discounted_total = total_amount_vat_exclusive

        vat_inclusive = discounted_total * 0.12
        total_amount_vat_inclusive = discounted_total + vat_inclusive

        # Build summary table data for the PDF (Paragraph objects)
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.platypus import (
            Paragraph, Table, TableStyle, Image, Spacer, PageBreak,
        )
        from reportlab.lib import colors
        from reportlab.lib.units import inch
        from reportlab.lib.pagesizes import A4

        header_style = ParagraphStyle(
            name="header",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=colors.black,
            alignment=1,
        )
        normal_style = ParagraphStyle(
            name="normal",
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.black,
            alignment=1,
        )

        summary_table_data = [
            [
                Paragraph("Total Amount VAT Exclusive", header_style),
                Paragraph(f"PHP {format_number(total_amount_vat_exclusive)}", normal_style),
            ]
        ]
        if discount_percentage:
            summary_table_data.append([
                Paragraph(f"Discount ({discount_percentage:.1f}%)", header_style),
                Paragraph(f"PHP {format_number(discount_amount)}", normal_style),
            ])
        if vat_option == "inclusive":
            if not discount_percentage:
                summary_table_data.append([
                    Paragraph("VAT Inclusive (12%)", header_style),
                    Paragraph(f"PHP {format_number(vat_inclusive)}", normal_style),
                ])
            summary_table_data.append([
                Paragraph("Total Amount VAT Inclusive (12%)", header_style),
                Paragraph(f"PHP {format_number(total_amount_vat_inclusive)}", normal_style),
            ])
        else:
            if discount_percentage:
                summary_table_data.append([
                    Paragraph("Total Amount with Discount", header_style),
                    Paragraph(f"PHP {format_number(discounted_total)}", normal_style),
                ])

        # Build PDF item rows
        product_name_style = ParagraphStyle(
            name="product_name",
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.black,
            alignment=0,
            leading=10,
            wordWrap="CJK",
            spaceShrinkage=0.05,
        )

        pdf_quotation_df = []
        for item in items:
            desc_lines = (item.get("description") or "").splitlines()
            desc_bulleted = "<br/>".join(
                f"&#8226; {ln.lstrip('*- ')}" if ln.strip().startswith(('*', '-')) else ln
                for ln in desc_lines
            )
            if desc_mode == "long":
                description_text = f"{item.get('product_name')}<br/><font size=8>{desc_bulleted}</font>"
                description_paragraph = Paragraph(description_text, product_name_style)
                if item["item_no"] in images:
                    try:
                        img = PILImage.open(BytesIO(images[item["item_no"]]))
                        img_w, img_h = img.size
                        max_image_width = 80
                        aspect = (img_w / img_h) if img_h else 1
                        img_w_pt = min(max_image_width, img_w)
                        img_h_pt = img_w_pt / aspect
                        img_reader = ImageReader(BytesIO(images[item["item_no"]]))
                        nested_table = Table(
                            [[description_paragraph, Image(img_reader, width=img_w_pt, height=img_h_pt)]],
                            colWidths=[126, 80],
                        )
                        nested_table.setStyle(TableStyle([
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 2),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                        ]))
                        cell_content = nested_table
                    except Exception as e:
                        logger.warning(f"Failed to include image for item {item['item_no']}: {e}")
                        cell_content = description_paragraph
                else:
                    cell_content = description_paragraph
            else:
                description_text = f"{item.get('product_name')}<br/><font size=9>{item.get('description') or ''}</font>"
                description_paragraph = Paragraph(description_text, product_name_style)
                if item["item_no"] in images:
                    try:
                        img = PILImage.open(BytesIO(images[item["item_no"]]))
                        img_w, img_h = img.size
                        max_image_width = 80
                        aspect_ratio = img_w / img_h if img_h else 1
                        img_w_pt = min(max_image_width, img_w)
                        img_h_pt = img_w_pt / aspect_ratio if aspect_ratio else img_h
                        img_reader = ImageReader(BytesIO(images[item["item_no"]]))
                        nested_table = Table(
                            [[description_paragraph, Image(img_reader, width=img_w_pt, height=img_h_pt)]],
                            colWidths=[126, 80],
                        )
                        nested_table.setStyle(TableStyle([
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 2),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                        ]))
                        cell_content = nested_table
                    except Exception as e:
                        logger.warning(f"Failed to include image for item {item['item_no']}: {e}")
                        cell_content = description_paragraph
                else:
                    cell_content = description_paragraph

            pdf_quotation_df.append([
                item["item_no"],
                cell_content,
                item["product_code"],
                item["quantity"],
                Paragraph(f"{format_number(item['total_amount'])}", ParagraphStyle(name="normal_item", fontName="Helvetica", fontSize=10, alignment=1)),
                Paragraph(f"{format_number(item['total_unit_price'])}", ParagraphStyle(name="normal_item_total", fontName="Helvetica", fontSize=10, alignment=1)),
            ])

        # Intro and terms paragraphs
        intro_style = ParagraphStyle(
            name="intro",
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.black,
            alignment=0,
        )
        intro_paragraph = Paragraph("<b>Dear Ma'am/Sir,</b><br/>We are pleased to submit the following quotation for your requirements:", intro_style)

        def create_terms_table():
            terms_style_local = ParagraphStyle(name="terms", fontName="Helvetica", fontSize=9, textColor=colors.black, alignment=1, wordWrap="CJK")
            terms_table_data = [
                [Paragraph("Validity", header_style), Paragraph("Delivery", header_style), Paragraph("Payment", header_style), Paragraph("Warranty", header_style)],
                [
                    Paragraph(terms_and_conditions.get("validity", ""), terms_style_local),
                    Paragraph(terms_and_conditions.get("delivery", ""), terms_style_local),
                    Paragraph(terms_and_conditions.get("payment", ""), terms_style_local),
                    Paragraph(terms_and_conditions.get("warranty", "1 year warranty against factory defect"), terms_style_local),
                ],
            ]
            col_widths = [85, 85, 140, 200]
            tbl = Table(terms_table_data, colWidths=col_widths)
            tbl.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]))
            centered_table = Table([[tbl]], colWidths=[510])
            centered_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            return centered_table

        terms_centered_table = create_terms_table()

        def create_item_table(data_rows):
            item_header_row = [
                Paragraph("Item No.", header_style),
                Paragraph("Description", header_style),
                Paragraph("Model No.", header_style),
                Paragraph("QTY (UOM)", header_style),
                Paragraph("Unit Price (PHP)", header_style),
                Paragraph("Total Amount (PHP)", header_style),
            ]
            table_data = [item_header_row] + data_rows
            col_widths = [40, 200, 80, 35, 80, 75]
            table = Table(table_data, colWidths=col_widths)
            table.setStyle(TableStyle([
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("ALIGN", (0, 1), (0, -1), "CENTER"),
                ("ALIGN", (1, 1), (1, -1), "LEFT"),
                ("ALIGN", (2, 1), (2, -1), "CENTER"),
                ("ALIGN", (3, 1), (3, -1), "CENTER"),
                ("ALIGN", (4, 1), (4, -1), "CENTER"),
                ("ALIGN", (5, 1), (5, -1), "CENTER"),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                ("FONTSIZE", (0, 1), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
                ("VALIGN", (0, 1), (0, -1), "MIDDLE"),
                ("VALIGN", (1, 1), (1, -1), "TOP"),
                ("VALIGN", (2, 1), (5, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, 0), 0.5, colors.black),
            ]))
            centered_table = Table([[table]], colWidths=[510])
            centered_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            return centered_table

        # Assemble pages
        elements = []
        if desc_mode == "short":
            items_per_page = 6
            total_items_count = len(pdf_quotation_df)
            if total_items_count == 0:
                elements.append(Spacer(1, 0.4 * inch))
                elements.append(intro_paragraph)
                elements.append(Spacer(1, 0.2 * inch))
                elements.append(terms_centered_table)
                elements.append(Spacer(1, 0.05 * inch))
            else:
                pages = (total_items_count + items_per_page - 1) // items_per_page
                for p in range(pages):
                    start = p * items_per_page
                    end = start + items_per_page
                    chunk = pdf_quotation_df[start:end]
                    elements.append(Spacer(1, 0.4 * inch))
                    elements.append(intro_paragraph)
                    elements.append(Spacer(1, 0.2 * inch))
                    elements.append(terms_centered_table)
                    elements.append(Spacer(1, 0.05 * inch))
                    elements.append(create_item_table(chunk))
                    if p < pages - 1:
                        elements.append(PageBreak())
        else:
            # long (detailed) -- one page per item
            for idx_item, row in enumerate(pdf_quotation_df):
                if idx_item > 0:
                    elements.append(PageBreak())
                elements.append(Spacer(1, 0.4 * inch))
                elements.append(intro_paragraph)
                elements.append(Spacer(1, 0.2 * inch))
                elements.append(terms_centered_table)
                elements.append(Spacer(1, 0.05 * inch))
                elements.append(create_item_table([row]))

        # If note is provided and long mode, add final page
        if note and desc_mode == "long":
            elements.append(PageBreak())
            elements.append(Spacer(1, 2 * inch))

        # Compute total pages for the template
        if desc_mode == "long":
            total_pages = len(items) + (1 if note else 0)
        else:
            total_pages = (len(items) + 5) // 6

        # Output
        client_name_safe = sanitize_filename(client_details.get("client_name", "UnknownClient"))
        reference_no_safe = sanitize_filename(client_details.get("reference_no", "NoRef"))
        pdf_filename = f"Quotation_{reference_no_safe}.pdf"
        buffer = BytesIO()

        # Create document
        doc = QuotationDocTemplate(
            buffer,
            items_count=len(items),
            move_summary_to_last_page=True,
            pagesize=A4,
            leftMargin=0.5 * inch,
            rightMargin=0.5 * inch,
            topMargin=1.5 * inch,
            bottomMargin=0.1 * inch,
        )
        doc.client_details = client_details
        doc.terms_and_conditions = terms_and_conditions
        doc.summary_table_data = summary_table_data
        doc.note = note
        doc.total_pages = total_pages

        # Build PDF, append brochures
        try:
            doc.build(elements)
            output_log.append("Success: Quotation PDF generated successfully.")

            brochure_files = request.files.getlist("brochure_file")
            if brochure_files:
                valid_brochures = [bf for bf in brochure_files
                                   if bf and bf.filename and bf.filename.lower().endswith(".pdf")]
                output_log.append(f"Received {len(brochure_files)} attached file(s), {len(valid_brochures)} valid PDF(s) to merge.")
                writer = PdfWriter()
                for pg in PdfReader(BytesIO(buffer.getvalue())).pages:
                    writer.add_page(pg)
                merged_count = 0
                for bf in valid_brochures:
                    try:
                        bf.seek(0)
                        bf_bytes = BytesIO(bf.read())
                        reader = PdfReader(bf_bytes)
                        page_count = len(reader.pages)
                        for pg in reader.pages:
                            writer.add_page(pg)
                        merged_count += 1
                        output_log.append(f"Merged '{bf.filename}' ({page_count} page(s)).")
                    except Exception as bf_err:
                        output_log.append(f"Warning: Could not merge '{bf.filename}': {bf_err}")
                merged = BytesIO()
                writer.write(merged)
                buffer = merged
                output_log.append(f"Success: {merged_count}/{len(valid_brochures)} brochure(s) appended to quotation PDF.")

        except Exception as e:
            output_log.append(f"Error: Failed to generate PDF: {str(e)}")
            logger.error("Quotation generate error: %s\n%s", e, traceback.format_exc())
            return jsonify({"success": False, "message": f"Error generating PDF: {str(e)}", "output_log": output_log})

        images.clear()
        buffer.seek(0)
        # Store PDF bytes for Drive upload
        _user_pdf[uk] = {}
        _user_pdf[uk]["bytes"] = buffer.getvalue()
        _user_pdf[uk]["filename"] = pdf_filename
        _user_pdf[uk]["quotation_number"] = reference_no_safe

        # ── Auto-submit to Google Sheet + upload PDF to Drive ──
        # Runs in a BACKGROUND THREAD so the PDF response returns immediately
        # instead of blocking for 30-120s on sequential Google Apps Script calls
        # (which caused Gunicorn WORKER TIMEOUT → SIGKILL → 502).
        _user_submission[uk] = {"status": "pending"}
        agent_name = data.get("agent_name", "").strip()
        quotation_sheet_id = data.get("quotation_sheet_id", "").strip()
        creator_role = data.get("creator_role", "").strip()
        revision_ctx = data.get("revision_context") or {}

        logger.info("Auto-submit: agent=%s, sheetId=%s, hasQURL=%s, hasDURL=%s",
                     agent_name, quotation_sheet_id[:10] if quotation_sheet_id else "NONE",
                     bool(QUOTATION_GOOGLE_APPS_SCRIPT_URL), bool(DASHBOARD_APPS_SCRIPT_URL))

        # Capture all data needed by the background thread from the request
        # (request context is unavailable once the response is sent)
        if vat_option == "inclusive":
            _total_amount = total_amount_vat_inclusive
        elif discount_percentage:
            _total_amount = discounted_total
        else:
            _total_amount = total_amount_vat_exclusive

        _submit_data = {
            "client_name": data.get("client_name", ""),
            "client_address": data.get("client_address", ""),
            "attention": data.get("attention", ""),
            "designation": data.get("designation", ""),
            "email": data.get("email", ""),
            "subject": data.get("subject", ""),
            "reference_no": data.get("reference_no", ""),
            "reference_rfq_no": data.get("reference_rfq_no", ""),
            "quotation_date": data.get("quotation_date", ""),
            "sig_name": data.get("sig_name", ""),
            "sig_designation": data.get("sig_designation", ""),
            "sig_viber": data.get("sig_viber", ""),
            "sig_mobile": data.get("sig_mobile", ""),
            "sig_email": data.get("sig_email", ""),
            "agent_name": agent_name,
            "principal": data.get("principal", ""),
            "destination": data.get("destination", ""),
            "discount_percentage": data.get("discount_percentage", ""),
            "vat_option": data.get("vat_option", ""),
            "desc_mode": data.get("desc_mode", ""),
            "note": data.get("note", ""),
            "validity": data.get("validity", ""),
            "delivery": data.get("delivery", ""),
            "payment": data.get("payment", ""),
            "warranty": data.get("warranty", ""),
            "pr_sheet_id": data.get("pr_sheet_id", ""),
        }
        _items_snapshot = [dict(it) for it in items]  # deep copy

        def _async_sheet_submit():
            """Background thread: write row to sheet, upload PDF to Drive, update link."""
            try:
                submit_details = {
                    "client_name": _submit_data["client_name"],
                    "client_address": _submit_data["client_address"],
                    "attention": _submit_data["attention"],
                    "client_designation": _submit_data["designation"],
                    "client_email": _submit_data["email"],
                    "subject": _submit_data["subject"],
                    "reference_no": _submit_data["reference_no"],
                    "reference_rfq_no": _submit_data["reference_rfq_no"],
                    "quotation_date": _submit_data["quotation_date"],
                    "sig_name": _submit_data["sig_name"],
                    "sig_designation": _submit_data["sig_designation"],
                    "sig_viber": _submit_data["sig_viber"],
                    "sig_mobile": _submit_data["sig_mobile"],
                    "sig_email": _submit_data["sig_email"],
                    "agent_name": _submit_data["agent_name"],
                    "principal": _submit_data["principal"],
                    "destination": _submit_data["destination"],
                    "discount_percentage": _submit_data["discount_percentage"],
                    "vat_option": _submit_data["vat_option"],
                    "desc_mode": _submit_data["desc_mode"],
                    "note": _submit_data["note"],
                    "validity": _submit_data["validity"],
                    "delivery": _submit_data["delivery"],
                    "payment": _submit_data["payment"],
                    "warranty": _submit_data["warranty"],
                }
                quotation_json = _build_quotation_json(submit_details, _items_snapshot)

                if is_revision:
                    # ── REVISION: upload PDF + call reviseQuotation ──
                    revision_sheet_id = revision_ctx.get("sheetId", "")
                    revision_row_index = revision_ctx.get("rowIndex", 0)
                    drive_link = _upload_pdf_to_drive(agent_name, uk)
                    if revision_sheet_id and revision_row_index:
                        revise_payload = {
                            "action": "reviseQuotation",
                            "sheetId": revision_sheet_id,
                            "rowIndex": str(revision_row_index),
                            "driveLink": drive_link,
                            "totalAmount": str(round(_total_amount, 2)),
                            "quotationData": quotation_json,
                            "subject": _submit_data["subject"],
                            "clientName": _submit_data["client_name"],
                            "attention": _submit_data["attention"],
                            "clientEmail": _submit_data["email"],
                            "refNo": _submit_data["reference_no"],
                            "rfqNo": _submit_data["reference_rfq_no"],
                            "creatorRole": creator_role,
                        }
                        resp = http_requests.post(
                            DASHBOARD_APPS_SCRIPT_URL, json=revise_payload,
                            timeout=15, allow_redirects=False,
                        )
                        if resp.status_code in (301, 302, 303, 307, 308):
                            redir = resp.headers.get("Location")
                            if redir:
                                resp = http_requests.get(redir, timeout=15)
                        if resp.status_code == 200:
                            rev_result = resp.json()
                            if rev_result.get("success"):
                                _user_submission[uk].update({
                                    "status": "done",
                                    "sheetId": revision_sheet_id,
                                    "rowIndex": revision_row_index,
                                    "refNo": _submit_data["reference_no"],
                                })
                                logger.info("Async revision submit succeeded")
                            else:
                                logger.warning("Async revision failed: %s", rev_result.get("message", ""))
                        else:
                            logger.warning("Async revision returned status %d", resp.status_code)
                else:
                    # ── NEW SUBMISSION: write row + upload PDF ──
                    rows = [[
                        _submit_data["quotation_date"] or datetime.now().strftime("%Y-%m-%d"),
                        agent_name,
                        _submit_data["reference_no"],
                        _submit_data["reference_rfq_no"],
                        _submit_data["subject"],
                        _submit_data["client_name"],
                        _submit_data["attention"],
                        _submit_data["email"],
                        str(round(_total_amount, 2)),
                        "",  # J - Status
                        "",  # K - Follow Up Date
                        "",  # L - Drive Link (set later)
                        "",  # M - Admin Approval (set later)
                        "",  # N - Mgmt Approval (set later)
                        "",  # O - Overall Status (set later)
                        quotation_json,  # P - QuotationData
                    ]]
                    payload = {"sheet_id": quotation_sheet_id, "rows": rows}
                    response = http_requests.post(
                        QUOTATION_GOOGLE_APPS_SCRIPT_URL,
                        json=payload, timeout=15, allow_redirects=False,
                    )
                    if response.status_code in (301, 302, 303, 307, 308):
                        redirect_url = response.headers.get("Location")
                        if redirect_url:
                            response = http_requests.get(redirect_url, timeout=15)

                    row_index = 0
                    if response.status_code == 200:
                        try:
                            result = response.json()
                            row_index = result.get("rowIndex", 0)
                        except Exception:
                            pass
                        logger.info("Async sheet write succeeded, rowIndex=%s", row_index)
                    else:
                        logger.warning("Async sheet write returned status %d", response.status_code)

                    # Upload PDF to Drive and update drive link + approval columns
                    drive_link = _upload_pdf_to_drive(agent_name, uk)
                    logger.info("Auto-submit: drive_link=%s, row_index=%s", drive_link[:50] if drive_link else "EMPTY", row_index)
                    ref_no = _submit_data.get("reference_no", "")
                    if quotation_sheet_id and drive_link:
                        try:
                            link_payload = {
                                "action": "updateQuotationDriveLink",
                                "sheetId": quotation_sheet_id,
                                "rowIndex": str(row_index),
                                "driveLink": drive_link,
                                "creatorRole": creator_role,
                                "refNo": ref_no,
                            }
                            link_resp = http_requests.post(
                                DASHBOARD_APPS_SCRIPT_URL,
                                json=link_payload,
                                timeout=15, allow_redirects=False,
                            )
                            if link_resp.status_code in (301, 302, 303, 307, 308):
                                redir2 = link_resp.headers.get("Location")
                                if redir2:
                                    link_resp = http_requests.get(redir2, timeout=15)
                            if link_resp.status_code == 200:
                                link_result = link_resp.json()
                                logger.info("updateQuotationDriveLink result: %s", str(link_result)[:200])
                                if link_result.get("rowIndex"):
                                    row_index = link_result["rowIndex"]
                            else:
                                logger.warning("updateQuotationDriveLink returned status %d: %s", link_resp.status_code, link_resp.text[:200])
                        except Exception as link_err:
                            logger.warning("Could not update drive link: %s", link_err)
                    elif quotation_sheet_id and not drive_link:
                        logger.warning("Drive upload failed — updating approval columns without drive link")
                        try:
                            link_payload = {
                                "action": "updateQuotationDriveLink",
                                "sheetId": quotation_sheet_id,
                                "rowIndex": str(row_index),
                                "driveLink": "",
                                "creatorRole": creator_role,
                                "refNo": ref_no,
                            }
                            link_resp = http_requests.post(
                                DASHBOARD_APPS_SCRIPT_URL,
                                json=link_payload,
                                timeout=15, allow_redirects=False,
                            )
                            if link_resp.status_code in (301, 302, 303, 307, 308):
                                redir2 = link_resp.headers.get("Location")
                                if redir2:
                                    link_resp = http_requests.get(redir2, timeout=15)
                        except Exception as link_err:
                            logger.warning("Could not update approval columns: %s", link_err)

                    _user_submission[uk].update({
                        "status": "done",
                        "sheetId": quotation_sheet_id,
                        "rowIndex": row_index,
                        "refNo": _submit_data["reference_no"],
                        "driveLink": drive_link or "",
                    })

                    # Link PR to this quotation if RFQ number is provided
                    rfq_no = _submit_data.get("reference_rfq_no", "").strip()
                    pr_sid = _submit_data.get("pr_sheet_id", "").strip()
                    if rfq_no and pr_sid and DASHBOARD_APPS_SCRIPT_URL:
                        try:
                            link_pr_resp = http_requests.get(
                                DASHBOARD_APPS_SCRIPT_URL,
                                params={
                                    "action": "linkPRToQuotation",
                                    "rfqNo": rfq_no,
                                    "prSheetId": pr_sid,
                                    "quotationRef": _submit_data["reference_no"],
                                },
                                timeout=15, allow_redirects=False,
                            )
                            if link_pr_resp.status_code in (301, 302, 303, 307, 308):
                                redir3 = link_pr_resp.headers.get("Location")
                                if redir3:
                                    link_pr_resp = http_requests.get(redir3, timeout=15)
                            if link_pr_resp.status_code == 200:
                                logger.info("linkPRToQuotation result: %s", link_pr_resp.text[:200])
                        except Exception as pr_err:
                            logger.warning("linkPRToQuotation error: %s", pr_err)

            except Exception as auto_err:
                logger.warning("Async auto-submit failed: %s\n%s", auto_err, traceback.format_exc())
                _user_submission[uk]["status"] = "error"

        if quotation_sheet_id and QUOTATION_GOOGLE_APPS_SCRIPT_URL:
            import threading as _threading
            _threading.Thread(target=_async_sheet_submit, daemon=True).start()
            output_log.append("Sheet submission started (async).")
        else:
            _user_submission[uk] = {}

        buffer.seek(0)
        return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name=pdf_filename)

    except Exception as exc:
        logger.error("Quotation generate error: %s\n%s", exc, traceback.format_exc())
        return jsonify({"success": False, "message": str(exc), "output_log": output_log}), 500


# ---------------------------------------------------------------------------
# Route: last_submission_info (for frontend to get sheetId/rowIndex after generate)
# ---------------------------------------------------------------------------
@quotation_bp.route("/last_submission_info", methods=["GET"])
def get_last_submission_info():
    """Return the sheetId/rowIndex/refNo from the most recent auto-submit during generate."""
    uk = _get_user_key()
    info = _user_submission.get(uk, {})
    if info:
        return jsonify({"success": True, **info})
    return jsonify({"success": False, "message": "No recent submission"})


# ---------------------------------------------------------------------------
# Route: check_approval_status
# ---------------------------------------------------------------------------
@quotation_bp.route("/check_approval_status", methods=["GET"])
def check_approval_status():
    """Proxy to Code.gs getQuotationApprovalStatus action."""
    sheet_id = request.args.get("sheetId", "")
    row_index = request.args.get("rowIndex", "")
    if not sheet_id or not row_index:
        return jsonify({"success": False, "message": "sheetId and rowIndex required"}), 400
    if not DASHBOARD_APPS_SCRIPT_URL:
        return jsonify({"success": False, "message": "Dashboard Apps Script URL not configured"}), 500
    try:
        resp = http_requests.get(
            DASHBOARD_APPS_SCRIPT_URL,
            params={"action": "getQuotationApprovalStatus", "sheetId": sheet_id, "rowIndex": row_index},
            timeout=15, allow_redirects=False,
        )
        if resp.status_code in (301, 302, 303, 307, 308):
            redir = resp.headers.get("Location")
            if redir:
                resp = http_requests.get(redir, timeout=15)
        if resp.status_code == 200:
            return jsonify(resp.json())
        return jsonify({"success": False, "message": f"Status {resp.status_code}"}), 500
    except Exception as e:
        logger.error("check_approval_status error: %s", e)
        return jsonify({"success": False, "message": str(e)}), 500


# ---------------------------------------------------------------------------
# Route: submit_to_sheets (FINALIZATION ONLY — quotation row already written during generate)
# ---------------------------------------------------------------------------
@quotation_bp.route("/submit_to_sheets", methods=["POST"])
def submit_to_sheets():
    """Finalize an approved quotation (writes 'Finalized' to Status col J)."""
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "JSON required"}), 400

        details = request.get_json() or {}
        sheet_id = details.get("sheetId", "")
        row_index = details.get("rowIndex", 0)

        if not sheet_id or not row_index:
            return jsonify({"success": False, "message": "sheetId and rowIndex required"}), 400

        if not DASHBOARD_APPS_SCRIPT_URL:
            return jsonify({"success": False, "message": "Dashboard Apps Script URL not configured"}), 500

        resp = http_requests.get(
            DASHBOARD_APPS_SCRIPT_URL,
            params={"action": "finalizeQuotation", "sheetId": sheet_id, "rowIndex": str(row_index)},
            timeout=15, allow_redirects=False,
        )
        if resp.status_code in (301, 302, 303, 307, 308):
            redir = resp.headers.get("Location")
            if redir:
                resp = http_requests.get(redir, timeout=15)

        if resp.status_code == 200:
            result = resp.json()
            return jsonify(result)
        else:
            return jsonify({"success": False, "message": f"Status {resp.status_code}"}), 500

    except Exception as e:
        logger.error("submit_to_sheets (finalize) error: %s", e)
        return jsonify({"success": False, "message": str(e)}), 500


# ---------------------------------------------------------------------------
# Get Rejected Quotations (for revision workflow)
# ---------------------------------------------------------------------------
@quotation_bp.route("/get_rejected", methods=["GET"])
def get_rejected():
    """Fetch rejected quotations for the agent's sheet via Code.gs."""
    sheet_id = request.args.get("quotation_sheet_id", "")
    if not sheet_id:
        return jsonify({"success": False, "message": "No quotation_sheet_id provided"}), 400
    if not DASHBOARD_APPS_SCRIPT_URL:
        return jsonify({"success": False, "message": "Dashboard Apps Script URL not configured"}), 500

    try:
        response = http_requests.get(
            DASHBOARD_APPS_SCRIPT_URL,
            params={"action": "getMyRejectedQuotations", "sheetId": sheet_id},
            timeout=15,
            allow_redirects=False,
        )
        if response.status_code in (301, 302, 303, 307, 308):
            redirect_url = response.headers.get("Location")
            if redirect_url:
                response = http_requests.get(redirect_url, timeout=15)

        if response.status_code == 200:
            return jsonify(response.json())
        else:
            return jsonify({"success": False, "message": f"Status {response.status_code}"}), 500
    except Exception as e:
        logger.error("get_rejected error: %s", e)
        return jsonify({"success": False, "message": str(e)}), 500


# ---------------------------------------------------------------------------
# Load Quotation (populate server-side items from saved JSON)
# ---------------------------------------------------------------------------
@quotation_bp.route("/load_quotation", methods=["POST"])
def load_quotation():
    """Load a quotation's items into server-side state for editing/regeneration."""
    import json as _json
    uk = _get_user_key()
    output_log = _log_reset(uk)
    try:
        data = request.get_json() or {}
        quotation_data_str = data.get("quotationData", "")
        if not quotation_data_str:
            return jsonify({"success": False, "message": "No quotation data provided"}), 400

        qdata = _json.loads(quotation_data_str)
        loaded_items = qdata.get("items", [])

        # Clear existing state
        _user_items[uk] = []
        _user_images[uk] = {}

        # Populate items (no images on reload)
        for item in loaded_items:
            item["image_data_url"] = None
            _user_items[uk].append(item)

        output_log.append(f"Success: Loaded {len(loaded_items)} items from rejected quotation.")
        return jsonify({
            "success": True,
            "items": _user_items[uk],
            "output_log": output_log,
        })
    except Exception as e:
        logger.error("load_quotation error: %s", e)
        output_log.append(f"Error: {str(e)}")
        return jsonify({"success": False, "message": str(e), "output_log": output_log}), 500
