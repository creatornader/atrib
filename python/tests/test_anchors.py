# SPDX-License-Identifier: Apache-2.0
"""Anchor plurality (D138, spec §2.11.7-§2.11.13) — the producer-side
posture and claim-artifact surface of :mod:`atrib.anchors`.

The posture table is pinned against the shared conformance corpus at
``spec/conformance/2.11/anchors/cases/allow-single-anchor-config.json`` and
the claim-artifact bytes against the sigstore-rekor claim case, so the
Python port and the TS reference (``packages/mcp/src/anchors.ts``) cannot
drift apart silently.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import cast

import pytest

from atrib.anchors import (
    ANCHOR_CLAIM_PREFIX,
    ANCHOR_TYPES,
    BUILT_IN_DEFAULT_ANCHOR_SET,
    AnchorSetConfig,
    anchor_claim_artifact,
    anchor_descriptor_endpoint,
    anchor_descriptor_type,
    resolve_anchor_posture,
    resolve_effective_anchors,
)

CASES = Path(__file__).parent.parent.parent / "spec/conformance/2.11/anchors/cases"


def _load(name: str) -> dict[str, object]:
    return cast("dict[str, object]", json.loads((CASES / name).read_text("utf-8")))


# ── §2.11.8 registry ─────────────────────────────────────────────────────


def test_registry_matches_spec_v1() -> None:
    assert ANCHOR_TYPES == (
        "atrib-log",
        "sigstore-rekor",
        "rfc3161-tsa",
        "opentimestamps",
    )


def test_default_set_is_two_independent_anchors() -> None:
    assert len(BUILT_IN_DEFAULT_ANCHOR_SET) == 2
    types = [entry.get("anchor_type") for entry in BUILT_IN_DEFAULT_ANCHOR_SET]
    assert types == ["atrib-log", "opentimestamps"]


# ── §2.11.12 posture resolution (corpus-pinned) ──────────────────────────


def test_posture_matches_the_conformance_corpus() -> None:
    case = _load("allow-single-anchor-config.json")
    configs = cast("list[dict[str, object]]", cast(dict, case["input"])["configs"])
    expected = cast("list[dict[str, object]]", cast(dict, case["expected"])["resolutions"])
    assert [c["name"] for c in configs] == [e["name"] for e in expected]
    for config_entry, expected_entry in zip(configs, expected):
        resolution = resolve_anchor_posture(
            cast(AnchorSetConfig, config_entry["config"])
        )
        assert resolution.effective_anchor_count == expected_entry[
            "effective_anchor_count"
        ], config_entry["name"]
        assert resolution.used_default_set == expected_entry["used_default_set"], (
            config_entry["name"]
        )
        assert resolution.warn == expected_entry["warn"], config_entry["name"]
        assert resolution.sidecar_anchor_config == expected_entry[
            "sidecar_anchor_config"
        ], config_entry["name"]


def test_posture_never_raises_on_hostile_config() -> None:
    for hostile in (None, {}, {"anchors": "nope"}, {"anchors": 7}, "garbage", 42):
        resolution = resolve_anchor_posture(cast("AnchorSetConfig", hostile))
        # A malformed config resolves as if empty ⇒ the default set applies.
        assert resolution.used_default_set is True
        assert resolution.warn is False


def test_effective_anchors_default_and_explicit() -> None:
    assert resolve_effective_anchors(None) == list(BUILT_IN_DEFAULT_ANCHOR_SET)
    assert resolve_effective_anchors({}) == list(BUILT_IN_DEFAULT_ANCHOR_SET)
    explicit: AnchorSetConfig = {"anchors": [{"url": "https://log.example/v1"}]}
    # Sub-plurality sets are used as given (§2.11.12 rules 3-4: warn, never
    # block) — the posture carries the warning, not the set.
    assert resolve_effective_anchors(explicit) == [{"url": "https://log.example/v1"}]
    assert resolve_effective_anchors({"anchors": []}) == []


# ── §2.11.10 anchoring-claim artifact ────────────────────────────────────


def test_claim_artifact_bytes_are_prefix_plus_hash() -> None:
    record_hash = "sha256:" + "ab" * 32
    assert anchor_claim_artifact(record_hash) == (
        ANCHOR_CLAIM_PREFIX + record_hash
    ).encode("utf-8")


def test_claim_artifact_matches_the_rekor_corpus_entry_body() -> None:
    case = _load("rekor-anchor-claim.json")
    bundle = cast("dict[str, object]", cast(dict, case["input"])["bundle"])
    record_hash = cast(str, bundle["record_hash"])
    rekor = next(
        cast("dict[str, object]", proof)
        for proof in cast("list[object]", bundle["log_proofs"])
        if isinstance(proof, dict) and proof.get("anchor_type") == "sigstore-rekor"
    )
    entry_body = json.loads(
        base64.b64decode(cast("dict[str, object]", rekor["proof"])["entry_body_b64"])
    )
    corpus_artifact = base64.b64decode(entry_body["artifact_b64"])
    assert anchor_claim_artifact(record_hash) == corpus_artifact
    assert entry_body["kind"] == "atrib-anchor-claim/v1"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "sha256:",
        "sha256:" + "AB" * 32,  # uppercase hex
        "sha256:" + "ab" * 31,  # short
        "sha256:" + "ab" * 32 + "\n",  # trailing newline (\Z anchor)
        "ab" * 32,  # missing prefix
        None,
        42,
    ],
)
def test_claim_artifact_rejects_malformed_hashes(bad: object) -> None:
    with pytest.raises(ValueError):
        anchor_claim_artifact(cast(str, bad))


# ── descriptor helpers ───────────────────────────────────────────────────


def test_descriptor_type_defaults_absent_and_none_to_atrib_log() -> None:
    assert anchor_descriptor_type({}) == "atrib-log"
    assert anchor_descriptor_type({"anchor_type": None}) == "atrib-log"
    assert anchor_descriptor_type({"anchor_type": "sigstore-rekor"}) == "sigstore-rekor"
    # Non-string values pass through as given for skip-warning naming.
    assert anchor_descriptor_type({"anchor_type": 7}) == 7


def test_descriptor_endpoint_url_wins_over_endpoint() -> None:
    assert anchor_descriptor_endpoint({"url": "a", "endpoint": "b"}) == "a"
    assert anchor_descriptor_endpoint({"endpoint": "b"}) == "b"
    assert anchor_descriptor_endpoint({}) is None
