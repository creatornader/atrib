# SPDX-License-Identifier: Apache-2.0
"""Post-spawn addenda surfaces of the Python SDK, as activated by D137/D138.

- ``atrib.client._resolve_anchor_plan`` (D138 anchor plurality): TS-parity
  anchor-set resolution — bare strings and ``{"url"|"endpoint": ...}``
  mappings are atrib-log anchors; hostile shapes, unregistered
  ``anchor_type`` values, and unusable endpoints warn-and-skip (never a
  raise) and are EXCLUDED from the §2.11.12 posture count; registered
  non-atrib-log types count but their submission legs are skipped (no
  Python transport yet); every usable atrib-log anchor becomes a fan-out
  endpoint.
- ``AtribClient(anchors=...)``: anchor warnings surface on
  ``AttestResult.warnings`` even in pass-through mode (§5.8 rule 5), and
  ``AttestResult.anchor_posture`` carries the resolved posture.
- ``atrib.evidence`` (D137): the ``(profile, payload.hash)`` dedup key and
  the four-value tier ladder with defensive unknown-tier ranking.
"""

from __future__ import annotations

from pathlib import Path

from atrib import BUILT_IN_DEFAULT_ANCHOR_SET, AtribClient
from atrib.client import _resolve_anchor_plan
from atrib.evidence import (
    EvidenceEnvelope,
    evidence_envelope_key,
    evidence_tier_rank,
)

LOG_A = "https://log.atrib.dev/v1/entries"
LOG_B = "https://log-b.example.dev/v1/entries"
REKOR = "https://rekor.example.dev"


# ── _resolve_anchor_plan ─────────────────────────────────────────────────


def test_plan_none_uses_default_set_with_ots_leg_skipped() -> None:
    plan = _resolve_anchor_plan(None, False, {})
    # §2.11.12 rule 1: no config at all ⇒ the built-in two-anchor default.
    assert plan.posture == {
        "effective_anchor_count": len(BUILT_IN_DEFAULT_ANCHOR_SET),
        "used_default_set": True,
        "warned": False,
    }
    assert plan.sidecar_marker is None
    # Only the atrib-log member has a Python transport today; the
    # opentimestamps leg is reported skipped, never silently dropped.
    assert plan.endpoints == ["https://log.atrib.dev/v1"]
    assert len(plan.warnings) == 1
    assert "'opentimestamps'" in plan.warnings[0]
    assert "transport" in plan.warnings[0]


def test_plan_default_set_honors_atrib_log_endpoint_env() -> None:
    plan = _resolve_anchor_plan(None, False, {"ATRIB_LOG_ENDPOINT": LOG_B})
    assert plan.endpoints == [LOG_B]
    assert plan.posture["used_default_set"] is True


def test_plan_explicit_empty_set_warns_zero_anchor_posture() -> None:
    plan = _resolve_anchor_plan([], False, {})
    assert plan.endpoints == []
    assert plan.posture == {
        "effective_anchor_count": 0,
        "used_default_set": False,
        "warned": True,
    }
    assert plan.sidecar_marker == {"configured": 0, "allow_single_anchor": False}
    assert any("allow_single_anchor" in w for w in plan.warnings)


def test_plan_single_string_is_atrib_log_and_warns_sub_plurality() -> None:
    plan = _resolve_anchor_plan([LOG_A], False, {})
    assert plan.endpoints == [LOG_A]
    assert plan.posture["effective_anchor_count"] == 1
    assert plan.posture["warned"] is True
    assert plan.sidecar_marker == {"configured": 1, "allow_single_anchor": False}


def test_plan_allow_single_anchor_silences_the_warning() -> None:
    plan = _resolve_anchor_plan([LOG_A], True, {})
    assert plan.endpoints == [LOG_A]
    assert plan.posture["warned"] is False
    assert plan.sidecar_marker is None
    assert plan.warnings == []


def test_plan_two_logs_fan_out_to_both_without_warning() -> None:
    plan = _resolve_anchor_plan([LOG_A, {"endpoint": LOG_B}], False, {})
    # D138 fan-out is live: every usable atrib-log anchor gets a leg.
    assert plan.endpoints == [LOG_A, LOG_B]
    assert plan.posture == {
        "effective_anchor_count": 2,
        "used_default_set": False,
        "warned": False,
    }
    assert plan.warnings == []


def test_plan_url_wins_over_endpoint() -> None:
    plan = _resolve_anchor_plan(
        [{"url": LOG_A, "endpoint": LOG_B, "anchor_type": "atrib-log"}], True, {}
    )
    assert plan.endpoints == [LOG_A]


def test_plan_explicit_config_ignores_atrib_log_endpoint_env() -> None:
    # The env override is a default-set nuance only (§2.11.12 rule 1); an
    # explicit anchor set is used exactly as given.
    plan = _resolve_anchor_plan([LOG_A], True, {"ATRIB_LOG_ENDPOINT": LOG_B})
    assert plan.endpoints == [LOG_A]


def test_plan_registered_non_log_type_counts_but_leg_is_skipped() -> None:
    plan = _resolve_anchor_plan(
        [
            LOG_A,
            {
                "anchor_type": "opentimestamps",
                "calendars": ["https://a.pool.opentimestamps.org"],
            },
        ],
        False,
        {},
    )
    # The OTS anchor is registered (§2.11.8) so it counts toward plurality…
    assert plan.posture["effective_anchor_count"] == 2
    assert plan.posture["warned"] is False
    # …but only the atrib-log leg has a Python transport.
    assert plan.endpoints == [LOG_A]
    assert len(plan.warnings) == 1
    assert "'opentimestamps'" in plan.warnings[0]


def test_plan_unregistered_type_is_skipped_and_does_not_count() -> None:
    plan = _resolve_anchor_plan(
        [{"endpoint": REKOR, "anchor_type": "rekor"}, LOG_A], False, {}
    )
    assert plan.endpoints == [LOG_A]
    # TS parity: the unregistered entry is excluded from the effective set,
    # so a lone usable anchor remains and the sub-plurality warning fires.
    assert plan.posture["effective_anchor_count"] == 1
    assert plan.posture["warned"] is True
    assert any("'rekor'" in w and REKOR in w and "registry" in w for w in plan.warnings)


def test_plan_malformed_entries_warn_skip_and_do_not_count() -> None:
    plan = _resolve_anchor_plan(
        [{}, {"endpoint": 5}, "not a url", LOG_A, LOG_B],  # type: ignore[list-item]
        False,
        {},
    )
    assert plan.endpoints == [LOG_A, LOG_B]
    assert plan.posture["effective_anchor_count"] == 2
    assert plan.posture["warned"] is False
    assert sum("without a string url/endpoint" in w for w in plan.warnings) == 2
    assert sum("not a valid URL" in w for w in plan.warnings) == 1


def test_plan_non_string_non_mapping_entries_warn_and_skip() -> None:
    plan = _resolve_anchor_plan([None, 42, LOG_A], True, {})  # type: ignore[list-item]
    assert plan.endpoints == [LOG_A]
    assert plan.posture["effective_anchor_count"] == 1
    assert sum("not a string or mapping" in w for w in plan.warnings) == 2


def test_plan_non_string_anchor_type_warns_and_skips() -> None:
    # TS parity: any PRESENT anchor_type outside the §2.11.8 registry —
    # including non-strings — warns and skips the entry.
    plan = _resolve_anchor_plan([{"endpoint": LOG_A, "anchor_type": 7}], False, {})
    assert plan.endpoints == []
    assert plan.posture["effective_anchor_count"] == 0
    assert any("anchor_type" in w and "registry" in w for w in plan.warnings)


# ── AtribClient surfaces the anchor warnings and posture ─────────────────


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
    assert any("pass-through" in w for w in result.warnings)
    # The resolved posture rides along even in pass-through mode.
    assert result.anchor_posture == {
        "effective_anchor_count": 2,
        "used_default_set": False,
        "warned": False,
    }
    # Pass-through mode writes nothing to the mirror.
    assert not (tmp_path / "write.jsonl").exists()


def test_attest_anchor_warnings_repeat_per_call(tmp_path: Path) -> None:
    client = AtribClient(
        key=None,
        anchors=[LOG_A],
        mirror_write_path=tmp_path / "write.jsonl",
        mirror_read_path=tmp_path / "read.jsonl",
        env={},
    )
    first = client.attest({"n": 1})
    second = client.attest({"n": 2})
    for result in (first, second):
        assert any("allow_single_anchor" in w for w in result.warnings)
        assert result.anchor_posture is not None
        assert result.anchor_posture["warned"] is True


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
