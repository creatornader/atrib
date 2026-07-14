# SPDX-License-Identifier: Apache-2.0
"""D137 evidence-envelope conformance (spec §5.5.7) against the shared
corpus at ``spec/conformance/evidence-envelope/``.

Covers every case family the Python SDK implements: shape validation
accept/reject with the pinned reason codes, ``build_evidence_envelope``
reproducing corpus payload hashes from payload material via the stated
hash rule, profile-registry classification (full-URI identity, foreign
domains never collide), the deterministic legacy §5.5.6 → envelope mapping
including the one normative MUST-reject, and the tier semantics (identity
key, descending order, relay-swap detection, verified-but-withheld
reproducibility).

``tier--evidence-never-flips-valid`` exercises the OAuth authorization
verifier in ``@atrib/verify`` (evidence evaluation, not envelope
mechanics) and stays TS-side; the envelope-mapping half of its contract is
covered here by the legacy-mapping family.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from atrib import verify_record
from atrib.evidence import (
    FROZEN_LEGACY_PROTOCOLS,
    EvidenceEnvelope,
    assess_reproducibility,
    build_evidence_envelope,
    classify_profile,
    evidence_envelope_key,
    is_relay_identity_swap,
    is_valid_envelope,
    jcs_sha256,
    map_legacy_evidence_block,
    order_envelope_instances,
    raw_sha256,
    render_envelope_opaque,
    validate_envelope,
)

CASES = Path(__file__).parent.parent.parent.parent / (
    "spec/conformance/evidence-envelope/cases"
)


def _load(name: str) -> dict[str, object]:
    return cast("dict[str, object]", json.loads((CASES / name).read_text("utf-8")))


def _input(case: dict[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", case["input"])


def _expected(case: dict[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", case["expected"])


# ── shape family: validate_envelope over every accept/reject case ────────

_SHAPE_CASES = [
    "shape--minimal-valid.json",
    "shape--maximal-valid.json",
    "shape--missing-tier.json",
    "shape--missing-payload-hash.json",
    "shape--invalid-hash-prefix.json",
    "shape--invalid-tier-value.json",
    "shape--inline-with-non-inline-ref.json",
    "shape--record-kind-rejected.json",
    "shape--record-hash-sibling.json",
    "registry--non-https-profile-rejected.json",
    "registry--bare-name-profile-rejected.json",
]


@pytest.mark.parametrize("file", _SHAPE_CASES)
def test_validate_envelope_matches_corpus_accept(file: str) -> None:
    case = _load(file)
    envelope = _input(case)["envelope"]
    accept = cast(bool, _expected(case)["accept"])
    validation = validate_envelope(envelope)
    assert validation.ok is accept, file
    assert is_valid_envelope(envelope) is accept
    if not accept:
        for reason in cast("list[str]", _expected(case).get("reject_reasons", [])):
            assert reason in validation.errors, f"{file}: missing reason {reason}"
    else:
        assert validation.errors == []


def test_record_hash_sibling_binds_payload_to_a_verifiable_record() -> None:
    case = _load("shape--record-hash-sibling.json")
    envelope = cast("dict[str, object]", _input(case)["envelope"])
    referenced = cast("dict[str, object]", _input(case)["referenced_record"])
    payload = cast("dict[str, object]", envelope["payload"])
    ref = cast("dict[str, object]", payload["ref"])
    assert ref["record_hash"] == _expected(case)["record_hash"]
    if _expected(case).get("payload_hash_matches_record"):
        assert payload["hash"] == jcs_sha256(referenced)
    if _expected(case).get("referenced_record_signature_ok"):
        assert verify_record(referenced) is True


# ── build_evidence_envelope reproduces corpus commitments ────────────────


@pytest.mark.parametrize(
    "file", ["shape--minimal-valid.json", "shape--maximal-valid.json"]
)
def test_builder_reproduces_the_corpus_envelope(file: str) -> None:
    case = _load(file)
    corpus = cast(EvidenceEnvelope, _input(case)["envelope"])
    rule = _input(case).get("payload_hash_rule", "jcs")
    material = _input(case)["payload_material"]
    payload = cast("dict[str, object]", corpus["payload"])
    ref = cast("dict[str, object]", payload.get("ref", {}))
    kwargs: dict[str, object] = {}
    if "media_type" in payload:
        kwargs["media_type"] = payload["media_type"]
    if "inline" in payload:
        kwargs["inline"] = payload["inline"]
    if "uri" in ref:
        kwargs["ref_uri"] = ref["uri"]
    if "record_hash" in ref:
        kwargs["ref_record_hash"] = ref["record_hash"]
    if "facts" in corpus:
        kwargs["facts"] = corpus["facts"]
    if "verifier" in corpus:
        kwargs["verifier"] = corpus["verifier"]
    built, warnings = build_evidence_envelope(
        profile=corpus["profile"],
        profile_version=corpus["profile_version"],
        tier=corpus["tier"],
        ref_kind=cast(str, ref.get("kind", "withheld")),
        result=cast("dict[str, object]", corpus["result"]),
        **(
            {"payload_material_utf8": cast(str, material)}
            if rule == "raw"
            else {"payload_material": material}
        ),
        **kwargs,  # type: ignore[arg-type]
    )
    assert warnings == []
    assert built is not None
    # The commitment recomputes to the corpus-pinned hash, and the built
    # envelope reproduces the corpus envelope exactly at the JSON level.
    assert built["payload"]["hash"] == _expected(case)["payload_hash"]
    assert built == corpus
    assert _expected(case)["accept"] is True


def test_builder_raw_rule_matches_raw_sha256() -> None:
    built, warnings = build_evidence_envelope(
        profile="https://atrib.dev/v1/evidence/oauth2",
        tier="declared",
        payload_material_utf8="raw evidence text",
    )
    assert warnings == []
    assert built is not None
    assert built["payload"]["hash"] == raw_sha256("raw evidence text")


def test_payload_hash_mismatch_and_withheld_sanitization_match_corpus() -> None:
    mismatch = _load("shape--payload-hash-mismatch.json")
    mismatch_envelope = cast("dict[str, object]", _input(mismatch)["envelope"])
    mismatch_payload = cast("dict[str, object]", mismatch_envelope["payload"])
    assert validate_envelope(mismatch_envelope).ok is True
    assert jcs_sha256(_input(mismatch)["payload_material"]) != mismatch_payload["hash"]
    assert _expected(mismatch)["payload_hash_matches_material"] is False

    sanitized = _load("shape--withheld-sanitized.json")
    sanitized_envelope = cast("dict[str, object]", _input(sanitized)["envelope"])
    sanitized_payload = cast("dict[str, object]", sanitized_envelope["payload"])
    assert validate_envelope(sanitized_envelope).ok is True
    assert cast("dict[str, object]", sanitized_payload["ref"])["kind"] == "withheld"
    assert sorted(cast("dict[str, object]", sanitized_envelope["facts"]).keys()) == sorted(
        cast("list[str]", _expected(sanitized)["public_facts"])
    )


def test_builder_contradictory_input_raises() -> None:
    base: dict[str, object] = {
        "profile": "https://atrib.dev/v1/evidence/oauth2",
        "tier": "declared",
    }
    with pytest.raises(ValueError):
        build_evidence_envelope(
            payload_hash="sha256:" + "0" * 64, payload_material={}, **base  # type: ignore[arg-type]
        )
    with pytest.raises(ValueError):
        build_evidence_envelope(
            payload_material={}, payload_material_utf8="x", **base  # type: ignore[arg-type]
        )
    with pytest.raises(ValueError):
        build_evidence_envelope(**base)  # type: ignore[arg-type]


def test_builder_shape_rejection_drops_envelope_with_warning() -> None:
    built, warnings = build_evidence_envelope(
        profile="not-an-https-uri",
        tier="declared",
        payload_material={"note": "x"},
    )
    assert built is None
    assert any("profile_uri" in w for w in warnings)


# ── registry family: full-URI profile identity ───────────────────────────

_REGISTRY_CASES = [
    "registry--atrib-profile-registered.json",
    "registry--third-party-profile.json",
    "registry--foreign-domain-collision.json",
]


@pytest.mark.parametrize("file", _REGISTRY_CASES)
def test_classify_profile_matches_corpus(file: str) -> None:
    case = _load(file)
    envelope = cast("dict[str, object]", _input(case)["envelope"])
    expected = _expected(case)
    registry = cast(
        "list[str]",
        _input(case).get("atrib_profile_registry"),
    )
    classification = (
        classify_profile(envelope["profile"], registry)
        if registry is not None
        else classify_profile(envelope["profile"])
    )
    assert classification.uri_valid == expected["uri_valid"]
    assert classification.atrib_maintained == expected["atrib_maintained"]
    assert classification.registered == expected["registered"]
    assert classification.treat_as == expected["treat_as"]
    assert validate_envelope(envelope).ok is expected["accept"]


@pytest.mark.parametrize(
    "file",
    ["registry--non-https-profile-rejected.json", "registry--bare-name-profile-rejected.json"],
)
def test_classify_profile_invalid_uris(file: str) -> None:
    case = _load(file)
    envelope = cast("dict[str, object]", _input(case)["envelope"])
    classification = classify_profile(envelope["profile"])
    assert classification.uri_valid is False
    assert classification.treat_as == "unknown-preserve"


# ── legacy-mapping family: deterministic §5.5.6 → envelope ───────────────

_LEGACY_CASES = [
    "legacy-mapping--legacy-oauth2.json",
    "legacy-mapping--legacy-mcp-oauth.json",
    "legacy-mapping--legacy-aauth.json",
    "legacy-mapping--legacy-x401.json",
    "legacy-mapping--legacy-ap2-vi.json",
]


@pytest.mark.parametrize("file", _LEGACY_CASES)
def test_legacy_mapping_is_deterministic(file: str) -> None:
    case = _load(file)
    block = cast("dict[str, object]", _input(case)["legacy_block"])
    envelope = map_legacy_evidence_block(block)
    # Two independent implementations MUST produce this exact envelope.
    assert envelope == _expected(case)["envelope"], file
    assert cast(dict, envelope["payload"])["hash"] == _expected(case)["payload_hash"]
    expected_details = _expected(case).get("details_hash")
    if expected_details is not None:
        assert cast(dict, envelope["facts"])["details_hash"] == expected_details
    assert validate_envelope(envelope).ok is True


def test_legacy_mapping_rejects_unknown_protocols() -> None:
    case = _load("legacy-mapping--legacy-unknown-protocol-rejected.json")
    block = cast("dict[str, object]", _input(case)["legacy_block"])
    assert _expected(case)["mapping_must_reject"] is True
    assert FROZEN_LEGACY_PROTOCOLS == tuple(
        cast("list[str]", _expected(case)["frozen_protocols"])
    )
    with pytest.raises(ValueError, match="unknown legacy evidence protocol"):
        map_legacy_evidence_block(block)


# ── tier family: identity, ordering, relay swap, reproducibility ─────────


def test_tier_ladder_all_four_shares_one_identity_key() -> None:
    case = _load("tier--tier-ladder-all-four.json")
    envelopes = cast("list[EvidenceEnvelope]", _input(case)["envelopes"])
    expected = _expected(case)
    material = cast(str, _input(case)["payload_material_utf8"])
    rule = _input(case)["payload_hash_rule"]
    computed = raw_sha256(material) if rule == "raw" else jcs_sha256(material)
    assert computed == expected["payload_hash"]
    keys = {evidence_envelope_key(envelope) for envelope in envelopes}
    identity = cast("dict[str, str]", expected["identity_key"])
    assert keys == {f"{identity['profile']} {identity['payload_hash']}"}
    assert expected["shared_identity_key"] is True
    for envelope in envelopes:
        assert validate_envelope(envelope).ok is expected["accept_all"]
    ordered = order_envelope_instances(envelopes)
    assert [envelope["tier"] for envelope in ordered] == expected["tier_order_descending"]


def test_relay_identity_swap_is_flagged() -> None:
    case = _load("tier--relay-identity-swap-rejected.json")
    original = cast("dict[str, object]", _input(case)["original"])
    relayed = cast("dict[str, object]", _input(case)["relayed"])
    assert is_relay_identity_swap(original, relayed) is cast(
        bool, _expected(case)["relay_violation"]
    )
    # A genuine re-verification (same verifier block) is NOT a swap.
    assert is_relay_identity_swap(original, original) is False


def test_verified_withheld_is_claimed_not_reproducible() -> None:
    case = _load("tier--verified-withheld-not-reproducible.json")
    envelope = cast(EvidenceEnvelope, _input(case)["envelope"])
    assert validate_envelope(envelope).ok is _expected(case)["accept"]
    outcome = assess_reproducibility(envelope)
    assert outcome.reproducible is _expected(case)["reproducible"]
    assert outcome.report == _expected(case)["report"]


# ── unknown-profile family: preserve, never drop ─────────────────────────


def test_unknown_profile_envelope_is_preserved_and_rendered_opaque() -> None:
    case = _load("unknown-profile--unknown-profile-preserved.json")
    envelope = cast(EvidenceEnvelope, _input(case)["envelope"])
    expected = _expected(case)
    assert validate_envelope(envelope).ok is expected["accept"]
    assert classify_profile(envelope["profile"]).treat_as == "unknown-preserve"
    assert render_envelope_opaque(envelope) == expected["opaque_render"]
    # Round-tripping through JCS preserves the envelope byte-for-byte.
    assert jcs_sha256(envelope) == expected["round_trip_jcs_sha256"]


def test_unknown_profiles_are_never_dropped_from_evidence_lists() -> None:
    case = _load("unknown-profile--unknown-profile-never-dropped.json")
    evidence_list = cast("list[EvidenceEnvelope]", _input(case)["evidence_list"])
    expected = _expected(case)
    assert expected["drop_forbidden"] is True
    preserved = [envelope for envelope in evidence_list if is_valid_envelope(envelope)]
    assert len(preserved) == expected["preserved_count"]
    assert [envelope["profile"] for envelope in preserved] == expected[
        "profiles_in_order"
    ]
