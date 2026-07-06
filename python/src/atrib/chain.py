# SPDX-License-Identifier: Apache-2.0
"""chain_root computation and multi-producer resolution (§1.2.3, §1.2.3.1).

``resolve_chain_root`` is a bit-for-bit port of ``resolveChainRoot`` in
``packages/mcp/src/chain-root.ts`` (the D067 single source of truth for
chain-root selection). The precedence ordering is normative and tested
against ``spec/conformance/1.2.3/multi-producer/``. Never reimplement
chain selection ad hoc.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping

from .canon import canonical_record
from .encoding import hex_encode

# \Z, not $: Python's $ also matches before a trailing newline, which the
# JS reference regexes (/…$/) do not accept.
_ENV_TAIL_RE = re.compile(r"^sha256:[0-9a-f]{64}\Z")
_MIRROR_TAIL_RE = re.compile(r"^[0-9a-f]{64}\Z")


def genesis_chain_root(context_id: str) -> str:
    """§1.2.3: ``"sha256:" + hex(SHA-256(UTF-8(context_id)))``."""
    digest = hashlib.sha256(context_id.encode("utf-8")).digest()
    return f"sha256:{hex_encode(digest)}"


def chain_root(parent_record: Mapping[str, object]) -> str:
    """chain_root for a non-genesis record: hash of the parent's canonical
    signed form."""
    digest = hashlib.sha256(canonical_record(parent_record)).digest()
    return f"sha256:{hex_encode(digest)}"


def resolve_chain_root(
    *,
    context_id: str,
    inbound_record_hash_hex: str | None = None,
    auto_chain_tail_hex: str | None = None,
    mirror_tail_hex: str | None = None,
    env: Mapping[str, str] | None = None,
) -> str:
    """Resolve the chain_root for a new record being signed (§1.2.3.1).

    Precedence (highest to lowest), identical to the TypeScript reference:

    1. Inbound propagation token (``inbound_record_hash_hex``) — the
       §1.5.2 cross-process handoff. MUST win when present.
    2. Within-process auto-chain tail (``auto_chain_tail_hex``).
    3. ``ATRIB_CHAIN_TAIL_<context_id>`` env var, accepted only when it
       matches ``sha256:<64-hex>`` exactly; malformed values fall through.
    4. Mirror-file tail (``mirror_tail_hex``), accepted only as bare
       64-hex; caller must pre-filter to the same context_id.
    5. Synthetic genesis.

    Pure synchronous function; pass a stub ``env`` in tests.
    """
    if inbound_record_hash_hex:
        return f"sha256:{inbound_record_hash_hex}"
    if auto_chain_tail_hex:
        return f"sha256:{auto_chain_tail_hex}"
    environment: Mapping[str, str] = os.environ if env is None else env
    env_tail = environment.get(f"ATRIB_CHAIN_TAIL_{context_id}")
    if env_tail and _ENV_TAIL_RE.match(env_tail):
        return env_tail
    if mirror_tail_hex and _MIRROR_TAIL_RE.match(mirror_tail_hex):
        return f"sha256:{mirror_tail_hex}"
    return genesis_chain_root(context_id)
