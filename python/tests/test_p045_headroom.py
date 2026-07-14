# SPDX-License-Identifier: Apache-2.0
"""P045 key-API headroom (SDK brief post-spawn addendum 5).

Delegation certificates are NOT implemented, but canonicalization must
already tolerate a future OPTIONAL ``delegation_cert_hash`` genesis field:
JCS-slotted between ``creator_key`` and ``event_type``, omitted-not-null.
"""

from __future__ import annotations

from atrib import (
    canonical_signing_input,
    genesis_chain_root,
    record_hash_hex,
    sign_record,
    verify_record,
)

SEED = bytes.fromhex("11" * 32)
NOW_MS = 1700000000000


def _base_record() -> dict[str, object]:
    return {
        "spec_version": "atrib/1.0",
        "content_id": "sha256:" + "ab" * 32,
        "creator_key": "0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc",
        "chain_root": genesis_chain_root("a" * 32),
        "event_type": "https://atrib.dev/v1/types/observation",
        "context_id": "a" * 32,
        "timestamp": NOW_MS,
    }


def test_future_field_slots_between_creator_key_and_event_type() -> None:
    record = {**_base_record(), "delegation_cert_hash": "sha256:" + "cd" * 32}
    canonical = canonical_signing_input(record).decode("utf-8")
    creator_idx = canonical.index('"creator_key"')
    cert_idx = canonical.index('"delegation_cert_hash"')
    event_idx = canonical.index('"event_type"')
    assert creator_idx < cert_idx < event_idx


def test_signs_and_verifies_with_future_field() -> None:
    record = {**_base_record(), "delegation_cert_hash": "sha256:" + "cd" * 32}
    signed = sign_record(record, SEED)
    assert verify_record(signed, now_ms=NOW_MS) is True


def test_presence_changes_signature_and_hash() -> None:
    plain = sign_record(_base_record(), SEED)
    with_cert = sign_record(
        {**_base_record(), "delegation_cert_hash": "sha256:" + "cd" * 32}, SEED
    )
    assert plain["signature"] != with_cert["signature"]
    assert record_hash_hex(plain) != record_hash_hex(with_cert)
