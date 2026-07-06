# SPDX-License-Identifier: Apache-2.0
"""Local mirror conventions (§5.9).

JSONL files under ``~/.atrib/records/``. Readers MUST tolerate all three
line shapes (§5.9.2): the preferred ``{record, _local?, proof?,
written_at}`` envelope, the sidecar-less envelope, and the legacy bare
record. The ``_local`` sidecar lives at ENVELOPE level, never inside
``record`` (it would break the signature), and never reaches the public
log (§5.9.4).
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .hashes import record_hash_hex
from .types import EVENT_TYPE_TRANSACTION_URI, AtribRecord

_REQUIRED_FIELDS = (
    "spec_version",
    "creator_key",
    "chain_root",
    "event_type",
    "context_id",
    "timestamp",
)


@dataclass(frozen=True)
class MirrorLine:
    record: AtribRecord
    sidecar: Mapping[str, object] | None
    proof: Mapping[str, object] | None
    written_at: int | None


def default_mirror_write_path(env: Mapping[str, str] | None = None) -> Path:
    """Write target: $ATRIB_MIRROR_FILE, else
    ``~/.atrib/records/atrib-emit-<agent>.jsonl`` (the historical emit
    pattern, kept so cross-producer chain inheritance keeps working)."""
    environment: Mapping[str, str] = os.environ if env is None else env
    override = environment.get("ATRIB_MIRROR_FILE")
    if override:
        return Path(override)
    agent = environment.get("ATRIB_AGENT") or "claude-code"
    return Path.home() / ".atrib" / "records" / f"atrib-emit-{agent}.jsonl"


def default_mirror_read_path(env: Mapping[str, str] | None = None) -> Path:
    """Chain-inheritance read source: $ATRIB_AUTOCHAIN_SOURCE, then
    $ATRIB_MIRROR_FILE, then ``~/.atrib/records/<agent>.jsonl``."""
    environment: Mapping[str, str] = os.environ if env is None else env
    source = environment.get("ATRIB_AUTOCHAIN_SOURCE") or environment.get(
        "ATRIB_MIRROR_FILE"
    )
    if source:
        return Path(source)
    agent = environment.get("ATRIB_AGENT") or "claude-code"
    return Path.home() / ".atrib" / "records" / f"{agent}.jsonl"


def _has_required_fields(candidate: Mapping[str, object]) -> bool:
    for field in _REQUIRED_FIELDS:
        if field not in candidate:
            return False
    if "signature" in candidate:
        return True
    return (
        candidate.get("event_type") == EVENT_TYPE_TRANSACTION_URI
        and "signers" in candidate
    )


def parse_mirror_line(line: str) -> MirrorLine | None:
    """§5.9.5 read normalization. Returns None for malformed lines (skip)."""
    try:
        parsed = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    inner = parsed.get("record")
    if isinstance(inner, dict) and _has_required_fields(inner):
        sidecar = parsed.get("_local")
        proof = parsed.get("proof")
        written_at = parsed.get("written_at")
        return MirrorLine(
            record=cast(AtribRecord, inner),
            sidecar=sidecar if isinstance(sidecar, dict) else None,
            proof=proof if isinstance(proof, dict) else None,
            written_at=written_at if isinstance(written_at, int) else None,
        )
    if _has_required_fields(parsed):
        return MirrorLine(
            record=cast(AtribRecord, parsed), sidecar=None, proof=None, written_at=None
        )
    return None


def read_mirror(path: Path | str) -> list[MirrorLine]:
    """Read every well-formed line. Missing file → empty list; a line with
    invalid UTF-8 (or any other malformation) is SKIPPED, not fatal — one
    bad byte must never take out the whole mirror (§5.8, §5.9.5)."""
    try:
        data = Path(path).read_bytes()
    except OSError:
        return []
    lines: list[MirrorLine] = []
    for raw_bytes in data.split(b"\n"):
        try:
            raw = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if not raw.strip():
            continue
        parsed = parse_mirror_line(raw)
        if parsed is not None:
            lines.append(parsed)
    return lines


def read_mirror_tail(path: Path | str, context_id: str | None = None) -> AtribRecord | None:
    """Newest record on the mirror, optionally filtered by context_id.
    Returns None when the file is missing/empty (§5.8)."""
    newest: AtribRecord | None = None
    for line in read_mirror(path):
        if context_id is not None and line.record.get("context_id") != context_id:
            continue
        newest = line.record
    return newest


def mirror_tail_hash_hex(path: Path | str, context_id: str) -> str | None:
    """Bare-hex record hash of the newest same-context record, in the shape
    ``resolve_chain_root(mirror_tail_hex=…)`` expects."""
    tail = read_mirror_tail(path, context_id)
    if tail is None:
        return None
    return record_hash_hex(tail)


def append_mirror_line(
    path: Path | str,
    record: AtribRecord,
    *,
    sidecar: Mapping[str, object] | None = None,
    proof: Mapping[str, object] | None = None,
) -> None:
    """Append a Shape-1/2 envelope line. Best-effort per §5.8: failures
    warn on stderr and return."""
    envelope: dict[str, object] = {
        "record": record,
        "proof": dict(proof) if proof is not None else None,
        "written_at": int(time.time() * 1000),
    }
    if sidecar is not None:
        envelope["_local"] = dict(sidecar)
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(envelope, separators=(",", ":")) + "\n")
    except OSError as exc:
        print(f"atrib: mirror write failed: {exc}", file=sys.stderr)
