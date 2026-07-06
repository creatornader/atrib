# SPDX-License-Identifier: Apache-2.0
"""Conformance tests for spec/conformance/1.4 (§1.4 signing and verification).

Runs the Python SDK against both corpus files:

- ``signing-vectors.json``: the full positive signing pipeline. Every
  conforming implementation MUST produce byte-identical canonical forms,
  signatures, record hashes, propagation tokens, and chain roots.
- ``adversarial-vectors.json`` (D101): Wycheproof-style negative vectors —
  bit-flipped/truncated signatures, wrong keys, malformed context_id,
  non-URI event_type, and JCS optional-field ordering.

The corpus files are fixtures and are never modified. Clocks are pinned by
passing ``now_ms`` explicitly (record timestamp for signing vectors, the
manifest ``generated_at`` for adversarial vectors) so verification results
are deterministic regardless of wall time.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from atrib import (
    canonical_signing_input,
    encode_token,
    event_type_uri_to_byte,
    get_public_key,
    hex_decode,
    hex_encode,
    is_normative_event_type_uri,
    record_hash_hex,
    record_hash_ref,
    sha256,
    sign_record,
    validate_submission,
    verify_record,
)

CORPUS_DIR = Path(__file__).resolve().parents[3] / "spec" / "conformance" / "1.4"

SIGNING = json.loads((CORPUS_DIR / "signing-vectors.json").read_text(encoding="utf-8"))
ADVERSARIAL = json.loads(
    (CORPUS_DIR / "adversarial-vectors.json").read_text(encoding="utf-8")
)

SIGNING_VECTORS = SIGNING["vectors"]
ADVERSARIAL_VECTORS = ADVERSARIAL["vectors"]
# Deterministic clock for adversarial verification: the corpus manifest's
# generated_at equals every vector's record timestamp.
ADVERSARIAL_NOW_MS = ADVERSARIAL["generated_at"]

signing_vector = pytest.mark.parametrize(
    "vector", SIGNING_VECTORS, ids=[v["name"] for v in SIGNING_VECTORS]
)
adversarial_vector = pytest.mark.parametrize(
    "vector", ADVERSARIAL_VECTORS, ids=[v["name"] for v in ADVERSARIAL_VECTORS]
)


def _signed_record(vector: dict) -> dict:
    """The vector's record with the corpus' expected signature filled in.

    Built from expected values (not from ``sign_record`` output) so each
    downstream assertion checks the SDK against the corpus independently.
    """
    return {
        **vector["input"]["record"],
        "signature": vector["expected"]["signature_base64url"],
    }


class TestSigningVectors:
    """signing-vectors.json: positive pipeline, byte-for-byte."""

    def test_corpus_shape(self) -> None:
        assert SIGNING["spec_version"] == "atrib/1.0"
        assert len(SIGNING_VECTORS) == 4

    @signing_vector
    def test_public_key_derivation(self, vector: dict) -> None:
        seed = hex_decode(vector["input"]["private_key_seed_hex"])
        assert hex_encode(get_public_key(seed)) == vector["expected"]["public_key_hex"]

    @signing_vector
    def test_canonical_signing_input(self, vector: dict) -> None:
        signing_input = canonical_signing_input(vector["input"]["record"])
        assert (
            signing_input.decode("utf-8")
            == vector["expected"]["canonical_signing_input"]
        )
        assert (
            hex_encode(sha256(signing_input))
            == vector["expected"]["signing_input_sha256_hex"]
        )

    @signing_vector
    def test_deterministic_signature(self, vector: dict) -> None:
        seed = hex_decode(vector["input"]["private_key_seed_hex"])
        signed = sign_record(vector["input"]["record"], seed)
        # Pure EdDSA (RFC 8032) is deterministic: exact signature match.
        assert signed["signature"] == vector["expected"]["signature_base64url"]

    @signing_vector
    def test_record_hash(self, vector: dict) -> None:
        assert (
            record_hash_hex(_signed_record(vector))
            == vector["expected"]["record_hash_hex"]
        )

    @signing_vector
    def test_propagation_token(self, vector: dict) -> None:
        assert (
            encode_token(_signed_record(vector))
            == vector["expected"]["propagation_token"]
        )

    @signing_vector
    def test_next_chain_root(self, vector: dict) -> None:
        assert (
            record_hash_ref(_signed_record(vector))
            == vector["expected"]["next_chain_root"]
        )

    @signing_vector
    def test_verification(self, vector: dict) -> None:
        record = _signed_record(vector)
        # Pin the clock at the record's own timestamp — safely at/after the
        # record time and inside the 5-minute future-skew window.
        assert (
            verify_record(record, now_ms=record["timestamp"])
            is vector["expected"]["verification_passes"]
        )

    @signing_vector
    def test_event_type_classification(self, vector: dict) -> None:
        event_type = vector["input"]["record"]["event_type"]
        assert (
            is_normative_event_type_uri(event_type)
            is vector["expected"]["is_normative_event_type"]
        )
        assert event_type_uri_to_byte(event_type) == int(
            vector["expected"]["log_entry_byte"], 16
        )


class TestAdversarialVectors:
    """adversarial-vectors.json: negative + canonicalization edge cases."""

    def test_corpus_shape(self) -> None:
        assert ADVERSARIAL["spec_section"] == "1.4"
        assert len(ADVERSARIAL_VECTORS) == 7

    @adversarial_vector
    def test_verification_matches_expected(self, vector: dict) -> None:
        assert (
            verify_record(vector["input"]["record"], now_ms=ADVERSARIAL_NOW_MS)
            is vector["expected"]["verification_passes"]
        )

    @adversarial_vector
    def test_submission_validation_matches_expected(self, vector: dict) -> None:
        if "submission_validation_passes" not in vector["expected"]:
            pytest.skip("vector does not pin submission validation")
        result = validate_submission(
            vector["input"]["record"], now_ms=ADVERSARIAL_NOW_MS
        )
        assert result.ok is vector["expected"]["submission_validation_passes"]
        if not result.ok:
            assert result.status == 400
            assert result.error

    @adversarial_vector
    def test_canonical_signing_input_where_present(self, vector: dict) -> None:
        if "canonical_signing_input" not in vector["expected"]:
            pytest.skip("vector does not pin the canonical signing input")
        signing_input = canonical_signing_input(vector["input"]["record"])
        assert (
            signing_input.decode("utf-8")
            == vector["expected"]["canonical_signing_input"]
        )
        assert (
            hex_encode(sha256(signing_input))
            == vector["expected"]["signing_input_sha256_hex"]
        )
