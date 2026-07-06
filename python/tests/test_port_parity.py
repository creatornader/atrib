# SPDX-License-Identifier: Apache-2.0
"""Cross-implementation parity regressions from the adversarial verification
pass (2026-07-06). Expected values were captured from the TypeScript
reference implementation (@atrib/mcp via @atrib/sdk dist) on identical
inputs. If one of these breaks, either a port regressed or the TS reference
changed — investigate before touching the expectation.
"""

from __future__ import annotations

import pytest
import rfc8785

from atrib import (
    is_valid_event_type_uri,
    normalize_server_url,
    validate_submission,
    verify_record,
)
from atrib.canon import jcs

REFERENCE_NOW_MS = 1767225600000


# ── normalize_server_url: WHATWG parity (fixed divergences) ──────────────


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        # IPv6 hosts keep brackets; host lowercases; default port drops.
        ("https://[::1]:8080/x", "https://[::1]:8080/x"),
        ("https://[2001:DB8::1]:443/x", "https://[2001:db8::1]/x"),
        # Non-special scheme without '//': opaque path becomes the tail.
        ("mcp:atrib", "mcp://atrib"),
        # Special schemes collapse any run of slashes after the colon.
        ("https:/x", "https://x"),
        ("https:x", "https://x"),
        # WHATWG strips leading/trailing C0 controls and spaces.
        ("https://x.com/a ", "https://x.com/a"),
        (" https://x.com/a", "https://x.com/a"),
        # Opaque (non-special) hosts preserve case; scheme still lowercases.
        ("mcp://ATRIB-Emit", "mcp://ATRIB-Emit"),
        ("MCP://Upper:9/P/", "mcp://Upper:9/P"),
        # Previously-agreeing cases stay pinned.
        ("https://x.com:443", "https://x.com"),
        ("http://x.com:80", "http://x.com"),
        ("ws://x:80", "ws://x"),
        ("wss://x:443", "wss://x"),
        ("https://x.com:8443/a/", "https://x.com:8443/a"),
        ("HTTPS://X.COM/Path", "https://x.com/Path"),
        ("https://x.com/a?q=1#f", "https://x.com/a"),
        ("mcp://atrib-emit", "mcp://atrib-emit"),
        ("mcp://x:80", "mcp://x:80"),
        ("https://user:pass@x.com/p", "https://x.com/p"),
    ],
)
def test_normalize_server_url_matches_ts(url: str, expected: str) -> None:
    assert normalize_server_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        # WHATWG throws on these; the TS side falls back to raw lowercase.
        "",
        "not a url",
        "https://",
    ],
)
def test_normalize_server_url_fallback_lowercases_raw(url: str) -> None:
    assert normalize_server_url(url) == url.lower()


# ── is_valid_event_type_uri: UTF-16 length parity ────────────────────────


def test_event_type_length_counts_utf16_units() -> None:
    # 128 astral chars = 130 code points but 258 UTF-16 units -> invalid,
    # matching the JS reference's value.length check.
    astral = "a:" + "\U0001d54f" * 128
    assert is_valid_event_type_uri(astral) is False
    # 127 astral chars = 256 UTF-16 units -> valid.
    assert is_valid_event_type_uri("a:" + "\U0001d54f" * 127) is True
    # Plain BMP boundary stays at 256/257 characters.
    assert is_valid_event_type_uri("a:" + "b" * 254) is True
    assert is_valid_event_type_uri("a:" + "b" * 255) is False


# ── timestamps: integral floats accepted like JS Number.isInteger ────────


def _record_with_timestamp(timestamp: object) -> dict[str, object]:
    return {
        "spec_version": "atrib/1.0",
        "content_id": "sha256:" + "ab" * 32,
        "creator_key": "0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc",
        "chain_root": "sha256:" + "cd" * 32,
        "event_type": "https://atrib.dev/v1/types/observation",
        "context_id": "a" * 32,
        "timestamp": timestamp,
        "signature": "x" * 86,
    }


def test_validate_submission_accepts_integral_float_timestamp() -> None:
    assert validate_submission(
        _record_with_timestamp(1767225600000.0), now_ms=REFERENCE_NOW_MS
    ).ok
    assert not validate_submission(
        _record_with_timestamp(1767225600000.5), now_ms=REFERENCE_NOW_MS
    ).ok
    assert not validate_submission(
        _record_with_timestamp(True), now_ms=REFERENCE_NOW_MS
    ).ok
    assert not validate_submission(
        _record_with_timestamp("1767225600000"), now_ms=REFERENCE_NOW_MS
    ).ok


def test_verify_record_timestamp_type_parity() -> None:
    # Signature is bogus so verification fails regardless; these assert the
    # timestamp guard raises nothing and treats the types like the JS side.
    assert verify_record(_record_with_timestamp(True), now_ms=REFERENCE_NOW_MS) is False
    assert (
        verify_record(_record_with_timestamp(1767225600000.5), now_ms=REFERENCE_NOW_MS)
        is False
    )


# ── JCS: documented non-I-JSON boundary (rejection contract) ─────────────


def test_jcs_rejects_integers_beyond_float_domain() -> None:
    with pytest.raises(ValueError):
        jcs({"k": 9007199254740992})  # 2^53
    with pytest.raises(ValueError):
        jcs({"k": 9007199254740993})  # 2^53 + 1
    # 2^53 - 1 is the I-JSON boundary and must serialize.
    assert jcs({"k": 9007199254740991}) == b'{"k":9007199254740991}'


def test_jcs_rejects_lone_surrogates_consistently() -> None:
    # Value position: rfc8785's own CanonicalizationError.
    with pytest.raises(rfc8785.CanonicalizationError):
        jcs({"k": "\ud800"})
    # Key position: normalized to the SAME error class (raw codec errors
    # from the sort key must not leak).
    with pytest.raises(rfc8785.CanonicalizationError):
        jcs({"\ud800": 1})


# ── §5.8 degradation regressions (adversarial pass, 2026-07-06) ──────────


def test_read_mirror_skips_invalid_utf8_lines(tmp_path) -> None:
    from atrib import read_mirror, sign_record
    import json

    path = tmp_path / "mirror.jsonl"
    good = sign_record(_record_with_timestamp(REFERENCE_NOW_MS), bytes.fromhex("11" * 32))
    with path.open("wb") as handle:
        handle.write(b"\x00\xff\xfe garbage \x80\x81\x82\n")
        handle.write(json.dumps({"record": good}).encode("utf-8") + b"\n")
        handle.write(b"\xff\xff\n")
    lines = read_mirror(path)
    assert len(lines) == 1
    assert lines[0].record["context_id"] == "a" * 32


def test_client_tolerates_binary_mirror(tmp_path) -> None:
    from atrib import AtribClient

    mirror = tmp_path / "m.jsonl"
    mirror.write_bytes(b"\xff\xfe binary\n")
    client = AtribClient(
        key=None,
        mirror_read_path=mirror,
        mirror_write_path=mirror,
        env={},
    )
    outcome = client.recall(shape="history")
    assert outcome.via == "in-process"
    result = client.attest({"what": "x"})  # pass-through (no key), no raise
    assert result.via == "none"


def test_resolve_anchor_set_hostile_entries_never_raise() -> None:
    from atrib.client import _resolve_anchor_set

    endpoint, warnings = _resolve_anchor_set(
        [None, 42, {"endpoint": 5}, "not a url", {"endpoint": "http://x/v1/entries", "anchor_type": []}, "http://ok/v1/entries"]  # type: ignore[list-item]
    )
    assert endpoint == "http://ok/v1/entries"
    assert len(warnings) == 5


def test_anchor_type_none_present_skips_like_ts_null() -> None:
    from atrib.client import _resolve_anchor_set

    # JSON null → TS warn-and-skip; Python None-present must match.
    endpoint, warnings = _resolve_anchor_set(
        [{"endpoint": "http://x/v1/entries", "anchor_type": None}]
    )
    assert endpoint is None
    assert len(warnings) == 1
