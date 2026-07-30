"""Shared PDF utility functions used across all blueprint PDF generators."""

import os
import re
import shutil
import errno
import time
import html
import logging
from datetime import date, datetime, timedelta, timezone
from dateutil.parser import parse as dateutil_parse
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib import colors

logger = logging.getLogger(__name__)


def sanitize_filename(s):
    """Sanitize filename by removing invalid characters and replacing spaces."""
    if not s:
        return "Unknown"
    # Sheets returns numeric-looking cells (doc numbers, supplier names) as numbers — coerce first.
    s = re.sub(r"[^\w\s-]", "", str(s).strip()).replace(" ", "_")
    return s if s else "Unknown"


# ── Manila-correct dates (A179) ───────────────────────────────────────────────
# Dates in this system are Manila CALENDAR dates. Sheets stores them as datetimes at Manila
# midnight, so getValues serialises them as '…T16:00:00.000Z' — the day BEFORE in UTC. So a
# naive str()[:10] is one day early, and strptime('%Y-%m-%d') on such a value raises (which is
# how a supplier PO came to print today's date instead of its own: see po_pdf).
#
# These are the Python twin of flowDate() in dashboard/js/flow-api.js. The two must agree to the
# day, because the A123 PDF-freshness stamp is compared against the record on the client AND
# again inside FlowAPI.gs, where a mismatch is a hard refusal to approve.
try:
    from zoneinfo import ZoneInfo          # stdlib on 3.11 (runtime.txt)
    PH_TZ = ZoneInfo("Asia/Manila")
except Exception:                          # a container without tzdata
    PH_TZ = timezone(timedelta(hours=8))   # exact, not an approximation — PH has had no DST since 1978

_YMD_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def ph_date(value):
    """Any incoming date value -> a Manila-correct ``datetime.date``, or None.

    Handles a bare 'YYYY-MM-DD' (taken verbatim — it is already a Manila calendar date, and
    re-parsing it could only shift it), an ISO timestamp with a zone, a long-form 'July 30, 2026',
    and date/datetime objects. A naive timestamp is read as Manila local, which is this system's
    storage convention and the only thing our own date inputs produce.

    Returns None for empty, unparseable, or numeric input — never a guess, and never today. A
    document that invents a date is worse than one showing a blank. Numbers are deliberately not
    read as spreadsheet serials: guessing the epoch would print a confidently wrong date.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        return value                       # a plain date carries no zone to convert
    else:
        s = str(value).strip()
        if not s:
            return None
        m = _YMD_RE.match(s)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                return None                # e.g. '2026-13-45'
        try:
            dt = dateutil_parse(s, dayfirst=False)
        except (ValueError, OverflowError, TypeError):
            return None
    return dt.date() if dt.tzinfo is None else dt.astimezone(PH_TZ).date()


def ph_date_ymd(value, default=""):
    """Machine form: Manila-correct 'YYYY-MM-DD' — for payloads and strict parsers."""
    d = ph_date(value)
    return d.isoformat() if d else default


def ph_date_long(value, default=""):
    """Document form: Manila-correct 'July 30, 2026' — what prints on a PDF.

    Idempotent: feeding it its own output round-trips, so formatting twice cannot corrupt a date.
    """
    d = ph_date(value)
    return d.strftime("%B %d, %Y") if d else default


def safe_replace(src, dst, retries=3, delay=0.25):
    """Replace src -> dst robustly: try os.replace, then fallback to copy+unlink with retries."""
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            os.replace(src, dst)
            return
        except OSError as e:
            last_exc = e
            try:
                os.rename(src, dst)
                return
            except Exception:
                pass
            try:
                shutil.copyfile(src, dst)
                os.unlink(src)
                return
            except OSError as e2:
                last_exc = e2
                if getattr(e2, 'errno', None) in (errno.ESTALE, errno.EIO, errno.EBUSY):
                    time.sleep(delay)
                    continue
                raise
    raise last_exc or OSError(f"Failed to move {src} to {dst}")


def safe_remove(path, retries=3, delay=0.25):
    """Remove a file with retries to mitigate transient errors."""
    if not path:
        return
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            if os.path.exists(path):
                os.remove(path)
            return
        except OSError as e:
            last_exc = e
            if getattr(e, 'errno', None) in (errno.ESTALE, errno.EIO, errno.EBUSY, errno.EACCES):
                time.sleep(delay)
                continue
            logger.error(f"safe_remove error for {path}: {e}")
            break
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        logger.error(f"safe_remove final attempt failed for {path}: {e}")


def format_bullet_description(description, description_style):
    """Format description as plain text with support for markdown-like bullets.
       Returns a ReportLab Paragraph."""
    if not description or not description.strip():
        return Paragraph("", description_style)
    lines = description.splitlines()
    out_lines = []
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            out_lines.append("<br/>")
            continue
        stripped = line.lstrip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            content = stripped[2:].strip()
            escaped = html.escape(content)
            out_lines.append(f"&bull; {escaped}")
        elif re.match(r"^\d+\.\s+", stripped):
            m = re.match(r"^(\d+\.)\s+(.*)$", stripped)
            if m:
                num, rest = m.groups()
                out_lines.append(f"{num} {html.escape(rest.strip())}")
            else:
                out_lines.append(html.escape(stripped))
        else:
            leading_spaces = len(line) - len(stripped)
            prefix = "&nbsp;" * leading_spaces if leading_spaces > 0 else ""
            out_lines.append(f"{prefix}{html.escape(stripped)}")
    text = "<br/>".join(out_lines)
    return Paragraph(text, description_style)


def get_static_path(*parts):
    """Get the absolute path to a file in the static directory."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "static", *parts)
