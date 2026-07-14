# SPDX-License-Identifier: Apache-2.0
"""Signing-key resolution (§5.6).

Portable subset of ``@atrib/emit``'s resolveKey ladder: the
``ATRIB_PRIVATE_KEY`` env var (base64url 32-byte seed) then
``ATRIB_KEY_FILE``. The macOS-Keychain and 1Password rungs are
platform/tool-coupled and intentionally not ported; hosts needing them
should resolve the seed themselves and pass it explicitly.

Per §5.8 rule 5, absence of a key is NOT an error: ``resolve_key`` returns
``None`` and callers operate in pass-through mode.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .encoding import base64url_decode


@dataclass(frozen=True)
class ResolvedKey:
    private_key: bytes  # 32-byte Ed25519 seed
    source: str  # 'env' | 'file'


def _decode_seed(value: str) -> bytes | None:
    try:
        seed = base64url_decode(value.strip())
    except ValueError:
        return None
    return seed if len(seed) == 32 else None


def resolve_key(env: Mapping[str, str] | None = None) -> ResolvedKey | None:
    """Resolve the signing key, or None (pass-through) when unavailable.
    Never raises (§5.8): malformed material degrades to None with a
    warning on stderr."""
    environment: Mapping[str, str] = os.environ if env is None else env

    env_value = environment.get("ATRIB_PRIVATE_KEY")
    if env_value:
        seed = _decode_seed(env_value)
        if seed is not None:
            return ResolvedKey(private_key=seed, source="env")
        _warn("ATRIB_PRIVATE_KEY is set but not a base64url 32-byte seed")

    key_file = environment.get("ATRIB_KEY_FILE")
    if key_file:
        try:
            content = Path(key_file).read_text(encoding="utf-8")
        except OSError as exc:
            _warn(f"ATRIB_KEY_FILE unreadable: {exc}")
            return None
        seed = _decode_seed(content)
        if seed is not None:
            return ResolvedKey(private_key=seed, source="file")
        _warn("ATRIB_KEY_FILE contents are not a base64url 32-byte seed")

    return None


def _warn(message: str) -> None:
    import sys

    print(f"atrib: {message}", file=sys.stderr)
