# SPDX-License-Identifier: Apache-2.0
"""Conformance tests for spec/conformance/1.2.6 (§1.2.6 provenance_token, D044).

Python mirror of ``packages/verify/test/conformance-1.2.6.test.ts``. Loads
each case from ``spec/conformance/1.2.6/cases/`` and asserts the expected
invariants:

- ``genesis-with-provenance``: JCS field-order invariant (provenance_token
  sorts between informed_by and session_token) and signature round-trip.
- ``upstream-derivation``: token = base64url(sha256(JCS(upstream))[:16]).
- ``non-genesis-with-provenance``: the structural §1.2.6 rejection
  condition (provenance_token present while chain_root is NOT the genesis
  chain_root). Client-side ``validate_submission`` is the §2.6.1 Steps 2-5
  port and does not implement the policy-layer genesis-only check (same
  scope as the TypeScript ``packages/mcp/src/validation.ts`` port), so the
  test asserts the structural condition plus the corpus pin — mirroring
  the TS reference test.
- ``omits-when-absent``: absence-not-null — the canonical form omits the
  field entirely, and ADDING it changes the canonical bytes so the
  original signature no longer verifies.

Plus the producer-side enforcement: ``AtribClient.attest`` refuses a
provenance_token when the context already has mirrored records
(middleware SHOULD refuse per §1.2.6) and accepts it on a fresh context.

The corpus files are fixtures and are never modified. Clocks are pinned by
passing ``now_ms`` (the record's own timestamp) so results are
deterministic regardless of wall time.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from atrib import (
    AtribClient,
    base64url_encode,
    canonical_signing_input,
    derive_provenance_token,
    genesis_chain_root,
    hex_decode,
    read_mirror,
    record_hash_hex,
    record_hash_ref,
    sign_record,
    validate_submission,
    verify_record,
)

CORPUS_DIR = (
    Path(__file__).resolve().parents[3] / "spec" / "conformance" / "1.2.6" / "cases"
)


def load_case(name: str) -> dict:
    return json.loads((CORPUS_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _without_signature(record: dict) -> dict:
    return {k: v for k, v in record.items() if k != "signature"}


class TestGenesisWithProvenance:
    """genesis-with-provenance: signature round-trips with the field present."""

    CASE = load_case("genesis-with-provenance")

    def test_canonical_signing_input(self) -> None:
        record = self.CASE["input"]["record"]
        expected = self.CASE["expected"]
        # JCS form: provenance_token sorts between informed_by and
        # session_token; byte-exact match against the corpus.
        assert (
            canonical_signing_input(record).decode("utf-8")
            == expected["canonical_signing_input_utf8"]
        )

    def test_record_hash(self) -> None:
        assert (
            record_hash_hex(self.CASE["input"]["record"])
            == self.CASE["expected"]["record_hash_hex"]
        )

    def test_signature_reproducible_from_seed(self) -> None:
        record = self.CASE["input"]["record"]
        seed = hex_decode(self.CASE["input"]["signer_seed_hex"])
        # Pure EdDSA (RFC 8032) is deterministic: exact signature match.
        signed = sign_record(_without_signature(record), seed)
        assert signed["signature"] == record["signature"]

    def test_verifier_accepts(self) -> None:
        record = self.CASE["input"]["record"]
        assert (
            verify_record(record, now_ms=record["timestamp"])
            is self.CASE["expected"]["verifier_signature_ok"]
        )

    def test_validator_accepts(self) -> None:
        record = self.CASE["input"]["record"]
        result = validate_submission(record, now_ms=record["timestamp"])
        assert result.ok is self.CASE["expected"]["validator_should_accept"]

    def test_record_is_genesis(self) -> None:
        # The structural precondition that makes carrying provenance_token
        # legal: chain_root IS the genesis chain_root for the context.
        record = self.CASE["input"]["record"]
        assert record["chain_root"] == genesis_chain_root(record["context_id"])


class TestUpstreamDerivation:
    """upstream-derivation: token = base64url(sha256(JCS(upstream))[:16])."""

    CASE = load_case("upstream-derivation")

    def test_derived_token_matches(self) -> None:
        upstream = self.CASE["input"]["upstream_record"]
        assert (
            derive_provenance_token(upstream)
            == self.CASE["expected"]["derived_provenance_token"]
        )

    def test_downstream_carries_derived_token(self) -> None:
        downstream = self.CASE["input"]["downstream_record"]
        assert (
            downstream["provenance_token"]
            == self.CASE["expected"]["derived_provenance_token"]
        )

    def test_upstream_full_record_hash(self) -> None:
        upstream = self.CASE["input"]["upstream_record"]
        assert (
            record_hash_ref(upstream)
            == self.CASE["expected"]["upstream_full_record_hash"]
        )

    def test_downstream_signature_verifies(self) -> None:
        downstream = self.CASE["input"]["downstream_record"]
        assert (
            verify_record(downstream, now_ms=downstream["timestamp"])
            is self.CASE["expected"]["downstream_signature_verifies"]
        )

    def test_downstream_signature_reproducible_from_seed(self) -> None:
        downstream = self.CASE["input"]["downstream_record"]
        seed = hex_decode(self.CASE["input"]["downstream_signer_seed_hex"])
        signed = sign_record(_without_signature(downstream), seed)
        assert signed["signature"] == downstream["signature"]

    def test_downstream_is_genesis_and_validator_accepts(self) -> None:
        downstream = self.CASE["input"]["downstream_record"]
        # provenance_token rides on Bob's session-GENESIS record.
        assert downstream["chain_root"] == genesis_chain_root(
            downstream["context_id"]
        )
        result = validate_submission(downstream, now_ms=downstream["timestamp"])
        assert result.ok is self.CASE["expected"]["validator_should_accept"]


class TestNonGenesisWithProvenance:
    """non-genesis-with-provenance: genesis-only invariant (§1.2.6)."""

    CASE = load_case("non-genesis-with-provenance")

    def test_verifier_signature_ok(self) -> None:
        # Signature itself is valid; rejection is at the policy layer.
        record = self.CASE["input"]["record"]
        assert (
            verify_record(record, now_ms=record["timestamp"])
            is self.CASE["expected"]["verifier_signature_ok"]
        )

    def test_record_hash(self) -> None:
        assert (
            record_hash_hex(self.CASE["input"]["record"])
            == self.CASE["expected"]["record_hash_hex"]
        )

    def test_genesis_chain_root_for_context(self) -> None:
        record = self.CASE["input"]["record"]
        assert (
            genesis_chain_root(record["context_id"])
            == self.CASE["expected"]["genesis_chain_root_for_context"]
        )

    def test_structural_rejection_condition(self) -> None:
        # The §1.2.6 flag condition: provenance_token present while
        # chain_root is NOT the genesis chain_root for the context.
        record = self.CASE["input"]["record"]
        expected = self.CASE["expected"]
        assert "provenance_token" in record
        assert record["chain_root"] == expected["record_chain_root"]
        assert record["chain_root"] != expected["genesis_chain_root_for_context"]
        assert expected["verifier_should_flag"] is True

    def test_corpus_pins_validator_rejection(self) -> None:
        # Validators (§2.6.1 server side) MUST reject this record. The
        # Python client-side validate_submission is the Steps 2-5 port and
        # does not implement the policy-layer check (same scope as the TS
        # packages/mcp port), so — like the TS reference test — we assert
        # the corpus pin rather than a client-side rejection.
        expected = self.CASE["expected"]
        assert expected["validator_should_accept"] is False
        assert (
            expected["rejection_reason"]
            == "provenance_token on non-genesis record"
        )


class TestOmitsWhenAbsent:
    """omits-when-absent: absence-not-null contract by hashing."""

    CASE = load_case("omits-when-absent")

    def test_canonical_form_omits_field(self) -> None:
        record = self.CASE["input"]["record"]
        expected = self.CASE["expected"]
        signing_input = canonical_signing_input(record).decode("utf-8")
        assert signing_input == expected["canonical_signing_input_utf8"]
        assert (
            ("provenance_token" in signing_input)
            is expected["provenance_token_in_canonical_form"]
        )

    def test_record_hash(self) -> None:
        assert (
            record_hash_hex(self.CASE["input"]["record"])
            == self.CASE["expected"]["record_hash_hex"]
        )

    def test_verifier_and_validator_accept(self) -> None:
        record = self.CASE["input"]["record"]
        expected = self.CASE["expected"]
        assert (
            verify_record(record, now_ms=record["timestamp"])
            is expected["verifier_signature_ok"]
        )
        result = validate_submission(record, now_ms=record["timestamp"])
        assert result.ok is expected["validator_should_accept"]

    @pytest.mark.parametrize("injected", ["AAAAAAAAAAAAAAAAAAAAAA", ""])
    def test_adding_field_changes_canonical_bytes(self, injected: str) -> None:
        # Omission != null != empty: injecting the field (even empty)
        # produces different canonical bytes, so the original signature no
        # longer verifies.
        record = self.CASE["input"]["record"]
        expected = self.CASE["expected"]
        mutated = {**record, "provenance_token": injected}
        assert (
            canonical_signing_input(mutated).decode("utf-8")
            != expected["canonical_signing_input_utf8"]
        )
        assert record_hash_hex(mutated) != expected["record_hash_hex"]
        assert verify_record(mutated, now_ms=record["timestamp"]) is False


class TestClientGenesisOnlyEnforcement:
    """AtribClient.attest enforces §1.2.6 genesis-only on the producer side.

    Middleware SHOULD refuse a provenance_token when the local mirror
    already has records for the context (the record being signed would not
    be the session genesis).
    """

    SEED = bytes(range(32))
    CTX_OCCUPIED = "0dd80cc70dd80cc70dd80cc70dd80cc7"
    CTX_FRESH = "1e91f00d1e91f00d1e91f00d1e91f00d"
    TOKEN = "AAAAAAAAAAAAAAAAAAAAAA"

    def _client(self, tmp_path: Path) -> AtribClient:
        return AtribClient(
            env={"ATRIB_PRIVATE_KEY": base64url_encode(self.SEED)},
            mirror_write_path=tmp_path / "write.jsonl",
            mirror_read_path=tmp_path / "read.jsonl",
            # Unreachable anchor (port 9): submission is fire-and-forget
            # per §5.3.5/§5.8 and must not affect attest outcomes.
            anchors=["http://127.0.0.1:9/v1/entries"],
        )

    def test_rejects_on_context_with_existing_records(self, tmp_path: Path) -> None:
        client = self._client(tmp_path)

        # Occupy the context: a plain attest writes the genesis record to
        # the local mirror.
        first = client.attest({"note": "genesis"}, context_id=self.CTX_OCCUPIED)
        assert first.via == "in-process"
        assert first.context_id == self.CTX_OCCUPIED

        # A provenance_token on the now-occupied context MUST be refused.
        with pytest.raises(ValueError, match="genesis-only"):
            client.attest(
                {"note": "late anchor"},
                context_id=self.CTX_OCCUPIED,
                provenance_token=self.TOKEN,
            )

        # The refused attest must not have written anything.
        mirrored = read_mirror(tmp_path / "write.jsonl")
        assert len(mirrored) == 1
        assert "provenance_token" not in mirrored[0].record

    def test_accepts_on_fresh_context(self, tmp_path: Path) -> None:
        client = self._client(tmp_path)

        # Occupy a DIFFERENT context first: the genesis-only check is
        # per-context, not per-mirror-file.
        client.attest({"note": "genesis"}, context_id=self.CTX_OCCUPIED)

        result = client.attest(
            {"note": "anchored genesis"},
            context_id=self.CTX_FRESH,
            provenance_token=self.TOKEN,
        )
        assert result.via == "in-process"
        assert result.context_id == self.CTX_FRESH
        assert result.record_hash is not None
        assert result.record_hash.startswith("sha256:")

        # The mirrored record is a genesis record carrying the token, and
        # it verifies.
        mirrored = [
            line.record
            for line in read_mirror(tmp_path / "write.jsonl")
            if line.record.get("context_id") == self.CTX_FRESH
        ]
        assert len(mirrored) == 1
        record = mirrored[0]
        assert record["provenance_token"] == self.TOKEN
        assert record["chain_root"] == genesis_chain_root(self.CTX_FRESH)
        assert verify_record(record) is True
        assert record_hash_ref(record) == result.record_hash
