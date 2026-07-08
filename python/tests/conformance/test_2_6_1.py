# SPDX-License-Identifier: Apache-2.0
"""Conformance tests for spec/conformance/2.6.1 (the §2.6.1 submission API).

Python client-side consumer of the shared submission-API corpus. This is
NOT a log server, so the harness scope is the client-side split the corpus
README allows:

- Steps 2-5 run through ``validate_submission`` (the §2.6.1 Steps 2-5
  port of ``packages/mcp/src/validation.ts``).
- Step 1 (Ed25519 signature) runs through ``verify_record`` (§1.4.3). The
  reject-bad-signature case therefore asserts validation PASSES while
  verification FAILS — the structural body is fine, the signature is not.
- Step 0 (non-JSON body) asserts that JSON parsing of the raw string body
  raises, i.e. rejection happens before any §2.6.1 step could run.
- Step 6 (sequences/idempotent-resubmission) is SKIPPED with justification:
  idempotent resubmission is server state (a log that returns the existing
  proof bundle and keeps log_size stable); a client-side validator has no
  log to resubmit against. The corpus README explicitly allows a
  per-implementation skip list with justification (the TS dev-log consumer
  does the same for Step 1).

Clock handling per the corpus README: every validation/verification call
pins ``now_ms`` to the manifest's ``reference_time_ms`` so the frozen
record timestamps (including the 20-minutes-in-the-future reject case)
behave deterministically regardless of wall time.

The corpus files are fixtures and are never modified.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from atrib import (
    base64url_decode,
    base64url_encode,
    get_public_key,
    record_hash_hex,
    validate_submission,
    verify_record,
)

CORPUS_DIR = Path(__file__).resolve().parents[3] / "spec" / "conformance" / "2.6.1"

MANIFEST = json.loads((CORPUS_DIR / "manifest.json").read_text(encoding="utf-8"))
REFERENCE_TIME_MS: int = MANIFEST["reference_time_ms"]


def load_case(rel_file: str) -> dict:
    return json.loads((CORPUS_DIR / rel_file).read_text(encoding="utf-8"))


def cases_with_step(*steps: object) -> list[dict]:
    """Manifest cases whose validation_step is one of ``steps`` (None = accept)."""
    selected = [c for c in MANIFEST["cases"] if c["validation_step"] in steps]
    assert selected, f"corpus has no cases for steps {steps!r}"
    return selected


class TestManifest:
    """Sanity-pin the manifest's deterministic signing inputs."""

    def test_reference_time_is_pinned(self) -> None:
        assert REFERENCE_TIME_MS == 1767225600000
        assert MANIFEST["reference_time_iso"] == "2026-01-01T00:00:00.000Z"

    def test_creator_key_derives_from_seed(self) -> None:
        # The corpus seed must re-derive the pinned creator_key, so this
        # consumer could independently re-sign the fixtures if it wanted.
        seed = base64url_decode(MANIFEST["signing"]["seed_b64url"])
        assert len(seed) == 32
        assert (
            base64url_encode(get_public_key(seed))
            == MANIFEST["signing"]["creator_key_b64url"]
        )

    def test_corpus_covers_all_seven_steps(self) -> None:
        steps = {c["validation_step"] for c in MANIFEST["cases"]}
        steps |= {s["validation_step"] for s in MANIFEST["sequences"]}
        assert steps == {None, 0, 1, 2, 3, 4, 5, 6}


class TestAcceptCases:
    """validation_step null: the log MUST accept (200)."""

    ACCEPT = cases_with_step(None)

    @pytest.mark.parametrize(
        "entry", ACCEPT, ids=[c["name"] for c in ACCEPT]
    )
    def test_validation_passes(self, entry: dict) -> None:
        case = load_case(entry["file"])
        assert entry["expected_status"] == 200
        assert case["expected"]["status"] == 200
        body = case["request"]["body"]
        result = validate_submission(body, now_ms=REFERENCE_TIME_MS)
        assert result.ok is True
        assert result.error is None

    @pytest.mark.parametrize(
        "entry", ACCEPT, ids=[c["name"] for c in ACCEPT]
    )
    def test_signature_verifies(self, entry: dict) -> None:
        # Step 1 (client-side): §1.4.3 verification passes at the
        # reference time.
        body = load_case(entry["file"])["request"]["body"]
        assert verify_record(body, now_ms=REFERENCE_TIME_MS) is True

    @pytest.mark.parametrize(
        "entry", ACCEPT, ids=[c["name"] for c in ACCEPT]
    )
    def test_record_hash_matches_manifest_index(self, entry: dict) -> None:
        # record_hash = SHA-256(JCS(complete record INCLUDING signature)),
        # pinned bare-hex in the manifest's record_hash_index.
        body = load_case(entry["file"])["request"]["body"]
        assert (
            record_hash_hex(body) == MANIFEST["record_hash_index"][entry["name"]]
        )


class TestStep0NonJsonBody:
    """Step 0: the raw body is not JSON; rejection precedes every §2.6.1 step."""

    STEP0 = cases_with_step(0)

    @pytest.mark.parametrize(
        "entry", STEP0, ids=[c["name"] for c in STEP0]
    )
    def test_body_does_not_parse_as_json(self, entry: dict) -> None:
        case = load_case(entry["file"])
        assert case["request"]["body_is_raw_string"] is True
        assert case["expected"]["status"] == 400
        body = case["request"]["body"]
        assert isinstance(body, str)
        with pytest.raises(json.JSONDecodeError):
            json.loads(body)


class TestStep1BadSignature:
    """Step 1: structural validation passes, Ed25519 verification fails."""

    STEP1 = cases_with_step(1)

    @pytest.mark.parametrize(
        "entry", STEP1, ids=[c["name"] for c in STEP1]
    )
    def test_validates_but_does_not_verify(self, entry: dict) -> None:
        case = load_case(entry["file"])
        assert case["expected"]["status"] == 400
        body = case["request"]["body"]
        # The body is structurally well-formed: Steps 2-5 pass...
        result = validate_submission(body, now_ms=REFERENCE_TIME_MS)
        assert result.ok is True
        # ...but the §1.4.3 signature check (Step 1) fails, which is what
        # earns this case its 400 on a full log implementation.
        assert verify_record(body, now_ms=REFERENCE_TIME_MS) is False


class TestSteps2To5Rejects:
    """Steps 2-5: validate_submission rejects with 400 and a useful error."""

    REJECTS = cases_with_step(2, 3, 4, 5)

    @pytest.mark.parametrize(
        "entry", REJECTS, ids=[c["name"] for c in REJECTS]
    )
    def test_validation_rejects_with_400(self, entry: dict) -> None:
        case = load_case(entry["file"])
        assert entry["expected_status"] == 400
        assert case["expected"]["status"] == 400
        body = case["request"]["body"]
        result = validate_submission(body, now_ms=REFERENCE_TIME_MS)
        assert result.ok is False
        assert result.status == 400
        assert isinstance(result.error, str) and result.error
        error_contains = case["expected"].get("error_contains")
        if error_contains is not None:
            assert error_contains in result.error

    def test_future_timestamp_depends_on_mocked_clock(self) -> None:
        # Prove the clock pin matters: the reject-future-timestamp record
        # (20 min past reference) is INSIDE the 10-minute window if "now"
        # drifts to its own timestamp — only the manifest reference time
        # makes the fixture reject deterministically.
        entry = next(
            c for c in MANIFEST["cases"] if c["name"] == "reject-future-timestamp"
        )
        body = load_case(entry["file"])["request"]["body"]
        assert body["timestamp"] - REFERENCE_TIME_MS > 10 * 60 * 1000
        assert validate_submission(body, now_ms=REFERENCE_TIME_MS).ok is False
        assert validate_submission(body, now_ms=body["timestamp"]).ok is True


class TestStep6Sequences:
    """Step 6 (idempotent resubmission) is server-state; skipped by design."""

    @pytest.mark.skip(
        reason=(
            "Step 6 (sequences/idempotent-resubmission.json) exercises server "
            "state: submitting the same record twice must return the SAME "
            "log_index/proof bundle and leave log_size at 1. The Python "
            "package is a client-side producer/validator with no log storage "
            "to resubmit against, so the sequence cannot be honored here. "
            "Documented per the corpus README's per-implementation skip-list "
            "allowance (the TS dev-log consumer maintains the same kind of "
            "list for Step 1)."
        )
    )
    def test_idempotent_resubmission(self) -> None:  # pragma: no cover
        raise AssertionError("unreachable: server-state sequence is skipped")

    def test_sequence_fixture_is_well_formed(self) -> None:
        # Even though the sequence itself is skipped, pin that the fixture
        # exists, targets Step 6, and that its record matches the
        # manifest's record_hash_index so a future server-side consumer
        # picks up exactly this body.
        entry = MANIFEST["sequences"][0]
        assert entry["validation_step"] == 6
        sequence = load_case(entry["file"])
        steps = sequence["steps"]
        assert len(steps) >= 2
        first_body = steps[0]["request"]["body"]
        assert (
            record_hash_hex(first_body)
            == MANIFEST["record_hash_index"][entry["name"]]
        )
        assert validate_submission(first_body, now_ms=REFERENCE_TIME_MS).ok is True
        assert verify_record(first_body, now_ms=REFERENCE_TIME_MS) is True
