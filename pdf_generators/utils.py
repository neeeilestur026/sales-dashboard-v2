"""Shared PDF utility functions used across all blueprint PDF generators."""

import os
import re
import shutil
import errno
import time
import html
import logging
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
