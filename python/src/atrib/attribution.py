# SPDX-License-Identifier: Apache-2.0
"""``dev.atrib/attribution`` extension receipts (accepted as D141).

Python parity for the TypeScript SDK's receipt surface: lenient parsing of
the extension block from a tool result's ``_meta``, and a consistency check
of a receipt's claims against the signed record it names. Receipts are
advisory — a mismatch never invalidates the tool result; it means the
receipt must not be trusted or cited. Conformance:
``spec/conformance/mcp-extension/cases/receipt--*.json``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import cast

from .encoding import base64url_encode, hex_encode
from .hashes import record_hash_hex, record_hash_ref
from .token import decode_token, encode_token
from .types import AtribRecord, normalize_event_type

ATTRIBUTION_EXTENSION_KEY = "dev.atrib/attribution"

_RECEIPT_STRING_FIELDS = (
    "record_hash",
    "creator_key",
    "context_id",
    "event_type",
    "chain_root",
    "log_submission",
)

ATTRIBUTION_LOG_SUBMISSION_STATUSES = ("queued", "submitted", "disabled", "failed")


@dataclass(frozen=True)
class AttributionReceiptBlock:
    token: str | None = None
    receipt: Mapping[str, str] | None = None
    record: AtribRecord | None = None


@dataclass(frozen=True)
class AttributionReceiptConsistency:
    receipt_valid: bool
    mismatched_fields: list[str] = field(default_factory=list)
    attached_record_hash: str | None = None
    claimed_record_hash: str | None = None


def parse_attribution_receipt_block(meta: object) -> AttributionReceiptBlock | None:
    """Extract the extension block from a tool result's ``_meta``. Lenient
    parse: anything malformed yields None, never a raise; wrong-typed
    fields drop; an all-wrong-typed receipt reads as absent."""
    if not isinstance(meta, Mapping):
        return None
    raw = meta.get(ATTRIBUTION_EXTENSION_KEY)
    if not isinstance(raw, Mapping):
        return None
    token = raw.get("token")
    parsed_token = token if isinstance(token, str) else None
    parsed_receipt: dict[str, str] | None = None
    raw_receipt = raw.get("receipt")
    if isinstance(raw_receipt, Mapping):
        kept = {
            fld: value
            for fld in _RECEIPT_STRING_FIELDS
            if isinstance(value := raw_receipt.get(fld), str)
        }
        if kept:
            parsed_receipt = kept
    raw_record = raw.get("record")
    parsed_record = (
        cast(AtribRecord, dict(raw_record)) if isinstance(raw_record, Mapping) else None
    )
    if parsed_token is None and parsed_receipt is None and parsed_record is None:
        return None
    return AttributionReceiptBlock(
        token=parsed_token, receipt=parsed_receipt, record=parsed_record
    )


def check_attribution_receipt_consistency(
    block: AttributionReceiptBlock,
    record: AtribRecord | None = None,
) -> AttributionReceiptConsistency:
    """Check a receipt block's claims against the signed record they name
    (the attached ``block.record`` or a caller-retrieved record). Absent
    receipt fields are not mismatches. Never raises."""
    attached = record if record is not None else block.record
    receipt = block.receipt or {}
    claimed = receipt.get("record_hash")
    if attached is None:
        return AttributionReceiptConsistency(
            receipt_valid=False,
            mismatched_fields=["record"],
            claimed_record_hash=claimed,
        )
    try:
        attached_hash = record_hash_ref(attached)
        token = encode_token(attached)
    except Exception:  # noqa: BLE001 — unhashable record cannot back a receipt
        return AttributionReceiptConsistency(
            receipt_valid=False,
            mismatched_fields=["record"],
            claimed_record_hash=claimed,
        )
    mismatched: list[str] = []
    if claimed is not None and claimed != attached_hash:
        mismatched.append("record_hash")
    if block.token is not None and block.token != token:
        mismatched.append("token")
    for fld in ("creator_key", "context_id", "chain_root"):
        value = receipt.get(fld)
        if value is not None and value != attached.get(fld):
            mismatched.append(fld)
    claimed_event = receipt.get("event_type")
    attached_event = attached.get("event_type")
    if claimed_event is not None and normalize_event_type(claimed_event) != (
        normalize_event_type(attached_event) if isinstance(attached_event, str) else None
    ):
        mismatched.append("event_type")
    return AttributionReceiptConsistency(
        receipt_valid=not mismatched,
        mismatched_fields=mismatched,
        attached_record_hash=attached_hash,
        claimed_record_hash=claimed,
    )


# ── Receipt verification (extension spec §6.2, consumer side) ────────────

_RECEIPT_REQUIRED_STRING_FIELDS = _RECEIPT_STRING_FIELDS


@dataclass(frozen=True)
class AttributionReceiptVerification:
    """Outcome of :func:`verify_attribution_receipt`. ``mismatched`` uses
    the TS vocabulary exactly: ``'token'``, ``'record_hash'``,
    ``'creator_key'``, ``'context_id'``, ``'chain_root'``,
    ``'log_submission'``, or ``['malformed']`` when the block is not
    structurally a v0.1 result block."""

    valid: bool
    mismatched: list[str] = field(default_factory=list)


def _is_structurally_receipt_block(block: object) -> bool:
    if not isinstance(block, Mapping):
        return False
    if not isinstance(block.get("token"), str):
        return False
    receipt = block.get("receipt")
    if not isinstance(receipt, Mapping):
        return False
    for fld in _RECEIPT_REQUIRED_STRING_FIELDS:
        if not isinstance(receipt.get(fld), str):
            return False
    # TS parity: `record !== undefined && !isPlainObject(record)` — a
    # present-but-null (None) record is malformed; an absent one is fine.
    if "record" in block and not isinstance(block["record"], Mapping):
        return False
    return True


def verify_attribution_receipt(block: object) -> AttributionReceiptVerification:
    """Consumer-side receipt integrity check (extension spec §6.2), the
    exact port of the TS ``verifyAttributionReceipt``: the token,
    ``record_hash``, and ``creator_key`` must agree with each other and —
    when the full record body is attached — recompute from the record's
    canonical bytes. A consumer that detects an internal inconsistency MUST
    treat the receipt as invalid and discard it; receipt invalidity never
    invalidates the tool result itself.

    This checks internal consistency only; it is not a proof. Callers
    wanting Tier-3 assurance additionally verify the attached record's
    Ed25519 signature (:func:`atrib.verify_record`) and, where required,
    log inclusion via an independently fetched proof bundle.

    Never raises: hostile input yields ``valid=False`` with
    ``mismatched=['malformed']``.
    """
    if not _is_structurally_receipt_block(block):
        return AttributionReceiptVerification(valid=False, mismatched=["malformed"])
    mblock = cast("Mapping[str, object]", block)  # narrowed by the structural check
    receipt = cast("Mapping[str, object]", mblock["receipt"])
    token = cast(str, mblock["token"])
    mismatched: list[str] = []
    decoded = decode_token(token)
    if decoded is None:
        return AttributionReceiptVerification(valid=False, mismatched=["token"])
    token_hash_hex = hex_encode(decoded.record_hash)
    token_key = base64url_encode(decoded.creator_key)

    if receipt["record_hash"] != f"sha256:{token_hash_hex}":
        mismatched.append("record_hash")
    if receipt["creator_key"] != token_key:
        mismatched.append("creator_key")
    if receipt["log_submission"] not in ATTRIBUTION_LOG_SUBMISSION_STATUSES:
        mismatched.append("log_submission")

    record = mblock.get("record")
    if isinstance(record, Mapping):
        try:
            record_hex = record_hash_hex(record)
            record_token = encode_token(record)
        except Exception:  # noqa: BLE001 — unhashable attached record
            # The TS reference would propagate here; Python keeps the
            # never-raise contract and reports the block as malformed.
            return AttributionReceiptVerification(valid=False, mismatched=["malformed"])
        if token != record_token and "token" not in mismatched:
            mismatched.append("token")
        if (
            receipt["record_hash"] != f"sha256:{record_hex}"
            and "record_hash" not in mismatched
        ):
            mismatched.append("record_hash")
        if (
            receipt["creator_key"] != record.get("creator_key")
            and "creator_key" not in mismatched
        ):
            mismatched.append("creator_key")
        if receipt["context_id"] != record.get("context_id"):
            mismatched.append("context_id")
        if receipt["chain_root"] != record.get("chain_root"):
            mismatched.append("chain_root")

    return AttributionReceiptVerification(valid=not mismatched, mismatched=mismatched)
