# SPDX-License-Identifier: Apache-2.0
"""Cross-implementation determinism judge (the byte-identity harness).

Deterministically generates ~60 emit-record cases (seeded RNG), feeds them to
the TypeScript judge script (packages/sdk/scripts/cross-impl-vectors.mjs,
which assembles + signs records exactly like @atrib/emit's
buildAndSignEmitRecord via the built @atrib/sdk), builds the same records
through ``atrib.build_and_sign_emit_record``, and asserts byte identity:

  - the full signed record (dict equality),
  - the §1.4.2 canonical signing input bytes (compared as base64),
  - the §1.2.3 record_hash_hex over the complete signed record,
  - the §1.5.2 propagation token,
  - the §1.2.6 derived provenance_token.

The case mix deliberately targets the classic cross-impl JCS failure modes:
UTF-16 code-unit vs code-point key ordering (keys like U+FF10 vs U+1D11E),
astral-plane emoji, combining marks, control characters, ECMAScript number
serialization (1e21, 1e-7, -0.0, 5e-324, 0.1+0.2, integer-valued floats),
nulls, empty content, nested structures, and informed_by sort order.

A failure here means a verifier COULD tell which implementation signed a
record — the exact property the Python port promises to rule out.
"""

from __future__ import annotations

import base64
import json
import random
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

import atrib

REPO_ROOT = Path(__file__).resolve().parents[3]
SDK_DIR = REPO_ROOT / "packages" / "sdk"
JUDGE_SCRIPT = SDK_DIR / "scripts" / "cross-impl-vectors.mjs"
SDK_DIST = SDK_DIR / "dist" / "index.js"

RNG_SEED = 20260706
CASE_COUNT = 60

OBSERVATION = atrib.EVENT_TYPE_OBSERVATION_URI
ANNOTATION = atrib.EVENT_TYPE_ANNOTATION_URI
REVISION = atrib.EVENT_TYPE_REVISION_URI
EVENT_TYPE_CYCLE = [
    OBSERVATION,
    ANNOTATION,
    REVISION,
    # Extension URIs: leaf-of-URI content_id derivation must agree too.
    "https://example.com/v1/types/custom-metric",  # leaf = "custom-metric"
    "urn:example:custom-event",  # slash-less: leaf == whole URI
    "https://example.com/types/trailing/",  # trailing slash: leaf == whole URI
]

# Fixed content payloads covering THE known cross-impl JCS battlegrounds.
SPECIAL_CONTENTS: list[dict[str, Any]] = [
    # empty content object
    {},
    # UTF-16 code-unit vs code-point key ordering. U+1D11E (astral, surrogate
    # pair D834 DD1E — first unit 0xD834) must sort BEFORE U+FF10 (0xFF10) in
    # JCS order even though its code point (0x1D11E > 0xFF10) is larger.
    # A code-point-sorting implementation gets this backwards.
    {"０": "fullwidth zero", "\U0001d11e": "astral g-clef", "ascii": "plain"},
    # more keys straddling the surrogate range boundary
    {
        "\U0001f600": "grinning face",
        "￿": "bmp max",
        "퟿": "just before surrogates",
        "": "private use",
    },
    # combining mark vs precomposed — JCS does NOT normalize; distinct keys
    {"é": "combining acute", "é": "precomposed e-acute"},
    # control characters and the short-escape set in a string value
    {"ctrl": "\u0000\u0001\u001f\b\t\n\f\r\"\\/"},
    # ECMAScript number serialization gauntlet (content values only)
    {
        "numbers": [
            3.14,
            1e21,
            1e-7,
            -0.0,
            0.1 + 0.2,
            9007199254740991,
            -9007199254740991,
            0,
            -1,
            5e-324,
            1.7976931348623157e308,
            1e-300,
        ]
    },
    # nested structures with mixed-case keys ("A" < "a" in UTF-16 order)
    {
        "nested": {"z": [[]], "a": [1, {"b": None}], "A": {"empty": {}}},
        "arr": [[[{"deep": [None, True, False]}]]],
    },
    # literals and empties
    {"null": None, "true": True, "false": False, "empty_list": [], "empty_obj": {}},
    # unicode inside arrays + astral/battle keys in a nested object + escaped key
    {
        "mixed": ["\U0001f984", "é̂", {"０": 1, "\U0001d11e": 2}],
        "tab\tkey": "escaped key",
    },
    # integer-valued float (10.0 must serialize as "10") and float dust
    {"float": 0.30000000000000004, "int_like": 10.0, "neg_zero": -0.0, "tiny": 1e-7},
]

STRING_POOL = [
    "plain ascii",
    "héllo wörld",
    "日本語テキスト",
    "🎉🎊\U0001d11e",
    "line\nbreak\ttab",
    'quote"back\\slash',
    "é combining",
    "   line separators",
    "",
]

KEY_POOL = [
    "a",
    "A",
    "z",
    "Z",
    "_",
    "0",
    "０",
    "\U0001d11e",
    "é",
    "key with space",
    "🔑",
]

FLOAT_POOL = [3.14, 1e21, 1e-7, -0.0, 0.1 + 0.2, 5e-324, 1.7976931348623157e308]


def _hex_bytes(rng: random.Random, n: int) -> str:
    return bytes(rng.getrandbits(8) for _ in range(n)).hex()


def _sha_ref(rng: random.Random) -> str:
    return "sha256:" + _hex_bytes(rng, 32)


def _rand_value(rng: random.Random, depth: int) -> Any:
    kinds = ["str", "int", "float", "bool", "null"]
    if depth < 2:
        kinds += ["list", "dict"]
    kind = rng.choice(kinds)
    if kind == "str":
        return rng.choice(STRING_POOL)
    if kind == "int":
        return rng.randrange(-(2**53) + 1, 2**53)
    if kind == "float":
        return rng.choice([rng.random(), rng.random() * 1e9, rng.choice(FLOAT_POOL)])
    if kind == "bool":
        return rng.choice([True, False])
    if kind == "null":
        return None
    if kind == "list":
        return [_rand_value(rng, depth + 1) for _ in range(rng.randrange(0, 4))]
    keys = rng.sample(KEY_POOL, rng.randrange(1, 5))
    return {key: _rand_value(rng, depth + 1) for key in keys}


def _rand_content(rng: random.Random) -> dict[str, Any]:
    keys = rng.sample(KEY_POOL, rng.randrange(1, 6))
    return {key: _rand_value(rng, 0) for key in keys}


def generate_cases() -> list[dict[str, Any]]:
    """Deterministic case generation — every RNG draw happens in a fixed
    order so both pytest collection and the judge fixture see identical
    cases without sharing state."""
    rng = random.Random(RNG_SEED)
    cases: list[dict[str, Any]] = []
    for i in range(CASE_COUNT):
        event_type = EVENT_TYPE_CYCLE[i % len(EVENT_TYPE_CYCLE)]
        if i % 2 == 0:
            content = SPECIAL_CONTENTS[(i // 2) % len(SPECIAL_CONTENTS)]
        else:
            content = _rand_content(rng)

        case: dict[str, Any] = {
            "seed_hex": _hex_bytes(rng, 32),
            "event_type": event_type,
            "context_id": _hex_bytes(rng, 16),
            "content": content,
            "timestamp_ms": rng.randrange(1_500_000_000_000, 1_800_000_000_000),
        }

        # chain_root: 1/3 genesis (omitted — both sides derive it), else a ref
        if rng.random() < 1 / 3:
            # provenance_token only rides on genesis records (§1.2.6)
            if rng.random() < 0.5:
                case["provenance_token"] = atrib.base64url_encode(
                    bytes(rng.getrandbits(8) for _ in range(16))
                )
        else:
            case["chain_root"] = _sha_ref(rng)

        # informed_by: absent / empty (both sides must omit) / shuffled refs
        roll = rng.random()
        if roll < 0.2:
            case["informed_by"] = []
        elif roll < 0.6:
            refs = [_sha_ref(rng) for _ in range(rng.randrange(1, 5))]
            rng.shuffle(refs)
            case["informed_by"] = refs

        if event_type == ANNOTATION:
            case["annotates"] = _sha_ref(rng)
        if event_type == REVISION:
            case["revises"] = _sha_ref(rng)
        if rng.random() < 0.4:
            case["tool_name"] = rng.choice(
                ["atrib-emit", "wërkzeug🛠", "search/web", "tool.name-1"]
            )
        if rng.random() < 0.25:
            case["args_hash"] = _sha_ref(rng)
        if rng.random() < 0.25:
            case["result_hash"] = _sha_ref(rng)

        cases.append(case)
    return cases


CASES = generate_cases()


def build_python_record(case: dict[str, Any]) -> dict[str, Any]:
    chain_root = case.get("chain_root") or atrib.genesis_chain_root(case["context_id"])
    return dict(
        atrib.build_and_sign_emit_record(
            private_key=bytes.fromhex(case["seed_hex"]),
            event_type=case["event_type"],
            context_id=case["context_id"],
            chain_root=chain_root,
            content=case["content"],
            informed_by=case.get("informed_by"),
            provenance_token=case.get("provenance_token"),
            annotates=case.get("annotates"),
            revises=case.get("revises"),
            tool_name=case.get("tool_name"),
            args_hash=case.get("args_hash"),
            result_hash=case.get("result_hash"),
            timestamp_ms=case["timestamp_ms"],
        )
    )


@pytest.fixture(scope="module")
def ts_results(tmp_path_factory: pytest.TempPathFactory) -> list[dict[str, Any]]:
    """Run the TypeScript judge once over the full case file."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available on PATH")
    if not SDK_DIST.is_file():
        pytest.skip("packages/sdk/dist missing — build @atrib/sdk first")
    if not JUDGE_SCRIPT.is_file():
        pytest.skip(f"judge script missing at {JUDGE_SCRIPT}")

    cases_path = tmp_path_factory.mktemp("cross-impl") / "cases.json"
    cases_path.write_text(
        json.dumps({"cases": CASES}, ensure_ascii=False), encoding="utf-8"
    )
    proc = subprocess.run(
        [node, str(JUDGE_SCRIPT), str(cases_path)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert proc.returncode == 0, f"TypeScript judge failed:\n{proc.stderr}"
    results = json.loads(proc.stdout)["results"]
    assert len(results) == len(CASES), "judge returned wrong number of results"
    return results


def _case_id(i: int) -> str:
    leaf = atrib.leaf_of_event_type_uri(CASES[i]["event_type"])
    return f"case{i:02d}-{'ext' if leaf == CASES[i]['event_type'] else leaf[:12]}"


@pytest.mark.parametrize("idx", range(len(CASES)), ids=_case_id)
def test_byte_identity(ts_results: list[dict[str, Any]], idx: int) -> None:
    case = CASES[idx]
    ts = ts_results[idx]
    record = build_python_record(case)

    # Full signed record identity — same fields, same presence/absence of
    # optional fields, same deterministic Ed25519 signature.
    assert record == ts["record"], (
        f"signed record diverged for case {idx} (event_type={case['event_type']})"
    )

    # §1.4.2 canonical signing input bytes (JCS minus signature).
    py_signing_b64 = base64.b64encode(atrib.canonical_signing_input(record)).decode(
        "ascii"
    )
    assert py_signing_b64 == ts["canonical_signing_input_b64"], (
        f"canonical signing input bytes diverged for case {idx}"
    )

    # §1.2.3 record hash over the COMPLETE signed record.
    assert atrib.record_hash_hex(record) == ts["record_hash_hex"]

    # §1.5.2 propagation token.
    assert atrib.encode_token(record) == ts["token"]

    # §1.2.6 provenance token a downstream genesis record would derive.
    assert atrib.derive_provenance_token(record) == ts["derived_provenance_token"]


def test_all_python_records_verify() -> None:
    """Sanity: every generated record passes §1.4.3 verification in Python,
    so byte identity above is being asserted over VALID records, not over
    two implementations agreeing on garbage. Generated timestamps run up to
    1.8e12 ms (Jan 2027), which can be >5min in the wall-clock future, so
    the clock is injected per the corpus convention (step 7 checks the
    timestamp against now_ms, not wall time)."""
    for idx, case in enumerate(CASES):
        record = build_python_record(case)
        assert atrib.verify_record(record, now_ms=case["timestamp_ms"]) is True, (
            f"python-built record failed §1.4.3 verification for case {idx}"
        )


def test_case_mix_covers_target_surface() -> None:
    """Guard the generator itself: the deterministic mix must keep covering
    the battleground inputs (if someone edits the generator, this fails
    rather than silently weakening the judge)."""
    event_types = {c["event_type"] for c in CASES}
    assert set(EVENT_TYPE_CYCLE) <= event_types
    assert any(c["content"] == {} for c in CASES)
    assert any("０" in c["content"] for c in CASES)  # UTF-16 sort battle key
    assert any("\U0001d11e" in c["content"] for c in CASES)
    assert any(c.get("informed_by") == [] for c in CASES)
    assert any(len(c.get("informed_by") or []) > 1 for c in CASES)
    assert any("provenance_token" in c for c in CASES)
    assert any("chain_root" not in c for c in CASES)  # genesis derivation path
    assert any("args_hash" in c for c in CASES)
    assert any("result_hash" in c for c in CASES)
    assert any("tool_name" in c for c in CASES)
