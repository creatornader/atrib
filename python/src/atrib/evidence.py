# SPDX-License-Identifier: Apache-2.0
"""Universal evidence envelope (D137; normative schema at spec §5.5.7).

Python port of ``packages/verify/src/evidence-envelope.ts``: one envelope,
N profiles identified by absolute HTTPS type URI, four-value tier ladder,
the frozen five-string legacy ``protocol`` mapping, validation with the TS
reason-code vocabulary, profile classification against the atrib-maintained
registry, consumer-side instance ordering, and the relay-identity-swap and
reproducibility checks. Envelopes live outside signed bytes (mirror
sidecar, archive projection, verifier results, host-owned packets) and
never alter record signature verification.

Degradation contract: :func:`validate_envelope`, :func:`classify_profile`,
and the other consumer helpers never raise on hostile input — they return
error-shaped results. The builders (:func:`map_legacy_evidence_block`,
:func:`build_evidence_envelope`) raise ``ValueError`` only on contradictory
programmer input (the one normative MUST-reject in the legacy mapping, or a
payload hash supplied together with payload material).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from typing import TypedDict, cast
from urllib.parse import urlsplit

from typing_extensions import NotRequired

from .canon import jcs
from .encoding import hex_encode
from .hashes import sha256

EVIDENCE_TIERS = ("declared", "shape", "attested", "verified")

#: Where the payload bytes are retrievable. Closed at five (§5.5.7).
EVIDENCE_REF_KINDS = ("inline", "mirror", "archive", "external", "withheld")

#: Constraint status, reused unchanged from the §5.5.6 block shape.
EVIDENCE_CONSTRAINT_STATUSES = ("passed", "failed", "unresolved", "not_checked")

#: ``payload.hash`` / ``ref.record_hash`` format: ``sha256:`` + 64 hex.
SHA256_REF_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}\Z")

#: atrib-maintained profiles live under this base URI.
ATRIB_PROFILE_BASE = "https://atrib.dev/v1/evidence/"

#: The initial atrib-maintained registry (trailing names under
#: :data:`ATRIB_PROFILE_BASE`). Profile identity is the FULL URI; third
#: parties register absolute HTTPS URIs on domains they control and never
#: appear here.
ATRIB_PROFILE_REGISTRY = (
    "oauth2",
    "mcp-oauth",
    "aauth",
    "x401",
    "ap2-vi",
    "human-approval",
    "counterparty-attestation",
    "delegation-certificate",
)

#: The pre-envelope §5.5.6 ``protocol`` string set, frozen at exactly five
#: values. No new legacy protocol string may be introduced anywhere in the
#: substrate; every new evidence type registers as an envelope profile.
FROZEN_LEGACY_PROTOCOLS = ("oauth2", "mcp_oauth", "aauth", "x401", "ap2_vi")

#: The fixed five-row legacy-protocol → profile-URI table. Complete and final.
LEGACY_PROTOCOL_TO_PROFILE: Mapping[str, str] = {
    "oauth2": f"{ATRIB_PROFILE_BASE}oauth2",
    "mcp_oauth": f"{ATRIB_PROFILE_BASE}mcp-oauth",
    "aauth": f"{ATRIB_PROFILE_BASE}aauth",
    "x401": f"{ATRIB_PROFILE_BASE}x401",
    "ap2_vi": f"{ATRIB_PROFILE_BASE}ap2-vi",
}

_TIER_ORDER = {name: rank for rank, name in enumerate(EVIDENCE_TIERS)}


class EvidencePayloadRef(TypedDict):
    kind: str  # 'inline' | 'mirror' | 'archive' | 'external' | 'withheld'
    # Wire form uses explicit null for absent (§5.5.7 example); accept both.
    uri: NotRequired[str | None]
    # Set when the payload is itself a signed atrib record; payload hash
    # then commits to that record's canonical JCS bytes.
    record_hash: NotRequired[str | None]


class EvidencePayload(TypedDict):
    # "sha256:" + hex commitment to the raw evidence material.
    hash: str
    media_type: NotRequired[str]
    ref: NotRequired[EvidencePayloadRef]
    inline: NotRequired[object]  # only when ref.kind == 'inline'; never public


class EvidenceConstraint(TypedDict):
    type: str  # profile-defined discriminator (accepted §5.5.7 shape)
    status: str  # 'passed' | 'failed' | 'unresolved' | 'not_checked'
    expected: NotRequired[object]
    actual: NotRequired[object]


class EvidenceResult(TypedDict, total=False):
    valid: bool
    constraints: list[EvidenceConstraint]
    errors: list[str]
    warnings: list[str]


class EvidenceVerifier(TypedDict, total=False):
    name: str
    version: str
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


# ── Hashing helpers (spec §5.5.7 payload hash rule) ──────────────────────


def jcs_sha256(value: object) -> str:
    """``"sha256:" + hex(SHA-256(JCS(value)))`` — the JSON-media-type
    payload hash rule. Byte-identical to the TS ``jcsSha256``."""
    return "sha256:" + hex_encode(sha256(jcs(value)))


def raw_sha256(text: str) -> str:
    """``"sha256:" + hex(SHA-256(UTF-8(text)))`` — the raw-bytes payload
    hash rule (e.g. ``application/jwt``). Byte-identical to ``rawSha256``."""
    return "sha256:" + hex_encode(sha256(text.encode("utf-8")))


# ── Validation (normative shape rules, spec §5.5.7) ──────────────────────


@dataclass(frozen=True)
class EnvelopeValidation:
    """Outcome of :func:`validate_envelope`. ``errors`` carries the TS
    reason-code vocabulary; empty iff accepted."""

    ok: bool
    errors: list[str]


def _is_https_uri(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.scheme == "https" and bool(parts.netloc)


def _is_plain_object(value: object) -> bool:
    return isinstance(value, Mapping)


def validate_envelope(envelope: object) -> EnvelopeValidation:
    """Validate an envelope against the normative §5.5.7 shape rules,
    porting the TS ``validateEnvelope`` reason-for-reason. Returns a closed
    set of reason codes; an empty ``errors`` list (``ok=True``) means the
    envelope is well-formed. Rejecting an envelope never rejects the record
    it attaches to. Never raises.

    Reason codes: ``envelope_version``, ``profile_uri``, ``profile_version``,
    ``tier``, ``payload``, ``payload_hash``, ``ref``, ``ref_kind``,
    ``inline_without_inline_kind``, ``record_hash_format``,
    ``record_hash_with_inline_kind``, ``result``, ``result_valid``,
    ``result_constraints``, ``constraint_status``, ``result_errors``,
    ``result_warnings``, ``verifier`` — or the single code ``envelope`` when
    the input is not an object at all.
    """
    errors: list[str] = []

    if not isinstance(envelope, Mapping):
        return EnvelopeValidation(ok=False, errors=["envelope"])

    if envelope.get("envelope") is not True and envelope.get("envelope") != 1:
        errors.append("envelope_version")
    elif isinstance(envelope.get("envelope"), bool):
        # JSON true is not the integer 1 (TS `=== 1` distinguishes them).
        errors.append("envelope_version")

    if not _is_https_uri(envelope.get("profile")):
        errors.append("profile_uri")

    profile_version = envelope.get("profile_version")
    if not isinstance(profile_version, str) or len(profile_version) == 0:
        errors.append("profile_version")

    tier = envelope.get("tier")
    if not isinstance(tier, str) or tier not in EVIDENCE_TIERS:
        errors.append("tier")

    payload = envelope.get("payload")
    if not isinstance(payload, Mapping):
        errors.append("payload")
    else:
        payload_hash = payload.get("hash")
        if not isinstance(payload_hash, str) or not SHA256_REF_PATTERN.match(payload_hash):
            errors.append("payload_hash")

        ref = payload.get("ref")
        if not isinstance(ref, Mapping):
            errors.append("ref")
        else:
            kind = ref.get("kind")
            if not isinstance(kind, str) or kind not in EVIDENCE_REF_KINDS:
                errors.append("ref_kind")
            # inline is permitted ONLY when ref.kind is 'inline'.
            if "inline" in payload and kind != "inline":
                errors.append("inline_without_inline_kind")
            if "record_hash" in ref and ref.get("record_hash") is not None:
                record_hash = ref.get("record_hash")
                if not isinstance(record_hash, str) or not SHA256_REF_PATTERN.match(
                    record_hash
                ):
                    errors.append("record_hash_format")
                # record_hash is redundant with an inline body.
                if kind == "inline":
                    errors.append("record_hash_with_inline_kind")

    result = envelope.get("result")
    if not isinstance(result, Mapping):
        errors.append("result")
    else:
        if not isinstance(result.get("valid"), bool):
            errors.append("result_valid")
        constraints = result.get("constraints")
        if not isinstance(constraints, list):
            errors.append("result_constraints")
        else:
            for entry in constraints:
                status = entry.get("status") if isinstance(entry, Mapping) else None
                if not isinstance(status, str) or status not in EVIDENCE_CONSTRAINT_STATUSES:
                    errors.append("constraint_status")
                    break
        if not isinstance(result.get("errors"), list):
            errors.append("result_errors")
        if not isinstance(result.get("warnings"), list):
            errors.append("result_warnings")

    if "verifier" in envelope:
        verifier = envelope.get("verifier")
        if (
            not isinstance(verifier, Mapping)
            or not isinstance(verifier.get("name"), str)
            or len(cast(str, verifier.get("name"))) == 0
        ):
            errors.append("verifier")

    return EnvelopeValidation(ok=len(errors) == 0, errors=errors)


def is_valid_envelope(envelope: object) -> bool:
    """True iff the envelope is well-formed per :func:`validate_envelope`."""
    return validate_envelope(envelope).ok


# ── Profile classification (spec §5.5.7 registration rule) ───────────────


@dataclass(frozen=True)
class ProfileClassification:
    """Outcome of :func:`classify_profile`. Field names match the TS
    ``ProfileClassification`` and the conformance corpus exactly."""

    uri_valid: bool
    atrib_maintained: bool
    registered: bool
    treat_as: str  # 'registered' | 'unknown-preserve'


def classify_profile(
    uri: object,
    registry: Sequence[str] = ATRIB_PROFILE_REGISTRY,
) -> ProfileClassification:
    """Classify a profile URI against the atrib registry. Identity is the
    full URI: a foreign domain reusing an atrib profile name (e.g.
    ``https://example.com/v1/evidence/oauth2``) is a valid third-party
    profile and MUST NOT be treated as the atrib profile of the same name.
    Never raises."""
    uri_valid = _is_https_uri(uri)
    atrib_maintained = uri_valid and isinstance(uri, str) and uri.startswith(
        ATRIB_PROFILE_BASE
    )
    name = uri[len(ATRIB_PROFILE_BASE) :] if atrib_maintained and isinstance(uri, str) else ""
    # A nested atrib-shaped path (e.g. .../oauth2/extra) is not a bare
    # registered name; require an exact trailing-name match.
    registered = atrib_maintained and len(name) > 0 and name in registry
    return ProfileClassification(
        uri_valid=uri_valid,
        atrib_maintained=atrib_maintained,
        registered=registered,
        treat_as="registered" if registered else "unknown-preserve",
    )


# ── Unknown-profile preservation (spec §5.5.7) ───────────────────────────


def render_envelope_opaque(envelope: EvidenceEnvelope) -> dict[str, str]:
    """The opaque rendering surface for any envelope (known or unknown
    profile): profile URI, tier, and payload hash. Consumers MUST render
    unknown-profile envelopes this way; they MUST NOT drop them and MUST
    NOT let them affect record validity."""
    return {
        "profile": envelope["profile"],
        "tier": envelope["tier"],
        "payload_hash": envelope["payload"]["hash"],
    }


# ── Legacy mapping (normative, spec §5.5.7) ──────────────────────────────


def map_legacy_evidence_block(block: Mapping[str, object]) -> EvidenceEnvelope:
    """Deterministically map a legacy §5.5.6 evidence block into envelope
    form; two implementations given the same block MUST produce identical
    envelopes (the TS ``mapLegacyEvidenceBlock`` / ``fromLegacyEvidenceBlock``).

    - ``protocol`` maps through the fixed five-row table; any other string
      raises ``ValueError`` (``unknown legacy evidence protocol '<p>'``) —
      the one normative MUST-reject. The mapping never invents a profile
      URI. Producer-side callers wrap this per §5.8.
    - The mapped envelope carries ``envelope: 1``,
      ``profile_version: "1.0.0"``, and ``tier: "attested"`` (a legacy
      block records what a caller-owned path accepted; it carries no trust
      roots, so it never claims ``"verified"``).
    - ``payload.hash`` commits to the legacy block itself (JCS), with
      ``media_type: "application/json"`` and ``ref.kind: "withheld"``.
    - ``issuer`` / ``subject`` / ``scope`` / ``attenuation_ok`` /
      ``delegation_ok`` copy into ``facts`` unchanged (nulls preserved);
      ``details``, when present, is committed as ``facts.details_hash``
      (never inlined).
    - ``valid`` / ``constraints`` / ``errors`` / ``warnings`` copy into
      ``result``. No ``verifier`` block: the mapping is mechanical, not a
      re-verification.
    """
    if not isinstance(block, Mapping):
        raise ValueError("atrib: legacy evidence block must be a mapping")
    protocol = block.get("protocol")
    if not isinstance(protocol, str) or protocol not in LEGACY_PROTOCOL_TO_PROFILE:
        raise ValueError(f"unknown legacy evidence protocol '{protocol}'")
    profile = LEGACY_PROTOCOL_TO_PROFILE[protocol]

    facts: dict[str, object] = {
        "issuer": block.get("issuer"),
        "subject": block.get("subject"),
        "scope": block.get("scope"),
        "attenuation_ok": block.get("attenuation_ok"),
        "delegation_ok": block.get("delegation_ok"),
    }
    if "details" in block:
        facts["details_hash"] = jcs_sha256(block["details"])

    envelope: dict[str, object] = {
        "envelope": 1,
        "profile": profile,
        "profile_version": "1.0.0",
        "tier": "attested",
        "payload": {
            "hash": jcs_sha256(dict(block)),
            "media_type": "application/json",
            "ref": {"kind": "withheld"},
        },
        "facts": facts,
        "result": {
            "valid": block.get("valid"),
            "constraints": block.get("constraints"),
            "errors": block.get("errors"),
            "warnings": block.get("warnings"),
        },
    }
    return cast(EvidenceEnvelope, envelope)


#: Spec-named alias — §5.5.7 refers to the mapping as ``fromLegacyEvidenceBlock``.
from_legacy_evidence_block = map_legacy_evidence_block


# ── Tier semantics (spec §5.5.7 tier rules) ──────────────────────────────


def order_envelope_instances(
    instances: Sequence[EvidenceEnvelope],
) -> list[EvidenceEnvelope]:
    """Order envelope instances the way consumers MUST: tier descending,
    then ``verifier.checked_at_ms`` descending, then verifier name
    ascending. Stable; does not mutate the input (the TS
    ``orderEnvelopeInstances``)."""

    def _verifier(env: EvidenceEnvelope) -> Mapping[str, object]:
        verifier = env.get("verifier")
        return verifier if isinstance(verifier, Mapping) else {}

    def _checked_at(env: EvidenceEnvelope) -> int:
        value = _verifier(env).get("checked_at_ms")
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    def _name(env: EvidenceEnvelope) -> str:
        value = _verifier(env).get("name")
        return value if isinstance(value, str) else ""

    def _compare(a: EvidenceEnvelope, b: EvidenceEnvelope) -> int:
        tier_delta = evidence_tier_rank(b.get("tier", "")) - evidence_tier_rank(
            a.get("tier", "")
        )
        if tier_delta != 0:
            return tier_delta
        checked_delta = _checked_at(b) - _checked_at(a)
        if checked_delta != 0:
            return checked_delta
        a_name, b_name = _name(a), _name(b)
        return (a_name > b_name) - (a_name < b_name)

    return sorted(instances, key=cmp_to_key(_compare))


def is_relay_identity_swap(
    original: Mapping[str, object],
    relayed: Mapping[str, object],
) -> bool:
    """Relay-swap detector (§5.5.7): an instance that differs from another
    ONLY in its ``verifier`` block — same tier, facts, result, payload — is
    a relay under a swapped identity, not a re-verification, and is
    flagged. Never raises on hostile input (returns ``False``)."""
    try:

        def _strip(envelope: Mapping[str, object]) -> dict[str, object]:
            return {key: value for key, value in envelope.items() if key != "verifier"}

        bodies_identical = jcs(_strip(original)) == jcs(_strip(relayed))
        verifier_changed = jcs(original.get("verifier")) != jcs(relayed.get("verifier"))
        return bodies_identical and verifier_changed
    except Exception:  # noqa: BLE001 — degradation contract
        return False


@dataclass(frozen=True)
class EnvelopeReproducibility:
    """Outcome of :func:`assess_reproducibility`."""

    reproducible: bool
    report: str  # 'reproducible' | 'claimed-not-reproducible'


def assess_reproducibility(envelope: EvidenceEnvelope) -> EnvelopeReproducibility:
    """Reproducibility of a well-formed envelope. A ``tier: "verified"``
    envelope whose payload cannot be retrieved (``ref.kind: "withheld"``)
    is still well-formed; consumers MUST report it as
    claimed-but-not-reproducible, mirroring the §2.12.7 tiered
    record-verifiability ladder."""
    payload = envelope.get("payload")
    ref = payload.get("ref") if isinstance(payload, Mapping) else None
    kind = ref.get("kind") if isinstance(ref, Mapping) else None
    reproducible = kind != "withheld"
    return EnvelopeReproducibility(
        reproducible=reproducible,
        report="reproducible" if reproducible else "claimed-not-reproducible",
    )


# ── Producer-side envelope builder ───────────────────────────────────────

_UNSET = object()


def build_evidence_envelope(
    *,
    profile: str,
    tier: str,
    profile_version: str = "1.0.0",
    payload_hash: str | None = None,
    payload_material: object = _UNSET,
    payload_material_utf8: str | None = None,
    media_type: str | None = None,
    ref_kind: str = "withheld",
    ref_uri: object = _UNSET,
    ref_record_hash: object = _UNSET,
    inline: object = _UNSET,
    facts: Mapping[str, object] | None = None,
    result: Mapping[str, object] | None = None,
    verifier: Mapping[str, object] | None = None,
) -> tuple[EvidenceEnvelope | None, list[str]]:
    """Build and validate a §5.5.7 envelope. ``payload.hash`` is computed
    from the material when not given explicitly: ``payload_material`` uses
    the JCS rule (:func:`jcs_sha256`, JSON media types) and
    ``payload_material_utf8`` uses the raw rule (:func:`raw_sha256`,
    e.g. ``application/jwt``).

    Returns ``(envelope, warnings)``; on any operational failure or shape
    rejection the envelope is ``None`` and ``warnings`` says why — dropping
    the envelope, never the record or the primary tool response (§5.8).
    Raises ``ValueError`` ONLY on contradictory input: an explicit
    ``payload_hash`` alongside payload material, both material forms at
    once, or no payload identity at all.
    """
    has_material = payload_material is not _UNSET
    has_material_utf8 = payload_material_utf8 is not None
    if payload_hash is not None and (has_material or has_material_utf8):
        raise ValueError(
            "atrib: pass either payload_hash or payload material, not both"
        )
    if has_material and has_material_utf8:
        raise ValueError(
            "atrib: pass either payload_material (JCS rule) or "
            "payload_material_utf8 (raw rule), not both"
        )
    if payload_hash is None and not has_material and not has_material_utf8:
        raise ValueError(
            "atrib: an envelope needs a payload identity — pass payload_hash "
            "or payload material"
        )

    warnings: list[str] = []
    computed_hash = payload_hash
    if computed_hash is None:
        try:
            if has_material_utf8:
                computed_hash = raw_sha256(cast(str, payload_material_utf8))
            else:
                computed_hash = jcs_sha256(payload_material)
        except Exception as exc:  # noqa: BLE001 — degradation contract
            warnings.append(
                f"atrib: evidence payload could not be canonicalized, envelope dropped: {exc}"
            )
            return None, warnings

    # Sentinel defaults: the D137 schema types ref.uri and ref.record_hash
    # as string-or-null, so an explicit None must be expressible (`"uri":
    # null` in the corpus maximal case) and only an omitted kwarg is absent.
    ref: dict[str, object] = {"kind": ref_kind}
    if ref_uri is not _UNSET:
        ref["uri"] = ref_uri
    if ref_record_hash is not _UNSET:
        ref["record_hash"] = ref_record_hash
    payload: dict[str, object] = {"hash": computed_hash, "ref": ref}
    if media_type is not None:
        payload["media_type"] = media_type
    if inline is not _UNSET:
        payload["inline"] = inline

    envelope: dict[str, object] = {
        "envelope": 1,
        "profile": profile,
        "profile_version": profile_version,
        "tier": tier,
        "payload": payload,
    }
    if facts is not None:
        envelope["facts"] = dict(facts)
    envelope["result"] = (
        dict(result)
        if result is not None
        else {"valid": True, "constraints": [], "errors": [], "warnings": []}
    )
    if verifier is not None:
        envelope["verifier"] = dict(verifier)

    validation = validate_envelope(envelope)
    if not validation.ok:
        warnings.append(
            "atrib: evidence envelope rejected, dropped: " + ", ".join(validation.errors)
        )
        return None, warnings
    return cast(EvidenceEnvelope, envelope), warnings
