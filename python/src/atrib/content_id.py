# SPDX-License-Identifier: Apache-2.0
"""content_id derivation (§1.2.2).

Port of ``packages/mcp/src/content-id.ts``. The TS implementation uses the
WHATWG URL parser, which lowercases scheme/host and DROPS default ports
(443 for https, 80 for http); this port reproduces those semantics with
urllib so identical inputs yield identical content_ids.
"""

from __future__ import annotations

import hashlib
from urllib.parse import urlsplit

from .encoding import hex_encode

_DEFAULT_PORTS = {"https": 443, "http": 80, "ws": 80, "wss": 443, "ftp": 21}


def normalize_server_url(url: str) -> str:
    """Normalize per §1.2.2: lowercase scheme+host, keep an explicit
    non-default port, strip trailing slash, drop query/fragment."""
    if not url:
        return ""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return url.lower()
    if not parsed.scheme or "://" not in url:
        # Not an absolute URL the WHATWG parser would accept; mirror the TS
        # fallback of lowercasing the raw string.
        return url.lower()
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    try:
        port = parsed.port
    except ValueError:
        return url.lower()
    netloc = host
    if port is not None and _DEFAULT_PORTS.get(scheme) != port:
        netloc = f"{host}:{port}"
    path = parsed.path
    if path.endswith("/"):
        path = path[:-1] if path != "/" else ""
    if path == "/":
        path = ""
    return f"{scheme}://{netloc}{path}"


def compute_content_id(server_url: str, tool_name: str) -> str:
    """content_id = "sha256:" + hex(SHA-256(UTF-8(normalized + ":" + tool)))."""
    normalized = normalize_server_url(server_url)
    digest = hashlib.sha256(f"{normalized}:{tool_name}".encode("utf-8")).digest()
    return f"sha256:{hex_encode(digest)}"
