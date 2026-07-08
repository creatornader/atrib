# SPDX-License-Identifier: Apache-2.0
"""Producer-side anchor plurality (D138, spec §2.11.7-§2.11.13).

Python port of ``packages/mcp/src/anchors.ts``: the §2.11.8 anchor-type
registry, the typed anchor-set configuration, the §2.11.12 posture
resolution (``resolve_anchor_posture`` / ``resolve_effective_anchors``)
including the ``allow_single_anchor`` opt-in gate, and the §2.11.10
anchoring-claim artifact bytes (``anchor_claim_artifact``).

Submission fan-out lives in :mod:`atrib.client`: ``AtribClient`` builds one
:class:`atrib.submission.SubmissionQueue` per effective ``atrib-log``
anchor endpoint, so every leg keeps the §5.3.5 non-blocking contract.
Non-``atrib-log`` anchor types (``sigstore-rekor``, ``rfc3161-tsa``,
``opentimestamps``) have no Python transport yet — the TypeScript
reference stubs them too — so the client skips those legs with an
``atrib:`` warning naming the type.

Nothing here changes any signed byte: proof bundles are post-signing
artifacts (§2.8) and anchoring is permissionless and post-hoc (§2.11.7).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypedDict

from typing_extensions import NotRequired

# ── Anchor type registry (§2.11.8, v1) ───────────────────────────────────

ANCHOR_TYPES = ("atrib-log", "sigstore-rekor", "rfc3161-tsa", "opentimestamps")

# §2.11.10 domain-separation prefix for the anchoring-claim artifact.
# JCS-canonical records begin with '{'; the prefix makes the separation
# between anchoring signatures and record signatures explicit.
ANCHOR_CLAIM_PREFIX = "atrib-anchor/v1:"

_RECORD_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}\Z")


# ── Anchor-set configuration (§2.11.12) ──────────────────────────────────


class AnchorDescriptor(TypedDict, total=False):
    """One anchor in a producer's anchor set. ``anchor_type`` absent (or
    ``None``, mirroring the TS ``??`` coalescing) means ``atrib-log`` — the
    same absence-defaulting rule the ``log_proofs`` discriminator uses
    (§2.11.9 rule (a)). ``url`` wins over ``endpoint`` when both are set."""

    anchor_type: NotRequired[str]
    anchor_id: NotRequired[str]
    url: NotRequired[str]
    endpoint: NotRequired[str]  # alias for `url`; `url` wins when both set
    calendars: NotRequired[list[str]]  # opentimestamps only
    public_key_b64: NotRequired[str]  # verifier trust material passthrough


class AnchorSetConfig(TypedDict, total=False):
    """Producer anchor configuration per §2.11.12."""

    anchors: NotRequired[list[AnchorDescriptor]]
    # Opt-in acknowledgment that a sub-plurality anchor set is deliberate
    # (§2.11.12 rule 3) — the single-anchor analog of a deliberate dangling
    # informed_by claim per D113. Defaults to False.
    allow_single_anchor: NotRequired[bool]


#: The SDK's built-in default anchor set (§2.11.12 rule 1): two independent
#: anchors so zero-config producers get plurality without opting in. Values
#: match ``BUILT_IN_DEFAULT_ANCHOR_SET`` in ``packages/mcp/src/anchors.ts``
#: exactly. The OpenTimestamps member has no transport in this SDK yet, so
#: zero-config fan-out submits to the atrib log exactly as today and the
#: client reports the OTS leg skipped.
BUILT_IN_DEFAULT_ANCHOR_SET: tuple[AnchorDescriptor, ...] = (
    {
        "anchor_type": "atrib-log",
        "anchor_id": "log.atrib.dev",
        "url": "https://log.atrib.dev/v1",
    },
    {
        "anchor_type": "opentimestamps",
        "anchor_id": "opentimestamps-calendars",
        "calendars": ["https://a.pool.opentimestamps.org"],
    },
)


@dataclass(frozen=True)
class AnchorPostureResolution:
    """Result of resolving a producer anchor config per the §2.11.12
    precedence rules. Field names match the conformance corpus
    (``spec/conformance/2.11/anchors/cases/allow-single-anchor-config.json``)
    and the TS ``AnchorPostureResolution`` exactly."""

    effective_anchor_count: int
    used_default_set: bool
    warn: bool
    # §5.9.3 sidecar degradation marker written when a sub-plurality config
    # lacks allow_single_anchor (§2.11.12 rule 4), else None:
    # {"configured": <n>, "allow_single_anchor": False}
    sidecar_anchor_config: Mapping[str, object] | None


def resolve_anchor_posture(
    config: Mapping[str, object] | None = None,
) -> AnchorPostureResolution:
    """Resolve a producer anchor config per §2.11.12, exact precedence:

    1. No anchor config at all ⇒ the built-in default set (two anchors).
    2. Explicit config with ≥ 2 entries ⇒ used as given.
    3. Explicit config with < 2 entries and ``allow_single_anchor: True``
       ⇒ used as given, no warning.
    4. Explicit config with < 2 entries and no flag ⇒ ``warn=True`` plus
       the sidecar degradation marker. The operation continues; this
       function is PURE (no output, no raise) — the client emits the
       ``atrib:``-prefixed warning so pure-function callers stay silent.

    Never raises (§5.8). A malformed config resolves as if empty.
    """
    mapping: Mapping[str, object] = config if isinstance(config, Mapping) else {}
    anchors = mapping.get("anchors")
    if not isinstance(anchors, list):
        return AnchorPostureResolution(
            effective_anchor_count=len(BUILT_IN_DEFAULT_ANCHOR_SET),
            used_default_set=True,
            warn=False,
            sidecar_anchor_config=None,
        )
    configured = len(anchors)
    if configured >= 2 or mapping.get("allow_single_anchor") is True:
        return AnchorPostureResolution(
            effective_anchor_count=configured,
            used_default_set=False,
            warn=False,
            sidecar_anchor_config=None,
        )
    return AnchorPostureResolution(
        effective_anchor_count=configured,
        used_default_set=False,
        warn=True,
        sidecar_anchor_config={"configured": configured, "allow_single_anchor": False},
    )


def resolve_effective_anchors(
    config: Mapping[str, object] | None = None,
) -> list[AnchorDescriptor]:
    """The effective anchor set for a config: the built-in default set when
    no config was given (§2.11.12 rule 1), the caller's entries otherwise —
    including deliberate or warned sub-plurality sets, which are used as
    given (rules 3-4: warn, never block). Never raises."""
    mapping: Mapping[str, object] = config if isinstance(config, Mapping) else {}
    anchors = mapping.get("anchors")
    if isinstance(anchors, list):
        # Entries are returned as given (hostile members included) so the
        # transport-build layer can skip them with a warning per §5.8.
        return list(anchors)
    return list(BUILT_IN_DEFAULT_ANCHOR_SET)


# ── §2.11.10 anchoring-claim artifact ────────────────────────────────────


def anchor_claim_artifact(record_hash: str) -> bytes:
    """Build the §2.11.10 anchor-claim artifact bytes for a record hash:
    the UTF-8 bytes of ``"atrib-anchor/v1:" + record_hash`` with
    ``record_hash`` in canonical ``"sha256:" + 64-lowercase-hex`` form.
    Deterministically reconstructible from ``record_hash`` alone; reveals
    nothing beyond the commitment itself (§8.3 posture preserved).

    Byte-identical to the TS ``anchorClaimArtifact``. Raises ``ValueError``
    on a malformed record hash — this is a pure builder for programmer
    input; fan-out paths catch everything per §5.8.
    """
    if not isinstance(record_hash, str) or not _RECORD_HASH_RE.match(record_hash):
        raise ValueError(
            "atrib: anchor claim requires a canonical "
            f'"sha256:<64 lowercase hex>" record hash, got {record_hash!r:.90}'
        )
    return (ANCHOR_CLAIM_PREFIX + record_hash).encode("utf-8")


# ── Descriptor helpers (shared with the client fan-out) ──────────────────


def anchor_descriptor_type(descriptor: Mapping[str, object]) -> object:
    """§2.11.9 rule (a) analog: absent (or ``None``, matching the TS ``??``)
    ``anchor_type`` means ``atrib-log``. Non-string values pass through as
    given so callers can name them in skip warnings."""
    anchor_type = descriptor.get("anchor_type")
    return "atrib-log" if anchor_type is None else anchor_type


def anchor_descriptor_endpoint(descriptor: Mapping[str, object]) -> object:
    """Submission endpoint: ``url`` wins over ``endpoint`` (both spellings
    accepted per §2.11.12; the spec sample uses ``url``)."""
    url = descriptor.get("url")
    return url if url is not None else descriptor.get("endpoint")
