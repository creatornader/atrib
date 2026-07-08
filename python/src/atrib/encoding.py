# SPDX-License-Identifier: Apache-2.0
"""base64url (RFC 4648 §5, no padding) and lowercase-hex codecs.

Byte-for-byte parity with ``@atrib/mcp``'s base64url.ts / hash.ts encoders.
"""

from __future__ import annotations

import base64
import binascii


def base64url_encode(data: bytes) -> str:
    """Encode bytes as base64url without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(value: str) -> bytes:
    """Decode unpadded base64url. Raises ValueError on malformed input."""
    padding = -len(value) % 4
    try:
        return base64.urlsafe_b64decode(value + "=" * padding)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"atrib: invalid base64url input: {exc}") from exc


def hex_encode(data: bytes) -> str:
    """Encode bytes as lowercase hex."""
    return data.hex()


def hex_decode(value: str) -> bytes:
    """Decode lowercase (or mixed-case) hex. Raises ValueError on malformed input."""
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError(f"atrib: invalid hex input: {exc}") from exc
