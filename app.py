"""Unified CRM Flask Application — combines Dashboard, PO, PR, MRO, and Quotation tools."""

import logging
import os
import re
from flask import Flask, send_from_directory, abort, make_response, request
from flask_compress import Compress
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
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com; "
        "connect-src 'self' https://script.google.com https://*.googleusercontent.com https://docs.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        # A315: blob: — the quotation live preview (and every other in-page PDF preview) loads the
        # generated PDF into an <iframe> from URL.createObjectURL; without it Chrome shows
        # "This content is blocked. Contact the site owner to fix the issue." in the frame.
        "frame-src 'self' blob: https://drive.google.com https://docs.google.com; "
        "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # ── Security & limits ────────────────────────────────────────
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB upload limit

    # ── A300: compression. 3.3 MB of hand-written JS becomes ~1 MB on the wire; brotli when the
    # browser offers it, gzip otherwise. Small bodies and images are left alone.
    app.config.update(
        COMPRESS_ALGORITHM=["br", "gzip"],
        COMPRESS_ALGORITHM_STREAMING=["br", "gzip"],   # file responses stream; the default list left gzip out
        COMPRESS_MIMETYPES=["text/html", "text/css", "application/javascript", "text/javascript",
                            "application/json", "text/csv", "text/plain", "image/svg+xml"],
        COMPRESS_MIN_SIZE=500, COMPRESS_LEVEL=6, COMPRESS_BR_LEVEL=5,
    )
    Compress(app)

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
    from blueprints.books import books_bp   # A321 — the books bridge (/books/sync)

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
    app.register_blueprint(books_bp)    # A321 — POST /books/sync

    # ── A300: revalidation must stay cheap. Flask-Compress suffixes a strong ETag with the
    # encoding ("...:br"), so the browser's If-None-Match would never match the file's own ETag and
    # every revalidation would be a full 200 plus a fresh compression. Stripping the suffix lets
    # send_from_directory answer 304 itself, before any compression work.
    @app.before_request
    def _plain_if_none_match():
        inm = request.environ.get("HTTP_IF_NONE_MATCH")
        if inm and ":" in inm:
            request.environ["HTTP_IF_NONE_MATCH"] = re.sub(r':(?:br|gzip|deflate|zstd)"', '"', inm)

    # ── Security + cache headers ────────────────────────────────────
    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        # A316 — the camera is allowed on the warehouse scanner page only; every other page keeps it off.
        response.headers['Permissions-Policy'] = ('camera=(self), microphone=(), geolocation=()'
                                                  if request.path == '/scan.html' else 'camera=(), microphone=(), geolocation=()')
        response.headers.pop('Server', None)
        # A299/A300/A304 — HSTS ramped 300 s → 1 day → 1 year once each step held on Render.
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        # A304 — enforcing (report-only from A299 showed no violations on every home, a PDF export
        # and a Drive preview). 'unsafe-inline' stays until A305 moves the inline blocks out.
        if (response.content_type or "").startswith("text/html"):
            response.headers['Content-Security-Policy'] = _CSP

        # ── Cache policy (A300). Pages are hand-edited and served as they are, with no version in
        # their URLs, so scripts, sheets and pages are cached but always revalidated: the browser
        # sends If-None-Match and gets a 304 unless the file changed. Images and fonts, which never
        # change without a new name, are cached for 30 days.
        ct = response.content_type or ""
        if ct.startswith("image/") or ct.startswith("font/") or "woff" in ct:
            response.headers['Cache-Control'] = 'public, max-age=2592000'
        elif "javascript" in ct or "css" in ct or ct.startswith("text/html"):
            response.headers['Cache-Control'] = 'public, max-age=0, must-revalidate'

        return response

    # ── Dashboard routes (serve static HTML pages) ────────────────
    DASHBOARD_DIR = os.path.join(base_dir, "dashboard")

    @app.route("/")
    def serve_index():
        return send_from_directory(DASHBOARD_DIR, "index.html")

    # A316 — the scanner installs as a home-screen app: its manifest and service worker must be served
    # from the site root (a worker's scope cannot reach above the folder it is served from).
    @app.route("/manifest.webmanifest")
    def web_manifest():
        return send_from_directory(DASHBOARD_DIR, "manifest.webmanifest", mimetype="application/manifest+json")

    # A323 — Collect, the director's phone, installs as its own home-screen app.
    @app.route("/collect.webmanifest")
    def collect_manifest():
        return send_from_directory(DASHBOARD_DIR, "collect.webmanifest", mimetype="application/manifest+json")

    @app.route("/sw.js")
    def service_worker():
        return send_from_directory(DASHBOARD_DIR, "sw.js", mimetype="application/javascript")

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
