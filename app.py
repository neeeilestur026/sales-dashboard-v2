"""Unified CRM Flask Application — combines Dashboard, PO, PR, MRO, and Quotation tools."""

import os
import time
import threading
from flask import Flask, send_from_directory, abort, make_response, request
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ── In-memory state cleanup (TTL-based eviction) ──────────────────
_STATE_TTL_SECONDS = 3600  # 1 hour

def _start_cleanup_thread(app):
    """Periodically evict stale per-user state from all blueprints."""
    def _cleanup():
        while True:
            time.sleep(300)  # Run every 5 minutes
            now = time.time()
            try:
                from blueprints import po, pr, mro, mi, quotation, payment_request
                for mod in [po, pr, mro, mi, quotation, payment_request]:
                    for store_name in dir(mod):
                        store = getattr(mod, store_name, None)
                        if isinstance(store, dict) and store_name.startswith("_user_"):
                            stale = [k for k in list(store.keys())
                                     if isinstance(store.get(k), dict) and
                                     now - store[k].get("_ts", now) > _STATE_TTL_SECONDS]
                            for k in stale:
                                store.pop(k, None)
            except Exception:
                pass  # Cleanup is best-effort
    t = threading.Thread(target=_cleanup, daemon=True)
    t.start()


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

    app.register_blueprint(po_bp, url_prefix="/po")
    app.register_blueprint(pr_bp, url_prefix="/pr")
    app.register_blueprint(mro_bp, url_prefix="/mro")
    app.register_blueprint(mi_bp, url_prefix="/mi")
    app.register_blueprint(quotation_bp, url_prefix="/quotation")
    app.register_blueprint(payment_request_bp, url_prefix="/payment-request")
    app.register_blueprint(billing_bp, url_prefix="/billing")
    app.register_blueprint(email_log_bp)
    app.register_blueprint(flow_bp)  # routes are /flow/quotation-pdf, /flow/po-pdf

    # ── Security + cache headers ────────────────────────────────────
    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        response.headers.pop('Server', None)

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
        # Only serve static files on GET; let other methods fall through to blueprints
        if request.method != "GET":
            abort(404)
        # Serve dashboard HTML pages
        if page.endswith(".html"):
            filepath = os.path.join(DASHBOARD_DIR, page)
            if os.path.isfile(filepath):
                return send_from_directory(DASHBOARD_DIR, page)
        # Serve dashboard JS files
        if page.startswith("js/") or page.startswith("css/") or page.startswith("images/"):
            filepath = os.path.join(DASHBOARD_DIR, page)
            if os.path.isfile(filepath):
                return send_from_directory(DASHBOARD_DIR, page)
        abort(404)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true", port=5000)
