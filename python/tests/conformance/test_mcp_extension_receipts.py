# SPDX-License-Identifier: Apache-2.0
"""D141 receipt-side conformance (Python parity with the TS SDK test):
runs spec/conformance/mcp-extension/cases/receipt--*.json through
parse_attribution_receipt_block and check_attribution_receipt_consistency.
Ladder cases in the same corpus target the protocol packages (tranche 2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from atrib import AtribRecord
from atrib.attribution import (
    ATTRIBUTION_EXTENSION_KEY,
    check_attribution_receipt_consistency,
    parse_attribution_receipt_block,
)

CASES = Path(__file__).resolve().parents[3] / "spec" / "conformance" / "mcp-extension" / "cases"


def _load(name: str) -> dict[str, object]:
    return cast(dict[str, object], json.loads((CASES / name).read_text(encoding="utf-8")))


def _block_and_record(case: dict[str, object]):
    case_input = cast(dict[str, object], case["input"])
    meta = {ATTRIBUTION_EXTENSION_KEY: case_input["result_block"]}
    block = parse_attribution_receipt_block(meta)
    assert block is not None
    record = cast(AtribRecord | None, case_input.get("record"))
    return block, record


def test_receipt_consistent() -> None:
    case = _load("receipt--consistent.json")
    expected = cast(dict[str, object], case["expected"])
    block, record = _block_and_record(case)
    outcome = check_attribution_receipt_consistency(block, record)
    assert outcome.receipt_valid is expected["receipt_valid"]
    assert outcome.mismatched_fields == []
    if "token" in expected:
        assert block.token == expected["token"]
    if "record_hash" in expected:
        assert outcome.attached_record_hash == expected["record_hash"]


def test_receipt_hash_mismatch_flagged() -> None:
    case = _load("receipt--hash-mismatch-flagged.json")
    expected = cast(dict[str, object], case["expected"])
    block, record = _block_and_record(case)
    outcome = check_attribution_receipt_consistency(block, record)
    assert outcome.receipt_valid is False
    for fld in cast(list[str], expected.get("mismatched_fields", [])):
        assert fld in outcome.mismatched_fields
    if "claimed_record_hash" in expected:
        assert outcome.claimed_record_hash == expected["claimed_record_hash"]
    if "attached_record_hash" in expected:
        assert outcome.attached_record_hash == expected["attached_record_hash"]
    # Advisory contract: a bad receipt never invalidates the tool result.
    assert expected["tool_result_invalidated"] is False


def test_receipt_log_submission_nonblocking() -> None:
    case = _load("receipt--log-submission-nonblocking.json")
    expected = cast(dict[str, object], case["expected"])
    block, record = _block_and_record(case)
    assert block.receipt is not None
    assert block.receipt["log_submission"] == expected["log_submission"]
    assert block.receipt["log_submission"] in cast(list[str], expected["allowed_statuses"])
    assert expected["proof_bundle_required"] is False
    # This case ships no record body anywhere (expected receipt_valid refers
    # to shape/status validity). The record-consistency checker is
    # deliberately conservative without a record: nothing to check against.
    assert record is None
    outcome = check_attribution_receipt_consistency(block, record)
    assert outcome.receipt_valid is False
    assert outcome.mismatched_fields == ["record"]


def test_parse_hostile_blocks_never_raise() -> None:
    assert parse_attribution_receipt_block(None) is None
    assert parse_attribution_receipt_block(42) is None
    assert parse_attribution_receipt_block({ATTRIBUTION_EXTENSION_KEY: 42}) is None
    assert (
        parse_attribution_receipt_block(
            {ATTRIBUTION_EXTENSION_KEY: {"receipt": {"record_hash": 123}}}
        )
        is None
    )
    block = parse_attribution_receipt_block(
        {ATTRIBUTION_EXTENSION_KEY: {"token": "a.b", "receipt": [], "record": []}}
    )
    assert block is not None and block.token == "a.b"
    assert block.receipt is None and block.record is None
