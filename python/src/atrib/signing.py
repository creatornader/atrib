# SPDX-License-Identifier: Apache-2.0
"""Ed25519 signing and verification for atrib records (§1.4).

Port of ``packages/mcp/src/signing.ts``. Keys are raw 32-byte Ed25519
seeds (§1.4.1) — never 64-byte NaCl expanded format. Signatures are Pure
EdDSA (RFC 8032), base64url no padding (86 chars).
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import cast

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from .canon import canonical_cross_attestation_input, canonical_signing_input
from .encoding import base64url_decode, base64url_encode
from .types import (
    EVENT_TYPE_TRANSACTION_URI,
    SPEC_VERSION,
    AtribRecord,
    SignerEntry,
    is_valid_event_type_uri,
)

_CONTEXT_ID_HEX = frozenset("0123456789abcdef")
_FIVE_MINUTES_MS = 5 * 60 * 1000


def get_public_key(private_key: bytes) -> bytes:
    """Raw 32-byte Ed25519 public key for a 32-byte seed."""
    if len(private_key) != 32:
        raise ValueError("atrib: private key must be a 32-byte Ed25519 seed")
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    return key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


def sign_record(record: Mapping[str, object], private_key: bytes) -> AtribRecord:
    """§1.4.2: remove ``signature``, JCS-serialize, Ed25519-sign, base64url.

    Returns a new record dict with ``signature`` set. Optional fields keep
    their exact presence/absence from the input (omission ≠ null)."""
    if len(private_key) != 32:
        raise ValueError("atrib: private key must be a 32-byte Ed25519 seed")
    signing_input = canonical_signing_input(record)
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    signature = base64url_encode(key.sign(signing_input))
    signed = {k: v for k, v in record.items() if k != "signature"}
    signed["signature"] = signature
    return cast(AtribRecord, signed)


def sign_transaction_record(
    record: Mapping[str, object],
    private_key: bytes,
    counterparty_signers: list[SignerEntry] | None = None,
) -> AtribRecord:
    """§1.7.6: sign a transaction record's cross-attestation bytes. The
    returned record carries this creator's signer entry first, followed by
    caller-supplied counterparty entries over the same canonical bytes."""
    creator_key = base64url_encode(get_public_key(private_key))
    txn: dict[str, object] = {k: v for k, v in record.items() if k != "signers"}
    txn["creator_key"] = creator_key
    txn["signature"] = ""
    txn["signers"] = []
    signing_input = canonical_cross_attestation_input(txn)
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    entry: SignerEntry = {
        "creator_key": creator_key,
        "signature": base64url_encode(key.sign(signing_input)),
    }
    txn["signers"] = [entry, *(counterparty_signers or [])]
    return cast(AtribRecord, txn)


def sign_transaction_attestation(
    record: Mapping[str, object], private_key: bytes
) -> SignerEntry:
    """Create one counterparty signer entry over an existing transaction
    record's §1.7.6 cross-attestation bytes."""
    if record.get("event_type") != EVENT_TYPE_TRANSACTION_URI:
        raise ValueError("atrib: transaction attestation requires a transaction record")
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    signature = key.sign(canonical_cross_attestation_input(record))
    return {
        "creator_key": base64url_encode(get_public_key(private_key)),
        "signature": base64url_encode(signature),
    }


def _verify_ed25519(signature: bytes, message: bytes, public_key: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
        return True
    except (InvalidSignature, ValueError):
        return False


def verify_record(record: Mapping[str, object], *, now_ms: int | None = None) -> bool:
    """§1.4.3 verification, all 8 steps. True iff every step passes.

    ``now_ms`` injects the clock for corpus tests; defaults to wall time.
    """
    try:
        # Step 1: creator_key decodes to 32 bytes.
        creator_key = record.get("creator_key")
        if not isinstance(creator_key, str):
            return False
        pub_key = base64url_decode(creator_key)
        if len(pub_key) != 32:
            return False

        is_transaction = record.get("event_type") == EVENT_TYPE_TRANSACTION_URI
        signers = record.get("signers")
        has_signers = isinstance(signers, list) and len(signers) > 0

        if is_transaction and has_signers:
            creator_signer = next(
                (
                    entry
                    for entry in cast(list[dict[str, object]], signers)
                    if isinstance(entry, dict) and entry.get("creator_key") == creator_key
                ),
                None,
            )
            if creator_signer is None:
                return False
            entry_sig = creator_signer.get("signature")
            if not isinstance(entry_sig, str):
                return False
            sig = base64url_decode(entry_sig)
            if len(sig) != 64:
                return False
            if not _verify_ed25519(sig, canonical_cross_attestation_input(record), pub_key):
                return False
        else:
            # Step 2: signature decodes to 64 bytes.
            signature = record.get("signature")
            if not isinstance(signature, str):
                return False
            sig = base64url_decode(signature)
            if len(sig) != 64:
                return False
            # Steps 3–4: JCS minus signature, Ed25519 verify.
            if not _verify_ed25519(sig, canonical_signing_input(record), pub_key):
                return False

        # Step 5: spec_version.
        if record.get("spec_version") != SPEC_VERSION:
            return False

        # Step 6: event_type is a syntactically-valid absolute URI.
        if not is_valid_event_type_uri(record.get("event_type")):
            return False

        # Step 7: timestamp is a non-negative integer, not >5min future.
        timestamp = record.get("timestamp")
        if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp < 0:
            return False
        now = int(time.time() * 1000) if now_ms is None else now_ms
        if timestamp > now + _FIVE_MINUTES_MS:
            return False

        # Step 8: context_id is exactly 32 lowercase hex chars.
        context_id = record.get("context_id")
        if (
            not isinstance(context_id, str)
            or len(context_id) != 32
            or not all(c in _CONTEXT_ID_HEX for c in context_id)
        ):
            return False

        return True
    except (ValueError, TypeError):
        return False
