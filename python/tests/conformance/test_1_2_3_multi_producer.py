# SPDX-License-Identifier: Apache-2.0
"""Conformance tests for spec/conformance/1.2.3/multi-producer (§1.2.3.1, D067).

``resolve_chain_root`` is the Python port of the normative TypeScript
``resolveChainRoot`` (packages/mcp/src/chain-root.ts). This suite serializes
it against every case in the multi-producer corpus and asserts the resolved
``chain_root`` matches, covering the full precedence cascade:

    inbound > auto-chain > env-tail > mirror-tail > genesis

plus env-var malformation fall-through, env-var namespace isolation per
context_id, and the three D067 race vectors with conflicting tails.

Corpus JSON ``null`` values deserialize to Python ``None`` and are passed
straight through as the keyword arguments — absence of a signal IS ``None``.

One extra regression beyond the corpus: the JS reference regex
``/^sha256:[0-9a-f]{64}$/`` does NOT accept a trailing newline, while
Python's ``$`` would. The port must use ``\\Z`` so an env tail with a
trailing newline falls through instead of being accepted verbatim.

The corpus files are fixtures and are never modified.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from atrib import genesis_chain_root, mirror_corpus_tail_hash_hex, resolve_chain_root

CORPUS_DIR = (
    Path(__file__).resolve().parents[3]
    / "spec"
    / "conformance"
    / "1.2.3"
    / "multi-producer"
)

MANIFEST = json.loads((CORPUS_DIR / "manifest.json").read_text(encoding="utf-8"))

CASES = [
    json.loads((CORPUS_DIR / entry["file"]).read_text(encoding="utf-8"))
    for entry in MANIFEST["cases"]
]

EXPECTED_CASE_COUNT = 12

PRECEDENCE_LAYERS = frozenset(
    {"inbound", "auto-chain", "env-tail", "mirror-tail", "genesis"}
)


def _resolve(case: dict) -> str:
    """Two-part runner mirroring the TypeScript reference test.

    Pure precedence cases pass their inputs straight to
    ``resolve_chain_root`` (JSON ``null`` becomes ``None``). Cases carrying
    a ``mirror_corpus`` input are materialized into a temporary directory
    first; the corpus tail resolved by ``mirror_corpus_tail_hash_hex``
    (D146, §1.2.3.1 step 4) then feeds the same resolver, so the file
    boundary is covered too.
    """
    inp = case["input"]
    corpus = inp.get("mirror_corpus")
    if corpus is None:
        return resolve_chain_root(
            context_id=inp["context_id"],
            inbound_record_hash_hex=inp["inbound_record_hash_hex"],
            auto_chain_tail_hex=inp["auto_chain_tail_hex"],
            mirror_tail_hex=inp["mirror_tail_hex"],
            env=inp["env"],
        )
    with tempfile.TemporaryDirectory(prefix="atrib-conformance-mirror-") as tmp:
        root = Path(tmp)
        for file_entry in corpus["files"]:
            target = root / file_entry["file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                "".join(json.dumps(line) + "\n" for line in file_entry["lines"]),
                encoding="utf-8",
            )
        corpus_tail = mirror_corpus_tail_hash_hex(
            root / corpus["effective_file"], inp["context_id"]
        )
        return resolve_chain_root(
            context_id=inp["context_id"],
            inbound_record_hash_hex=inp["inbound_record_hash_hex"],
            auto_chain_tail_hex=inp["auto_chain_tail_hex"],
            mirror_tail_hex=corpus_tail,
            env=inp["env"],
        )


class TestCorpusIntegrity:
    """The manifest enumerates the whole on-disk corpus."""

    def test_manifest_lists_every_case(self) -> None:
        assert len(MANIFEST["cases"]) == EXPECTED_CASE_COUNT
        assert len(CASES) == EXPECTED_CASE_COUNT

    def test_manifest_matches_case_files_on_disk(self) -> None:
        on_disk = {p.name for p in (CORPUS_DIR / "cases").glob("*.json")}
        listed = {Path(entry["file"]).name for entry in MANIFEST["cases"]}
        assert listed == on_disk

    def test_every_case_declares_a_known_precedence_layer(self) -> None:
        for case in CASES:
            assert case["expected"]["precedence_layer"] in PRECEDENCE_LAYERS


class TestResolveChainRoot:
    """resolve_chain_root output matches expected.chain_root for every case."""

    @pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
    def test_case_resolves_to_expected_chain_root(self, case: dict) -> None:
        assert _resolve(case) == case["expected"]["chain_root"]


class TestGenesisParity:
    """Cases that fall through to genesis agree with genesis_chain_root."""

    GENESIS_CASES = [
        c for c in CASES if c["expected"]["precedence_layer"] == "genesis"
    ]

    def test_corpus_contains_genesis_fallback_case(self) -> None:
        assert any(c["name"] == "genesis-fallback" for c in self.GENESIS_CASES)

    @pytest.mark.parametrize(
        "case", GENESIS_CASES, ids=[c["name"] for c in GENESIS_CASES]
    )
    def test_expected_root_is_the_synthetic_genesis(self, case: dict) -> None:
        # §1.2.3 parity: the corpus-pinned chain_root for genesis-layer
        # cases must equal "sha256:" + hex(SHA-256(UTF-8(context_id))).
        context_id = case["input"]["context_id"]
        assert genesis_chain_root(context_id) == case["expected"]["chain_root"]
        assert _resolve(case) == genesis_chain_root(context_id)


class TestEnvTailTrailingNewlineRegression:
    """Regression: env tail with a trailing newline MUST fall through.

    The JS reference validates the env var with /^sha256:[0-9a-f]{64}$/;
    JS ``$`` (no multiline flag) rejects "sha256:<64-hex>\\n". Python's
    ``re`` treats ``$`` as also matching just before a final newline, so a
    naive port would accept the value verbatim. The port uses ``\\Z`` to
    keep JS semantics: the newline-suffixed value is malformed and the
    resolver falls through to the next layer.
    """

    CONTEXT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ENV_TAIL = (
        "sha256:"
        "3333333333333333333333333333333333333333333333333333333333333333"
    )
    MIRROR_TAIL = (
        "4444444444444444444444444444444444444444444444444444444444444444"
    )

    def test_trailing_newline_env_falls_through_to_mirror(self) -> None:
        resolved = resolve_chain_root(
            context_id=self.CONTEXT_ID,
            inbound_record_hash_hex=None,
            auto_chain_tail_hex=None,
            mirror_tail_hex=self.MIRROR_TAIL,
            env={f"ATRIB_CHAIN_TAIL_{self.CONTEXT_ID}": self.ENV_TAIL + "\n"},
        )
        assert resolved == f"sha256:{self.MIRROR_TAIL}"
        assert resolved != self.ENV_TAIL

    def test_trailing_newline_env_falls_through_to_genesis(self) -> None:
        # With no mirror tail either, the fall-through lands on genesis.
        resolved = resolve_chain_root(
            context_id=self.CONTEXT_ID,
            inbound_record_hash_hex=None,
            auto_chain_tail_hex=None,
            mirror_tail_hex=None,
            env={f"ATRIB_CHAIN_TAIL_{self.CONTEXT_ID}": self.ENV_TAIL + "\n"},
        )
        assert resolved == genesis_chain_root(self.CONTEXT_ID)

    def test_same_value_without_newline_is_accepted(self) -> None:
        # Control: the identical env value minus the newline IS well-formed
        # and wins over the mirror tail (env-tail layer).
        resolved = resolve_chain_root(
            context_id=self.CONTEXT_ID,
            inbound_record_hash_hex=None,
            auto_chain_tail_hex=None,
            mirror_tail_hex=self.MIRROR_TAIL,
            env={f"ATRIB_CHAIN_TAIL_{self.CONTEXT_ID}": self.ENV_TAIL},
        )
        assert resolved == self.ENV_TAIL
