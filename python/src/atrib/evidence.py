# SPDX-License-Identifier: Apache-2.0
"""Evidence envelope types (P042 draft, docs/adr-draft-p042-evidence-envelope.md).

Python mirror of the universal evidence-envelope schema: one envelope, N
profiles identified by type URI, four-value tier ladder. The legacy
``protocol`` string set is frozen; every new evidence kind is an envelope
profile. Envelopes live outside signed bytes (mirror sidecar, archive
projection, verifier results, host-owned packets). Types only in v0.
"""

from __future__ import annotations

from typing import TypedDict

from typing_extensions import NotRequired

EVIDENCE_TIERS = ("declared", "shape", "attested", "verified")

_TIER_ORDER = {name: rank for rank, name in enumerate(EVIDENCE_TIERS)}


class EvidencePayloadRef(TypedDict):
    kind: str  # 'inline' | 'mirror' | 'archive' | 'external' | 'withheld'
    uri: NotRequired[str]
    # Set when the payload is itself a signed atrib record; payload hash
    # then commits to that record's canonical JCS bytes.
    record_hash: NotRequired[str]


class EvidencePayload(TypedDict):
    # "sha256:" + hex commitment to the raw evidence material.
    hash: str
    media_type: NotRequired[str]
    ref: NotRequired[EvidencePayloadRef]
    inline: NotRequired[object]  # only when ref.kind == 'inline'; never public


class EvidenceConstraint(TypedDict):
    name: str
    status: str  # 'passed' | 'failed' | 'unresolved' | 'not_checked'
    detail: NotRequired[str]


class EvidenceResult(TypedDict, total=False):
    valid: bool
    constraints: list[EvidenceConstraint]
    errors: list[str]
    warnings: list[str]


class EvidenceVerifier(TypedDict, total=False):
    name: str
    checked_at_ms: int


class EvidenceEnvelope(TypedDict):
    envelope: int  # schema version; 1 today
    profile: str  # absolute HTTPS profile type URI
    profile_version: str  # semver of the profile document
    tier: str  # 'declared' | 'shape' | 'attested' | 'verified'
    payload: EvidencePayload
    facts: NotRequired[dict[str, object]]
    result: NotRequired[EvidenceResult]
    verifier: NotRequired[EvidenceVerifier]


def evidence_envelope_key(envelope: EvidenceEnvelope) -> str:
    """Dedup identity per the P042 tier rules: (profile, payload.hash)."""
    return f"{envelope['profile']} {envelope['payload']['hash']}"


def evidence_tier_rank(tier: str) -> int:
    """Numeric rank of a tier (0 = declared … 3 = verified). Unknown tiers
    rank below 'declared' so consumers can sort defensively."""
    return _TIER_ORDER.get(tier, -1)
