# SPDX-License-Identifier: Apache-2.0
"""Propagation token (§1.5.2).

``token = base64url(record_hash_bytes) + "." + base64url(creator_key_bytes)``
where both components are raw 32-byte values (no ``sha256:`` prefix).
Maximum length 43 + 1 + 43 = 87 chars, fitting the W3C tracestate limit.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .encoding import base64url_decode, base64url_encode
from .hashes import record_hash_bytes


@dataclass(frozen=True)
class DecodedToken:
    record_hash: bytes  # 32 bytes: SHA-256 of the JCS-canonical signed record
    creator_key: bytes  # 32 bytes: Ed25519 public key


def encode_token(record: Mapping[str, object]) -> str:
    """Compute the propagation token for a signed record."""
    creator_key = record.get("creator_key")
    if not isinstance(creator_key, str):
        raise ValueError("atrib: record has no creator_key")
    return f"{base64url_encode(record_hash_bytes(record))}.{base64url_encode(base64url_decode(creator_key))}"


def decode_token(token: str) -> DecodedToken | None:
    """Decode a propagation token. Returns None on any malformation
    (lenient parse per D018 — malformed tokens mean genesis, not errors)."""
    try:
        head, _, tail = token.partition(".")
        if not head or not tail:
            return None
        record_hash = base64url_decode(head)
        creator_key = base64url_decode(tail)
        if len(record_hash) != 32 or len(creator_key) != 32:
            return None
        return DecodedToken(record_hash=record_hash, creator_key=creator_key)
    except (ValueError, TypeError):
        return None
