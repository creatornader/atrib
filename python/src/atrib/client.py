# SPDX-License-Identifier: Apache-2.0
"""AtribClient: the attest/recall verbs for Python hosts.

Mirrors the ``@atrib/sdk`` TypeScript surface: ``attest()`` (write) and
``recall()`` (read), with the same degradation contract (§5.8 — operational
failures degrade into ``warnings``, never throw; contradictory input is
the only raise path). The v0 Python client signs in-process via the ported
record layer; daemon-first transport arrives with the post-2026-07-28
stateless MCP HTTP client (the current runtime's initialize-handshake
transport is deliberately not reimplemented here).
"""

from __future__ import annotations

import os
import re
import secrets
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from .anchors import (
    ANCHOR_TYPES,
    AnchorDescriptor,
    AnchorSetConfig,
    anchor_descriptor_endpoint,
    anchor_descriptor_type,
    resolve_anchor_posture,
    resolve_effective_anchors,
)
from .chain import resolve_chain_root
from .hashes import record_hash_ref
from .keys import ResolvedKey, resolve_key
from .mirror import (
    default_mirror_read_path,
    default_mirror_write_path,
    mirror_tail_hash_hex,
    read_mirror,
)
from .records import build_and_sign_emit_record
from .submission import SubmissionQueue
from .types import (
    EVENT_TYPE_ANNOTATION_URI,
    EVENT_TYPE_REVISION_URI,
    AtribRecord,
    is_valid_event_type_uri,
    normalize_event_type,
)

_CONTEXT_ID_RE = re.compile(r"^[0-9a-f]{32}\Z")
_SHA256_REF_RE = re.compile(r"^sha256:[0-9a-f]{64}\Z")

_REF_EVENT_TYPE = {
    "annotates": EVENT_TYPE_ANNOTATION_URI,
    "revises": EVENT_TYPE_REVISION_URI,
}

DEFAULT_PRODUCER = "atrib-sdk-py"

# One anchor in the anchor set (D138, §2.11.12). A bare string is an
# atrib-log §2.6.1 endpoint (shorthand for {"url": s}); the mapping form is
# an AnchorDescriptor (`url` wins over `endpoint`; `anchor_type` absent or
# None means 'atrib-log'; non-atrib-log types have no Python transport yet
# and are skipped with a warning naming the type).
AnchorSpec = str | Mapping[str, object]


@dataclass(frozen=True)
class _AnchorPlan:
    """Resolved anchor posture + the atrib-log endpoints to fan out to."""

    posture: dict[str, object]  # {effective_anchor_count, used_default_set, warned}
    sidecar_marker: Mapping[str, object] | None  # §2.11.12 rule 4, or None
    endpoints: list[str]
    warnings: list[str]


def _parse_anchor_endpoint(endpoint: str) -> bool:
    """True iff the endpoint parses as an absolute URL (scheme + host)."""
    try:
        split = urlsplit(endpoint)
    except ValueError:
        return False
    return bool(split.scheme) and bool(split.netloc)


def _resolve_anchor_plan(
    anchors: list[AnchorSpec] | None,
    allow_single_anchor: bool,
    env: Mapping[str, str],
) -> _AnchorPlan:
    """Resolve the §2.11.12 anchor posture and the atrib-log fan-out set.

    Mirrors the TS reference (`resolveAnchorSet` in the SDK config layer +
    `resolveAnchorPosture` in packages/mcp/src/anchors.ts): hostile shapes,
    unregistered ``anchor_type`` values, and entries without a usable
    endpoint warn-and-skip (never raise, §5.8) and are EXCLUDED from the
    effective set — so they do not count toward the configured posture.
    Registered non-atrib-log anchor types stay in the set (they count) but
    their submission legs are skipped with a warning naming the type: their
    transports are TS-side stubs today and have no Python port yet. When no
    anchors were configured the built-in default set applies and its
    atrib-log member's endpoint defers to $ATRIB_LOG_ENDPOINT when set.
    """
    warnings: list[str] = []
    config: AnchorSetConfig = {}
    if anchors is not None:
        descriptors: list[AnchorDescriptor] = []
        for spec in anchors:
            if isinstance(spec, str):
                descriptor: dict[str, object] = {"url": spec}
            elif isinstance(spec, Mapping):
                descriptor = dict(spec)
            else:
                warnings.append(
                    f"atrib: anchor entry {spec!r} is not a string or mapping; skipping"
                )
                continue
            # TS parity: `anchorType !== undefined` — a PRESENT anchor_type
            # (including JSON null / Python None) must be a registered
            # string; only an absent field defaults to atrib-log.
            if "anchor_type" in descriptor:
                anchor_type = descriptor["anchor_type"]
                if not isinstance(anchor_type, str) or anchor_type not in ANCHOR_TYPES:
                    named = descriptor.get("url")
                    if named is None:
                        named = descriptor.get("endpoint")
                    suffix = f" ({named})" if isinstance(named, str) else ""
                    warnings.append(
                        f"atrib: anchor_type '{anchor_type}'{suffix} is not in the "
                        f"§2.11.8 registry ({', '.join(ANCHOR_TYPES)}); skipping this anchor"
                    )
                    continue
                effective_type: str = anchor_type
            else:
                effective_type = "atrib-log"
            endpoint = anchor_descriptor_endpoint(descriptor)
            if effective_type == "atrib-log" or endpoint is not None:
                if not isinstance(endpoint, str):
                    warnings.append(
                        "atrib: anchor entry without a string url/endpoint; skipping"
                    )
                    continue
                if not _parse_anchor_endpoint(endpoint):
                    warnings.append(
                        f"atrib: anchor endpoint '{endpoint}' is not a valid URL; skipping"
                    )
                    continue
            descriptors.append(cast(AnchorDescriptor, descriptor))
        config["anchors"] = descriptors
    if allow_single_anchor:
        config["allow_single_anchor"] = True

    posture = resolve_anchor_posture(config)
    if posture.warn:
        warnings.append(
            f"atrib: anchor config names {posture.effective_anchor_count} anchor(s) "
            "without allow_single_anchor; anchor plurality (>=2 independent anchors, "
            "spec §2.11.12) is not met. The operation continues and signing is "
            "unaffected (§5.8)."
        )

    endpoints: list[str] = []
    for entry in cast("list[object]", resolve_effective_anchors(config)):
        if not isinstance(entry, Mapping):
            warnings.append(
                f"atrib: anchor entry {entry!r} is not a string or mapping; skipping"
            )
            continue
        effective = cast("Mapping[str, object]", entry)
        leg_type = anchor_descriptor_type(effective)
        if leg_type != "atrib-log":
            warnings.append(
                f"atrib: no {leg_type!r} transport shipped in the Python SDK yet; "
                "anchor leg skipped"
            )
            continue
        endpoint = anchor_descriptor_endpoint(effective)
        if posture.used_default_set:
            # Default-set nuance: zero-config producers keep honoring
            # $ATRIB_LOG_ENDPOINT for the atrib-log member.
            endpoint = env.get("ATRIB_LOG_ENDPOINT") or endpoint
        if not isinstance(endpoint, str):
            warnings.append("atrib: anchor entry without a string url/endpoint; skipping")
            continue
        if not _parse_anchor_endpoint(endpoint):
            warnings.append(
                f"atrib: anchor endpoint '{endpoint}' is not a valid URL; skipping"
            )
            continue
        endpoints.append(endpoint)

    return _AnchorPlan(
        posture={
            "effective_anchor_count": posture.effective_anchor_count,
            "used_default_set": posture.used_default_set,
            "warned": posture.warn,
        },
        sidecar_marker=posture.sidecar_anchor_config,
        endpoints=endpoints,
        warnings=warnings,
    )


@dataclass(frozen=True)
class AttestRef:
    kind: str  # 'annotates' | 'revises'
    record_hash: str


@dataclass(frozen=True)
class AttestResult:
    record_hash: str | None
    context_id: str | None
    via: str  # 'in-process' | 'none'
    warnings: list[str] = field(default_factory=list)
    # §2.11.12 posture of the client's anchor set (D138):
    # {"effective_anchor_count": int, "used_default_set": bool, "warned": bool}
    anchor_posture: dict[str, object] | None = None


@dataclass(frozen=True)
class RecallOutcome:
    shape: str
    via: str  # 'in-process' | 'none'
    data: object
    warnings: list[str] = field(default_factory=list)


def _resolve_env_context_id(env: Mapping[str, str]) -> str | None:
    """D078/D083 subset: ATRIB_CONTEXT_ID, then the harness registry env
    vars (Claude Code session UUID stripped+lowercased, Codex thread id)."""
    explicit = env.get("ATRIB_CONTEXT_ID")
    if explicit and _CONTEXT_ID_RE.match(explicit):
        return explicit
    for var in ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"):
        raw = env.get(var)
        if raw:
            candidate = raw.replace("-", "").lower()
            if _CONTEXT_ID_RE.match(candidate):
                return candidate
    return None


class AtribClient:
    """attest/recall over the local substrate (mirror + public log)."""

    def __init__(
        self,
        *,
        key: ResolvedKey | None | object = ...,
        context_id: str | None = None,
        anchors: list[AnchorSpec] | None = None,
        allow_single_anchor: bool = False,
        producer: str = DEFAULT_PRODUCER,
        mirror_write_path: Path | str | None = None,
        mirror_read_path: Path | str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> None:
        self._env: Mapping[str, str] = os.environ if env is None else env
        self._explicit_key = key
        self._resolved_key: ResolvedKey | None = None
        self._key_resolved = False
        self._context_id = context_id
        self._producer = producer
        anchor_plan = _resolve_anchor_plan(anchors, allow_single_anchor, self._env)
        self._anchor_posture = anchor_plan.posture
        self._anchor_sidecar_marker = anchor_plan.sidecar_marker
        self._anchor_warnings = anchor_plan.warnings
        # D138 fan-out: one non-blocking §2.6.1 queue per effective
        # atrib-log anchor endpoint (§5.3.5 — never awaited on attest).
        self._queues = [SubmissionQueue(endpoint) for endpoint in anchor_plan.endpoints]
        self._mirror_write = (
            Path(mirror_write_path)
            if mirror_write_path is not None
            else default_mirror_write_path(self._env)
        )
        self._mirror_read = (
            Path(mirror_read_path)
            if mirror_read_path is not None
            else default_mirror_read_path(self._env)
        )

    # ── attest ───────────────────────────────────────────────────────────

    def attest(
        self,
        content: Mapping[str, object],
        *,
        event_type: str | None = None,
        ref: AttestRef | None = None,
        informed_by: list[str] | None = None,
        context_id: str | None = None,
        chain_root: str | None = None,
        provenance_token: str | None = None,
        tool_name: str | None = None,
        args_hash: str | None = None,
        result_hash: str | None = None,
        timestamp_ms: int | None = None,
    ) -> AttestResult:
        """Single write verb. Raises only on contradictory input; every
        operational failure degrades into warnings (§5.8)."""
        warnings = list(self._anchor_warnings)

        resolved_event_type = self._resolve_event_type(event_type, ref)
        if not is_valid_event_type_uri(resolved_event_type):
            raise ValueError(f"atrib: invalid event_type URI: {resolved_event_type!r}")
        annotates = ref.record_hash if ref and ref.kind == "annotates" else None
        revises = ref.record_hash if ref and ref.kind == "revises" else None
        for label, value in (("annotates", annotates), ("revises", revises)):
            if value is not None and not _SHA256_REF_RE.match(value):
                raise ValueError(f"atrib: {label} ref must match sha256:<64-hex>")
        if resolved_event_type == EVENT_TYPE_ANNOTATION_URI and annotates is None:
            raise ValueError("atrib: annotation requires ref kind 'annotates'")
        if resolved_event_type == EVENT_TYPE_REVISION_URI and revises is None:
            raise ValueError("atrib: revision requires ref kind 'revises'")
        if chain_root is not None and context_id is None and self._default_context_id() is None:
            raise ValueError("atrib: explicit chain_root requires a context_id")

        key = self._resolve_client_key()
        if key is None:
            warnings.append(
                "atrib: no signing key available; operating in pass-through mode "
                "(§5.8), no record emitted"
            )
            return AttestResult(
                record_hash=None,
                context_id=None,
                via="none",
                warnings=warnings,
                anchor_posture=dict(self._anchor_posture),
            )

        effective_context = context_id or self._default_context_id()
        if effective_context is None:
            # §1.5.1: synthesize fresh; NEVER inherit context_id from the
            # mirror tail (session-conflation guard).
            effective_context = secrets.token_hex(16)
            warnings.append("atrib: no context_id available; created fresh orphan context")
        if not _CONTEXT_ID_RE.match(effective_context):
            raise ValueError("atrib: context_id must be 32 lowercase hex characters")

        if provenance_token is not None:
            # §1.2.6 genesis-only invariant: refuse when the context already
            # has records on the local mirror (middleware SHOULD refuse).
            if mirror_tail_hash_hex(self._mirror_write, effective_context) is not None or (
                mirror_tail_hash_hex(self._mirror_read, effective_context) is not None
            ):
                raise ValueError(
                    "atrib: provenance_token is genesis-only; context already has records"
                )

        effective_chain_root = chain_root or resolve_chain_root(
            context_id=effective_context,
            env=self._env,
            mirror_tail_hex=self._mirror_tail_for(effective_context),
        )

        try:
            record = build_and_sign_emit_record(
                private_key=key.private_key,
                event_type=resolved_event_type,
                context_id=effective_context,
                chain_root=effective_chain_root,
                content=content,
                informed_by=informed_by,
                provenance_token=provenance_token,
                annotates=annotates,
                revises=revises,
                tool_name=tool_name,
                args_hash=args_hash,
                result_hash=result_hash,
                timestamp_ms=timestamp_ms,
            )
        except (ValueError, TypeError):
            raise
        except Exception as exc:  # noqa: BLE001 — degradation contract
            warnings.append(f"atrib: signing failed: {exc}")
            return AttestResult(
                record_hash=None,
                context_id=None,
                via="none",
                warnings=warnings,
                anchor_posture=dict(self._anchor_posture),
            )

        self._mirror_and_submit(record, content, warnings)
        return AttestResult(
            record_hash=record_hash_ref(record),
            context_id=effective_context,
            via="in-process",
            warnings=warnings,
            anchor_posture=dict(self._anchor_posture),
        )

    # ── recall ───────────────────────────────────────────────────────────

    def recall(
        self,
        *,
        shape: str = "history",
        context_id: str | None = None,
        event_type: str | None = None,
        creator_key: str | None = None,
        limit: int = 10,
        since_ms: int | None = None,
        until_ms: int | None = None,
        verify_signatures: bool = True,
    ) -> RecallOutcome:
        """Single read verb over the local mirror (v0 shapes: 'history',
        'session_chain'). Unknown shapes degrade with a warning outcome."""
        warnings: list[str] = []
        if shape not in ("history", "session_chain"):
            warnings.append(
                f"atrib: recall shape '{shape}' is not available in the Python "
                "SDK v0; use the TypeScript SDK or the primitives runtime"
            )
            return RecallOutcome(shape=shape, via="none", data=None, warnings=warnings)

        effective_context = context_id or (
            self._default_context_id() if shape == "session_chain" else None
        )
        normalized_event_type = (
            normalize_event_type(event_type) if event_type is not None else None
        )

        from .signing import verify_record  # local import avoids cycle at module load

        records: list[dict[str, object]] = []
        seen = 0
        for line in reversed(read_mirror(self._mirror_read) + read_mirror(self._mirror_write)):
            record = line.record
            if effective_context is not None and record.get("context_id") != effective_context:
                continue
            if (
                normalized_event_type is not None
                and record.get("event_type") != normalized_event_type
            ):
                continue
            if creator_key is not None and record.get("creator_key") != creator_key:
                continue
            timestamp = record.get("timestamp")
            if isinstance(timestamp, int):
                if since_ms is not None and timestamp < since_ms:
                    continue
                if until_ms is not None and timestamp > until_ms:
                    continue
            signature_verified = verify_record(record) if verify_signatures else None
            if verify_signatures and signature_verified is False:
                continue
            entry: dict[str, object] = {
                "record_hash": record_hash_ref(record),
                "event_type": record.get("event_type"),
                "context_id": record.get("context_id"),
                "creator_key": record.get("creator_key"),
                "timestamp": record.get("timestamp"),
            }
            if signature_verified is not None:
                entry["signature_verified"] = signature_verified
            if line.sidecar is not None and "content" in line.sidecar:
                entry["local_content"] = line.sidecar["content"]
            records.append(entry)
            seen += 1
            if seen >= limit:
                break

        data: dict[str, object] = {
            "total": seen,
            "returned": len(records),
            "records": records,
        }
        return RecallOutcome(shape=shape, via="in-process", data=data, warnings=warnings)

    def flush(self, deadline_s: float = 30.0) -> None:
        """Bounded wait for pending log submissions on every anchor leg
        (never raises)."""
        for queue in self._queues:
            queue.flush(deadline_s)

    # ── internals ────────────────────────────────────────────────────────

    def _resolve_event_type(self, event_type: str | None, ref: AttestRef | None) -> str:
        if ref is not None:
            derived = _REF_EVENT_TYPE.get(ref.kind)
            if derived is None:
                raise ValueError(f"atrib: unknown attest ref kind: {ref.kind!r}")
            if event_type is not None:
                normalized = normalize_event_type(event_type)
                if normalized != derived:
                    raise ValueError(
                        f"atrib: attest ref kind '{ref.kind}' requires event_type "
                        f"'{derived}', got '{normalized}'"
                    )
            return derived
        return normalize_event_type(event_type or "observation")

    def _default_context_id(self) -> str | None:
        if self._context_id is not None:
            return self._context_id
        return _resolve_env_context_id(self._env)

    def _resolve_client_key(self) -> ResolvedKey | None:
        if self._explicit_key is not ...:
            explicit = self._explicit_key
            return explicit if isinstance(explicit, ResolvedKey) else None
        if not self._key_resolved:
            self._resolved_key = resolve_key(self._env)
            self._key_resolved = True
        return self._resolved_key

    def _mirror_tail_for(self, context_id: str) -> str | None:
        # Prefer the write mirror (our own newest record), then the shared
        # read source — mirroring @atrib/emit's inheritance ordering.
        return mirror_tail_hash_hex(self._mirror_write, context_id) or mirror_tail_hash_hex(
            self._mirror_read, context_id
        )

    def _mirror_and_submit(
        self,
        record: AtribRecord,
        content: Mapping[str, object],
        warnings: list[str],
    ) -> None:
        from .mirror import append_mirror_line

        sidecar: dict[str, object] = {
            "producer": self._producer,
            "content": dict(content),
        }
        if self._anchor_sidecar_marker is not None:
            # §2.11.12 rule 4 / §5.9.3 degradation marker:
            # _local.anchor_config = {configured: <n>, allow_single_anchor: false}
            sidecar["anchor_config"] = dict(self._anchor_sidecar_marker)
        try:
            append_mirror_line(self._mirror_write, record, sidecar=sidecar)
        except Exception as exc:  # noqa: BLE001 — degradation contract
            warnings.append(f"atrib: mirror write failed: {exc}")
        # D138 fan-out: per-anchor fire-and-forget with independent retry
        # queues; one leg's failure never affects another leg or the caller.
        for queue in self._queues:
            try:
                queue.submit(record)
            except Exception as exc:  # noqa: BLE001 — degradation contract
                warnings.append(f"atrib: log submission enqueue failed: {exc}")

    def __enter__(self) -> "AtribClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        try:
            self.flush(deadline_s=5.0)
        except Exception:  # noqa: BLE001 — degradation contract
            print("atrib: flush on close failed", file=sys.stderr)
