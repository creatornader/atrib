# SPDX-License-Identifier: Apache-2.0
"""content_id derivation (§1.2.2).

Port of ``packages/mcp/src/content-id.ts``. The TS implementation uses the
WHATWG URL parser; this port reproduces the WHATWG behaviors that reach the
normalized string so identical inputs yield identical content_ids:

- leading/trailing C0-control and space stripping on the whole URL;
- special schemes (http/https/ws/wss/ftp/file) collapse any run of slashes
  after the colon to ``//`` and REQUIRE a non-empty host (else the TS side
  throws and falls back to lowercasing the raw string);
- scheme and special-scheme hosts lowercase; DEFAULT ports drop;
- non-special schemes ("opaque hosts", e.g. ``mcp://``) preserve host case
  and keep any explicit port;
- IPv6 hosts keep their brackets;
- trailing path slash trims; query/fragment drop.

Adversarially cross-checked against the TS reference (2026-07-06); the
parity cases are pinned in ``python/tests/test_port_parity.py``.
"""

from __future__ import annotations

import hashlib
import re
from urllib.parse import urlsplit

from .encoding import hex_encode

_DEFAULT_PORTS = {"https": 443, "http": 80, "ws": 80, "wss": 443, "ftp": 21}
_SPECIAL_SCHEMES = frozenset(["http", "https", "ws", "wss", "ftp", "file"])
_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+\-.]*):(.*)\Z", re.DOTALL)
# WHATWG strips U+0000..U+0020 from both ends of the input URL.
_EDGE_STRIP = "".join(chr(i) for i in range(0x21))


def _split_userinfo(netloc: str) -> str:
    """Drop userinfo, keeping the host[:port] part verbatim."""
    _, _, hostport = netloc.rpartition("@")
    return hostport


def normalize_server_url(url: str) -> str:
    """Normalize per §1.2.2 with WHATWG parser semantics (see module doc)."""
    if not url:
        return ""
    trimmed = url.strip(_EDGE_STRIP)
    if not trimmed:
        return url.lower()
    scheme_match = _SCHEME_RE.match(trimmed)
    if not scheme_match:
        # No scheme: the WHATWG parser throws; TS falls back to lowercase.
        return url.lower()
    scheme = scheme_match.group(1).lower()
    rest = scheme_match.group(2)

    if scheme in _SPECIAL_SCHEMES:
        # WHATWG collapses 0..n slashes after a special scheme's colon.
        rest = rest.lstrip("/")
        candidate = f"{scheme}://{rest}"
        try:
            parsed = urlsplit(candidate)
            port = parsed.port
        except ValueError:
            return url.lower()
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            # Special schemes require a host; WHATWG throws → TS fallback.
            return url.lower()
        host = f"[{hostname}]" if ":" in hostname else hostname
        netloc = host
        if port is not None and _DEFAULT_PORTS.get(scheme) != port:
            netloc = f"{host}:{port}"
    else:
        try:
            parsed = urlsplit(f"{scheme}:{rest}")
            parsed.port  # noqa: B018 — validates the port; may raise
        except ValueError:
            return url.lower()
        # Opaque (non-special) hosts preserve case and explicit ports.
        netloc = _split_userinfo(parsed.netloc)

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
