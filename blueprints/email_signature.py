"""Email signature — normalise the PNG once, embed it inline below the body.

The GoDaddy mail these accounts send always carries a signature image under the body. Anything this
system sends has to look the same, so this module owns two jobs:

1. NORMALISE. The signatures come out of the design tool at print size — Neil's is 3040x1200 and
   1.08 MB. Sending that on every email is wrong three ways: most clients would scale it to something
   enormous, a megabyte of image per message is a real spam signal, and it would dwarf the message
   itself. normalize_signature() resizes to SIG_STORE_W, flattens onto white and quantises, which
   takes that file to ~100 KB with no visible loss (the text stays crisp — checked, not assumed).

2. EMBED. As an inline `cid:` part inside multipart/related, exactly the way a mail client does it,
   so it renders in the body rather than arriving as a download the reader has to open.

Signatures are PER USER — the image carries a person's name, title and mobile number. There is one
file per sender, resolved by username and then by mailbox address, and NO fallback to somebody else's
signature: sending Neil's card under Kimberlyn's name would be worse than sending none at all.
"""

import os
import io
import re
import logging
from email.message import EmailMessage
from typing import Optional

logger = logging.getLogger(__name__)

# Not under dashboard/ or static/ on purpose: Flask serves those, and the signature is read
# server-side and embedded. It never needs to be fetchable over HTTP.
SIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "signatures")

SIG_STORE_W = 1200      # stored width — 2x the display width, so it stays sharp on retina
SIG_DISPLAY_W = 600     # what the HTML asks the client to render it at
SIG_MAX_BYTES = 400_000  # a normalised signature well above this means something went wrong


def _safe_key(s: str) -> str:
    """Filename-safe key. Also the guard against a crafted username walking out of SIG_DIR."""
    return re.sub(r"[^a-z0-9._-]+", "_", (s or "").strip().lower()).strip("._-")


def normalize_signature(raw: bytes) -> bytes:
    """Design-tool PNG in, email-ready PNG out. Raises ValueError if it isn't a usable image."""
    try:
        from PIL import Image
    except ImportError as exc:                       # pragma: no cover - Pillow is in requirements
        raise ValueError("Pillow is not installed, cannot normalise the signature") from exc
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as exc:
        raise ValueError("That file could not be read as an image") from exc

    if im.width < 200:
        raise ValueError("That image is too small to be a signature (%d px wide)" % im.width)

    if im.width > SIG_STORE_W:
        im = im.resize((SIG_STORE_W, round(im.height * SIG_STORE_W / im.width)), Image.LANCZOS)

    # Flatten onto white rather than keeping alpha: clients composite a signature onto the message
    # background anyway, and dropping the alpha channel is what lets the quantiser do its work.
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, (255, 255, 255))
        flat.paste(im, (0, 0), im)
        im = flat
    elif im.mode != "RGB":
        im = im.convert("RGB")

    out = io.BytesIO()
    im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG) \
      .save(out, "PNG", optimize=True)
    data = out.getvalue()
    if len(data) > SIG_MAX_BYTES:
        # Not fatal to the caller's intent, but worth knowing: it means the source was unusual.
        logger.warning("normalised signature is %.0f KB, larger than expected", len(data) / 1024)
    return data


def signature_path(username: str = "", address: str = "") -> Optional[str]:
    """The signature file for this sender, or None. Username first, then the mailbox local part."""
    keys = []
    if username:
        keys.append(_safe_key(username))
    if address:
        keys.append(_safe_key(address.split("@", 1)[0]))
        keys.append(_safe_key(address))
    for k in keys:
        if not k:
            continue
        p = os.path.join(SIG_DIR, k + ".png")
        # belt-and-braces against traversal even though _safe_key already strips separators
        if os.path.isfile(p) and os.path.commonpath([os.path.abspath(p), SIG_DIR]) == SIG_DIR:
            return p
    return None


def load_signature(username: str = "", address: str = "") -> Optional[bytes]:
    p = signature_path(username, address)
    if not p:
        return None
    try:
        with open(p, "rb") as fh:
            return fh.read()
    except OSError as exc:
        logger.warning("could not read signature %s: %s", p, exc)
        return None


def signature_html(cid: str) -> str:
    """The block that goes UNDER the body. Width is set in both the attribute and the style because
    Outlook ignores one and Gmail ignores the other."""
    return (
        '<div style="margin-top:18px;">'
        '<img src="cid:%s" alt="" width="%d" '
        'style="width:%dpx;max-width:100%%;height:auto;display:block;border:0;outline:none;">'
        '</div>' % (cid, SIG_DISPLAY_W, SIG_DISPLAY_W)
    )


def build_message(from_addr: str, to_addrs, subject: str, html_body: str,
                  text_body: str = "", username: str = "", signature: Optional[bytes] = None,
                  extra_headers: Optional[dict] = None) -> EmailMessage:
    """Assemble a message whose signature renders inline, below the body.

    Structure (the one mail clients actually agree on):
        multipart/alternative
          ├── text/plain
          └── multipart/related
                ├── text/html          -> references cid:signature
                └── image/png          -> inline, Content-ID: <signature>

    A plain-text part is always included. An HTML-only message carrying a single large image is one
    of the strongest spam signals there is, which matters most for exactly the campaign mail this
    was built for.
    """
    if isinstance(to_addrs, str):
        to_addrs = [to_addrs]
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    for k, v in (extra_headers or {}).items():
        if v:
            msg[k] = v

    if signature is None:
        signature = load_signature(username, from_addr)

    cid = "signature"
    html = html_body
    if signature:
        html = html_body + signature_html(cid)

    msg.set_content(text_body or _html_to_text(html_body))
    # The body is pinned to dark-on-white deliberately. The signature is a white card (it has to be —
    # flattening the alpha is what keeps it at ~100 KB), so leaving the body to a client's dark-mode
    # palette would put light text directly above a bright white block and look broken.
    msg.add_alternative(
        '<html><body style="margin:0;padding:0;background:#ffffff;color:#222222;'
        'font:14px/1.55 Arial,Helvetica,sans-serif;">' + html + "</body></html>", subtype="html")

    if signature:
        # the HTML alternative becomes the multipart/related once the image is related to it
        msg.get_payload()[-1].add_related(signature, "image", "png", cid="<%s>" % cid,
                                          disposition="inline", filename="signature.png")
    return msg


def _html_to_text(html: str) -> str:
    """A readable plain-text fallback. Deliberately blunt — this is a fallback, not a renderer."""
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html or "")
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", t)
    t = re.sub(r"(?s)<[^>]+>", "", t)
    t = (t.replace("&nbsp;", " ").replace("&amp;", "&")
          .replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'").replace("&quot;", '"'))
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", t).strip()
