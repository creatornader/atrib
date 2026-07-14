# SPDX-License-Identifier: Apache-2.0
"""Record-hash and provenance-token derivation (§1.2.3, §1.2.6).

record_hash = SHA-256 over the JCS-canonical COMPLETE record, including
``signature``. The signing input (which EXCLUDES ``signature``) is a
different byte string; see :mod:`atrib.canon`.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping

from .canon import canonical_record
from .encoding import base64url_encode, hex_encode


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def record_hash_bytes(record: Mapping[str, object]) -> bytes:
    """Raw 32-byte record hash of a signed record."""
    return sha256(canonical_record(record))


def record_hash_hex(record: Mapping[str, object]) -> str:
    """Record hash as bare 64-char lowercase hex."""
    return hex_encode(record_hash_bytes(record))


def record_hash_ref(record: Mapping[str, object]) -> str:
    """Record hash in ``sha256:<64-hex>`` reference form (chain_root,
    informed_by, annotates, revises)."""
    return f"sha256:{record_hash_hex(record)}"


def derive_provenance_token(upstream: Mapping[str, object]) -> str:
    """§1.2.6: base64url (no padding) of the first 16 bytes of the upstream
    record hash. Always 22 characters. Genesis-record-only field."""
    return base64url_encode(record_hash_bytes(upstream)[:16])
