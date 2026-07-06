# SPDX-License-Identifier: Apache-2.0
"""Post-spawn addenda surfaces of the Python SDK.

- ``atrib.client._resolve_anchor_set`` (P043 headroom): today's
  single-atrib-log posture — bare strings and ``{"endpoint": ...}`` mappings
  are atrib-log anchors, unsupported ``anchor_type`` values and malformed
  entries are skipped with a warning (never a raise), multiple usable
  anchors warn about fan-out and submit to the first only.
- ``AtribClient(anchors=...)``: anchor warnings surface on
  ``AttestResult.warnings`` even in pass-through mode (§5.8 rule 5).
- ``atrib.evidence`` (P042 draft): the ``(profile, payload.hash)`` dedup
  key and the four-value tier ladder with defensive unknown-tier ranking.
"""

from __future__ import annotations

from pathlib import Path

from atrib import AtribClient
from atrib.client import _resolve_anchor_set
from atrib.evidence import (
    EvidenceEnvelope,
    evidence_envelope_key,
    evidence_tier_rank,
)

LOG_A = "https://log.atrib.dev/v1/entries"
LOG_B = "https://log-b.example.dev/v1/entries"
REKOR = "https://rekor.example.dev"


# ── _resolve_anchor_set ──────────────────────────────────────────────────


def test_resolve_anchor_set_none() -> None:
    assert _resolve_anchor_set(None) == (None, [])


def test_resolve_anchor_set_empty() -> None:
    assert _resolve_anchor_set([]) == (None, [])


def test_resolve_anchor_set_single_string() -> None:
    assert _resolve_anchor_set([LOG_A]) == (LOG_A, [])


def test_resolve_anchor_set_endpoint_mapping() -> None:
    assert _resolve_anchor_set([{"endpoint": LOG_A}]) == (LOG_A, [])


def test_resolve_anchor_set_explicit_atrib_log_type() -> None:
    assert _resolve_anchor_set([{"endpoint": LOG_A, "anchor_type": "atrib-log"}]) == (
        LOG_A,
        [],
    )


def test_resolve_anchor_set_skips_unsupported_type_with_warning() -> None:
    endpoint, warnings = _resolve_anchor_set([{"endpoint": REKOR, "anchor_type": "rekor"}])
    assert endpoint is None
    assert len(warnings) == 1
    assert "'rekor'" in warnings[0]
    assert REKOR in warnings[0]


def test_resolve_anchor_set_two_logs_first_wins_with_fanout_warning() -> None:
    endpoint, warnings = _resolve_anchor_set([LOG_A, {"endpoint": LOG_B}])
    assert endpoint == LOG_A
    assert len(warnings) == 1
    assert "multi-anchor fan-out" in warnings[0]


def test_resolve_anchor_set_rekor_then_log_chooses_the_log() -> None:
    endpoint, warnings = _resolve_anchor_set(
        [{"endpoint": REKOR, "anchor_type": "rekor"}, LOG_A]
    )
    assert endpoint == LOG_A
    # One skip warning; a single usable anchor never triggers fan-out.
    assert len(warnings) == 1
    assert "'rekor'" in warnings[0]


def test_resolve_anchor_set_malformed_entries_warn_and_skip() -> None:
    endpoint, warnings = _resolve_anchor_set([{}, {"endpoint": 5}, LOG_A])
    assert endpoint == LOG_A
    assert len(warnings) == 2
    for warning in warnings[:2]:
        assert "without a string endpoint" in warning


def test_resolve_anchor_set_non_string_anchor_type_warns_and_skips() -> None:
    # TS parity (adversarial pass 2026-07-06): any PRESENT anchor_type
    # other than 'atrib-log' — including non-strings — warns and skips,
    # matching resolveAnchorSet's `!== undefined && !== 'atrib-log'` rule.
    endpoint, warnings = _resolve_anchor_set([{"endpoint": LOG_A, "anchor_type": 7}])
    assert endpoint is None
    assert len(warnings) == 1
    assert "anchor_type" in warnings[0]


# ── AtribClient surfaces the anchor warnings ─────────────────────────────


def test_attest_pass_through_surfaces_anchor_warnings(tmp_path: Path) -> None:
    client = AtribClient(
        key=None,  # explicit: no signing key → §5.8 rule 5 pass-through
        anchors=[
            {"endpoint": REKOR, "anchor_type": "rekor"},
            LOG_A,
            {"endpoint": LOG_B},
        ],
        mirror_write_path=tmp_path / "write.jsonl",
        mirror_read_path=tmp_path / "read.jsonl",
        env={},
    )
    result = client.attest({"note": "anchor warning surfacing"})
    assert result.via == "none"
    assert result.record_hash is None
    assert result.context_id is None
    # Anchor warnings come first, then the pass-through warning.
    assert any("'rekor'" in w for w in result.warnings)
    assert any("multi-anchor fan-out" in w for w in result.warnings)
    assert any("pass-through" in w for w in result.warnings)
    # Pass-through mode writes nothing to the mirror.
    assert not (tmp_path / "write.jsonl").exists()


def test_attest_anchor_warnings_repeat_per_call(tmp_path: Path) -> None:
    client = AtribClient(
        key=None,
        anchors=[LOG_A, LOG_B],
        mirror_write_path=tmp_path / "write.jsonl",
        mirror_read_path=tmp_path / "read.jsonl",
        env={},
    )
    first = client.attest({"n": 1})
    second = client.attest({"n": 2})
    for result in (first, second):
        assert any("multi-anchor fan-out" in w for w in result.warnings)


# ── atrib.evidence ───────────────────────────────────────────────────────

PAYLOAD_HASH = "sha256:" + "ef" * 32


def _envelope(tier: str) -> EvidenceEnvelope:
    return {
        "envelope": 1,
        "profile": "https://atrib.dev/v1/evidence/oauth2",
        "profile_version": "1.0.0",
        "tier": tier,
        "payload": {"hash": PAYLOAD_HASH},
    }


def test_evidence_envelope_key_is_profile_space_payload_hash() -> None:
    assert (
        evidence_envelope_key(_envelope("verified"))
        == f"https://atrib.dev/v1/evidence/oauth2 {PAYLOAD_HASH}"
    )


def test_evidence_envelope_key_is_tier_independent() -> None:
    assert evidence_envelope_key(_envelope("declared")) == evidence_envelope_key(
        _envelope("verified")
    )


def test_evidence_tier_rank_ladder() -> None:
    assert evidence_tier_rank("declared") == 0
    assert evidence_tier_rank("shape") == 1
    assert evidence_tier_rank("attested") == 2
    assert evidence_tier_rank("verified") == 3
    assert (
        evidence_tier_rank("declared")
        < evidence_tier_rank("shape")
        < evidence_tier_rank("attested")
        < evidence_tier_rank("verified")
    )


def test_evidence_tier_rank_unknown_ranks_below_declared() -> None:
    assert evidence_tier_rank("certified") == -1
    assert evidence_tier_rank("") == -1
    assert evidence_tier_rank("certified") < evidence_tier_rank("declared")
