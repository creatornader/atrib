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
from urllib.parse import urlsplit

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

# P043 headroom: one anchor in the anchor set. A bare string is an
# atrib-log §2.6.1 endpoint; the mapping form carries the forthcoming
# `anchor_type` discriminator (absent or 'atrib-log' = atrib log; other
# types are skipped with a warning until upgrade-path step 1 lands).
AnchorSpec = str | Mapping[str, object]


def _resolve_anchor_set(
    anchors: list[AnchorSpec] | None,
) -> tuple[str | None, list[str]]:
    """Normalize the anchor set to today's single-atrib-log posture.
    Returns (primary_log_endpoint, warnings); never raises."""
    warnings: list[str] = []
    if not anchors:
        return None, warnings
    atrib_log_endpoints: list[str] = []
    for spec in anchors:
        # Hostile/malformed entries warn-and-skip, never raise (§5.8); the
        # skip rules mirror the TS resolveAnchorSet exactly.
        anchor_type_present = False
        anchor_type: object = None
        if isinstance(spec, str):
            endpoint: object = spec
        elif isinstance(spec, Mapping):
            endpoint = spec.get("endpoint")
            anchor_type_present = "anchor_type" in spec
            anchor_type = spec.get("anchor_type")
        else:
            warnings.append(
                f"atrib: anchor entry {spec!r} is not a string or mapping; skipping"
            )
            continue
        if not isinstance(endpoint, str):
            warnings.append("atrib: anchor entry without a string endpoint; skipping")
            continue
        if anchor_type_present and anchor_type != "atrib-log":
            warnings.append(
                f"atrib: anchor_type '{anchor_type}' ({endpoint}) is not supported yet "
                "(upgrade-path step 1); skipping this anchor"
            )
            continue
        split = urlsplit(endpoint)
        if not split.scheme or not split.netloc:
            warnings.append(
                f"atrib: anchor endpoint '{endpoint}' is not a valid URL; skipping"
            )
            continue
        atrib_log_endpoints.append(endpoint)
    if len(atrib_log_endpoints) > 1:
        warnings.append(
            "atrib: multi-anchor fan-out is not implemented yet "
            "(upgrade-path step 1); submitting to the first anchor only"
        )
    return (atrib_log_endpoints[0] if atrib_log_endpoints else None), warnings


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
        primary_endpoint, self._anchor_warnings = _resolve_anchor_set(anchors)
        endpoint = primary_endpoint or self._env.get("ATRIB_LOG_ENDPOINT")
        self._queue = SubmissionQueue(endpoint)
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
            return AttestResult(record_hash=None, context_id=None, via="none", warnings=warnings)

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
            return AttestResult(record_hash=None, context_id=None, via="none", warnings=warnings)

        self._mirror_and_submit(record, content, warnings)
        return AttestResult(
            record_hash=record_hash_ref(record),
            context_id=effective_context,
            via="in-process",
            warnings=warnings,
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
        """Bounded wait for pending log submissions (never raises)."""
        self._queue.flush(deadline_s)

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

        try:
            append_mirror_line(
                self._mirror_write,
                record,
                sidecar={"producer": self._producer, "content": dict(content)},
            )
        except Exception as exc:  # noqa: BLE001 — degradation contract
            warnings.append(f"atrib: mirror write failed: {exc}")
        try:
            self._queue.submit(record)
        except Exception as exc:  # noqa: BLE001 — degradation contract
            warnings.append(f"atrib: log submission enqueue failed: {exc}")

    def __enter__(self) -> "AtribClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        try:
            self._queue.flush(deadline_s=5.0)
        except Exception:  # noqa: BLE001 — degradation contract
            print("atrib: flush on close failed", file=sys.stderr)
