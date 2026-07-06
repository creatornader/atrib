# SPDX-License-Identifier: Apache-2.0
"""Record construction for explicit attest writes.

Port of ``@atrib/emit``'s ``buildAndSignEmitRecord`` (services/atrib-emit/
src/sign.ts): the synthetic content_id pair, the D099 default args_hash
commitment (sha256 of JCS(content)), lexicographically-sorted informed_by,
and omission-not-null optional fields. Identical inputs produce records
byte-identical to the TypeScript producers — a verifier MUST NOT be able
to tell which implementation signed a record.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Mapping

from .canon import jcs
from .content_id import compute_content_id
from .encoding import base64url_encode, hex_encode
from .signing import get_public_key, sign_record
from .types import SPEC_VERSION, AtribRecord

# Frozen historical constant shared with @atrib/emit; it embeds the original
# package name, not the verb, and MUST NOT change (old records must keep
# verifying and new records must stay content_id-compatible).
SYNTHETIC_SERVER_URL = "mcp://atrib-emit"


def leaf_of_event_type_uri(uri: str) -> str:
    """Trailing path segment for atrib-namespace URIs; the URI itself for
    slash-less or trailing-slash inputs."""
    slash_idx = uri.rfind("/")
    if slash_idx == -1:
        return uri
    leaf = uri[slash_idx + 1 :]
    return leaf if leaf else uri


def content_hash(content: Mapping[str, object]) -> str:
    """D099 default args_hash: ``sha256:<hex(SHA-256(JCS(content)))>``."""
    digest = hashlib.sha256(jcs(dict(content))).digest()
    return f"sha256:{hex_encode(digest)}"


def build_and_sign_emit_record(
    *,
    private_key: bytes,
    event_type: str,
    context_id: str,
    chain_root: str,
    content: Mapping[str, object],
    informed_by: list[str] | None = None,
    provenance_token: str | None = None,
    annotates: str | None = None,
    revises: str | None = None,
    tool_name: str | None = None,
    args_hash: str | None = None,
    result_hash: str | None = None,
    timestamp_ms: int | None = None,
) -> AtribRecord:
    """Build, sign, and return a complete AtribRecord ready for submission.
    Pure aside from the signing primitive; no I/O. ``timestamp_ms`` injects
    the clock for deterministic tests."""
    public_key = base64url_encode(get_public_key(private_key))
    content_id = compute_content_id(SYNTHETIC_SERVER_URL, leaf_of_event_type_uri(event_type))
    effective_args_hash = args_hash if args_hash else content_hash(content)

    record: dict[str, object] = {
        "spec_version": SPEC_VERSION,
        "content_id": content_id,
        "creator_key": public_key,
        "chain_root": chain_root,
        "event_type": event_type,
        "context_id": context_id,
        "timestamp": int(time.time() * 1000) if timestamp_ms is None else timestamp_ms,
    }
    if informed_by:
        record["informed_by"] = sorted(informed_by)
    if annotates:
        record["annotates"] = annotates
    if effective_args_hash:
        record["args_hash"] = effective_args_hash
    if provenance_token:
        record["provenance_token"] = provenance_token
    if result_hash:
        record["result_hash"] = result_hash
    if revises:
        record["revises"] = revises
    if tool_name:
        record["tool_name"] = tool_name

    return sign_record(record, private_key)
