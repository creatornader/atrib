# SPDX-License-Identifier: Apache-2.0
"""Corpus-scoped mirror tail resolution (D146, §1.2.3.1 step 4).

The effective mirror file identifies a corpus: every ``*.jsonl`` in its
directory. Append order picks the tail within one file; across files the
greatest signed ``timestamp`` wins and equal timestamps break to the
lexicographically greater canonical record hash. Degradation follows §5.8:
malformed siblings are skipped, a missing corpus returns ``None``.
"""

from __future__ import annotations

import json
from pathlib import Path

from atrib import (
    mirror_corpus_tail_hash_hex,
    read_mirror_corpus_tail,
    record_hash_hex,
)

CONTEXT = "a" * 32
OTHER_CONTEXT = "b" * 32


def _record(timestamp: int, content_nibble: str, context_id: str = CONTEXT) -> dict:
    return {
        "spec_version": "atrib/1.0",
        "content_id": f"sha256:{content_nibble * 64}",
        "creator_key": "A" * 43,
        "chain_root": "sha256:" + "0" * 64,
        "event_type": "https://atrib.dev/v1/types/tool_call",
        "context_id": context_id,
        "timestamp": timestamp,
        "signature": "B" * 86,
    }


def _write(path: Path, records: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )


class TestCrossFileSelection:
    def test_newer_sibling_tail_wins(self, tmp_path: Path) -> None:
        _write(tmp_path / "producer-a.jsonl", [_record(1000, "1")])
        newer = _record(2000, "2")
        _write(tmp_path / "producer-b.jsonl", [newer])
        tail = read_mirror_corpus_tail(tmp_path / "producer-a.jsonl", CONTEXT)
        assert tail is not None
        assert record_hash_hex(tail) == record_hash_hex(newer)

    def test_append_order_selects_within_one_file(self, tmp_path: Path) -> None:
        # Within a file the LAST matching line is the tail even when an
        # earlier line carries a larger timestamp (append order is the
        # producer's signed claim of observation order).
        later_line = _record(1000, "3")
        _write(tmp_path / "only.jsonl", [_record(5000, "4"), later_line])
        tail = read_mirror_corpus_tail(tmp_path / "only.jsonl", CONTEXT)
        assert tail is not None
        assert record_hash_hex(tail) == record_hash_hex(later_line)

    def test_equal_timestamps_break_to_greater_canonical_hash(
        self, tmp_path: Path
    ) -> None:
        one = _record(1000, "5")
        two = _record(1000, "6")
        _write(tmp_path / "producer-a.jsonl", [one])
        _write(tmp_path / "producer-b.jsonl", [two])
        expected = max(record_hash_hex(one), record_hash_hex(two))
        tail = read_mirror_corpus_tail(tmp_path / "producer-a.jsonl", CONTEXT)
        assert tail is not None
        assert record_hash_hex(tail) == expected

    def test_other_context_records_are_ignored(self, tmp_path: Path) -> None:
        mine = _record(1000, "7")
        _write(tmp_path / "producer-a.jsonl", [mine])
        _write(
            tmp_path / "producer-b.jsonl",
            [_record(9000, "8", context_id=OTHER_CONTEXT)],
        )
        tail = read_mirror_corpus_tail(tmp_path / "producer-a.jsonl", CONTEXT)
        assert tail is not None
        assert record_hash_hex(tail) == record_hash_hex(mine)


class TestDegradation:
    def test_malformed_sibling_is_skipped(self, tmp_path: Path) -> None:
        mine = _record(1000, "9")
        _write(tmp_path / "producer-a.jsonl", [mine])
        (tmp_path / "broken.jsonl").write_bytes(b"\xff\xfenot json\n{half")
        tail = read_mirror_corpus_tail(tmp_path / "producer-a.jsonl", CONTEXT)
        assert tail is not None
        assert record_hash_hex(tail) == record_hash_hex(mine)

    def test_missing_corpus_returns_none(self, tmp_path: Path) -> None:
        missing = tmp_path / "nowhere" / "producer-a.jsonl"
        assert read_mirror_corpus_tail(missing, CONTEXT) is None
        assert mirror_corpus_tail_hash_hex(missing, CONTEXT) is None

    def test_hash_helper_matches_tail(self, tmp_path: Path) -> None:
        rec = _record(1000, "a")
        _write(tmp_path / "producer-a.jsonl", [rec])
        assert mirror_corpus_tail_hash_hex(
            tmp_path / "producer-a.jsonl", CONTEXT
        ) == record_hash_hex(rec)
