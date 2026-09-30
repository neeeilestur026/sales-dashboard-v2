"""Unified CRM Flask Application — combines Dashboard, PO, PR, MRO, and Quotation tools."""

import logging
import os
from flask import Flask, send_from_directory, abort, make_response, request
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# A299 — INFO lines from the blueprints are otherwise dropped under gunicorn's defaults.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# A299 — a decompression bomb in an uploaded receipt or brochure must not take the worker down.
try:
    from PIL import Image as _PILImage
    _PILImage.MAX_IMAGE_PIXELS = 40_000_000
except Exception:                       # Pillow is a hard dependency, but never let a cap break boot
    pass

_CSP = ("default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com; "
        "connect-src 'self' https://script.google.com https://*.googleusercontent.com https://docs.google.com; "
        "frame-src 'self' https://drive.google.com https://docs.google.com; "
        "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # ── Security & limits ────────────────────────────────────────
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB upload limit

    # ── Base directories ──────────────────────────────────────────
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # ── Upload & output directories for each tool ─────────────────
    app.config["DATA_DIR"] = os.path.join(base_dir, "data")

    # Ensure uploads directory exists (not tracked in git)
    os.makedirs(os.path.join(base_dir, "data", "uploads"), exist_ok=True)

    # ── Register Blueprints ───────────────────────────────────────
    from blueprints.po import po_bp
    from blueprints.pr import pr_bp
    from blueprints.mro import mro_bp
    from blueprints.mi import mi_bp
    from blueprints.quotation import quotation_bp
    from blueprints.payment_request import payment_request_bp
    from blueprints.billing import billing_bp
    from blueprints.email_log import email_log_bp
    from blueprints.flow import flow_bp
    from blueprints.session_auth import session_bp

    app.register_blueprint(po_bp, url_prefix="/po")
    app.register_blueprint(pr_bp, url_prefix="/pr")
    app.register_blueprint(mro_bp, url_prefix="/mro")
    app.register_blueprint(mi_bp, url_prefix="/mi")
    app.register_blueprint(quotation_bp, url_prefix="/quotation")
    app.register_blueprint(payment_request_bp, url_prefix="/payment-request")
    app.register_blueprint(billing_bp, url_prefix="/billing")
    app.register_blueprint(email_log_bp)
    app.register_blueprint(flow_bp)  # routes are /flow/quotation-pdf, /flow/po-pdf
    app.register_blueprint(session_bp)  # POST /api/session/logout

    # ── Security + cache headers ────────────────────────────────────
    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        response.headers.pop('Server', None)
        # A299 — HSTS ramps 300 s → 1 day (A300) → 1 year (A304) so a misstep is cheap to undo.
        response.headers['Strict-Transport-Security'] = 'max-age=300'
        # A299 — report-only for one release; the harness console must show no violations before
        # A304 makes it enforcing. 'unsafe-inline' stays until A305 moves the inline blocks out.
        if (response.content_type or "").startswith("text/html"):
            response.headers['Content-Security-Policy-Report-Only'] = _CSP

        # ── Static asset cache headers (saves ~900KB per page load) ──
        ct = response.content_type or ""
        if ct.startswith("image/"):
            response.headers['Cache-Control'] = 'public, max-age=2592000'  # 30 days
        elif "javascript" in ct or "css" in ct:
            response.headers['Cache-Control'] = 'no-cache'  # always revalidate; ETag/Last-Modified prevents re-download
        elif ct.startswith("font/") or "woff" in ct:
            response.headers['Cache-Control'] = 'public, max-age=2592000'  # 30 days

        return response

    # ── Dashboard routes (serve static HTML pages) ────────────────
    DASHBOARD_DIR = os.path.join(base_dir, "dashboard")

    @app.route("/")
    def serve_index():
        return send_from_directory(DASHBOARD_DIR, "index.html")

    @app.route("/robots.txt")
    def robots_txt():
        resp = make_response("User-agent: *\nDisallow: /\n")
        resp.headers['Content-Type'] = 'text/plain'
        return resp

    @app.route("/<path:page>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
    def serve_dashboard(page):
        # Only serve static files on GET (and HEAD, which Flask answers from the GET view — uptime
        # probes and `curl -I` used to get a 404 here); other methods fall through to blueprints
        if request.method not in ("GET", "HEAD"):
            abort(404)
        # Serve dashboard HTML pages
        if page.endswith(".html"):
            filepath = os.path.join(DASHBOARD_DIR, page)
            if os.path.isfile(filepath):
                return send_from_directory(DASHBOARD_DIR, page)
        # Serve dashboard JS files
        if page.startswith("js/") or page.startswith("css/") or page.startswith("images/") or page.startswith("data/"):
            filepath = os.path.join(DASHBOARD_DIR, page)
            if os.path.isfile(filepath):
                return send_from_directory(DASHBOARD_DIR, page)
        abort(404)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true", port=5000)
