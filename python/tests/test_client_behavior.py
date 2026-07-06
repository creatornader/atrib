# SPDX-License-Identifier: Apache-2.0
"""Behavioral tests for AtribClient, the mirror layer, and the degradation
contract (§5.8, §5.9, §1.5.1).

Covers the client verbs end to end against tmp_path mirrors and explicit
``env`` dicts (``os.environ`` is never mutated or consulted):

- attest → mirror roundtrip: signed record lands as a Shape-1 envelope with
  the ``atrib-sdk-py`` producer sidecar and verifies per §1.4.3.
- chain continuity: mirror-tail inheritance links the second record's
  ``chain_root`` to the first record's hash (§1.2.3.1 layer 4).
- ref → event_type mapping (``revises``/``annotates``), including the
  contradictory-input raise paths (the ONLY raise paths per §5.8).
- pass-through mode when no key resolves (§5.8 rule 5): via='none',
  warning, no raise, no mirror write.
- recall shapes: 'history' newest-first with signature verification and
  event_type/context filters; 'session_chain' context scoping; unknown
  shapes degrade with a warning outcome.
- parse_mirror_line tolerates all three §5.9.2 line shapes, skips
  malformed lines, and accepts transaction records carrying ``signers[]``
  with no top-level ``signature``.
- resolve_key ladder (§5.6): env beats file, malformed env degrades to the
  next rung without raising, ATRIB_KEY_FILE works standalone.
- fresh-orphan (§1.5.1): with no context from any source, attest
  synthesizes a fresh 32-hex context_id and MUST NOT inherit the mirror
  tail's context.

The anchor endpoint is a dead local port: submission is fire-and-forget in
a background thread and per §5.3.5/§5.8 its failure must never surface.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from atrib import (
    EVENT_TYPE_OBSERVATION_URI,
    EVENT_TYPE_REVISION_URI,
    EVENT_TYPE_TOOL_CALL_URI,
    EVENT_TYPE_TRANSACTION_URI,
    SPEC_VERSION,
    AtribClient,
    AttestRef,
    AttestResult,
    RecallOutcome,
    base64url_encode,
    build_and_sign_emit_record,
    genesis_chain_root,
    get_public_key,
    parse_mirror_line,
    read_mirror,
    record_hash_ref,
    resolve_key,
    verify_record,
)

SEED = bytes(range(32))
SEED_B64URL = base64url_encode(SEED)
OTHER_SEED = bytes(range(32, 64))
OTHER_SEED_B64URL = base64url_encode(OTHER_SEED)

# Nothing listens on port 9; submission failures stay in the background
# worker per the degradation contract and never affect these assertions.
DEAD_ANCHOR = "http://127.0.0.1:9/v1/entries"

CONTEXT_A = "a" * 32
CONTEXT_B = "b" * 32

RECORD_HASH_REF_RE = re.compile(r"^sha256:[0-9a-f]{64}\Z")
CONTEXT_ID_RE = re.compile(r"^[0-9a-f]{32}\Z")

FIXED_TIMESTAMP_MS = 1_767_225_600_000  # 2026-01-01T00:00:00Z


def make_client(tmp_path: Path, **overrides: object) -> AtribClient:
    """Client wired to tmp_path mirrors with an explicit env dict."""
    kwargs: dict[str, object] = {
        "context_id": CONTEXT_A,
        "anchors": [DEAD_ANCHOR],
        "mirror_write_path": tmp_path / "write.jsonl",
        "mirror_read_path": tmp_path / "read.jsonl",
        "env": {"ATRIB_PRIVATE_KEY": SEED_B64URL},
    }
    kwargs.update(overrides)
    return AtribClient(**kwargs)  # type: ignore[arg-type]


def recall_records(outcome: RecallOutcome) -> list[dict[str, object]]:
    data = outcome.data
    assert isinstance(data, dict), f"recall data should be a dict, got {type(data)}"
    records = data["records"]
    assert isinstance(records, list)
    assert data["returned"] == len(records)
    return records


def signed_fixture_record(
    context_id: str = CONTEXT_A,
    event_type: str = EVENT_TYPE_OBSERVATION_URI,
) -> dict[str, object]:
    return dict(
        build_and_sign_emit_record(
            private_key=SEED,
            event_type=event_type,
            context_id=context_id,
            chain_root=genesis_chain_root(context_id),
            content={"k": "v"},
            timestamp_ms=FIXED_TIMESTAMP_MS,
        )
    )


# ── 1. attest → mirror roundtrip ─────────────────────────────────────────


class TestAttestMirrorRoundtrip:
    def test_attest_returns_in_process_record_hash(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        result = client.attest({"what": "x"})
        assert isinstance(result, AttestResult)
        assert result.via == "in-process"
        assert result.context_id == CONTEXT_A
        assert result.record_hash is not None
        assert RECORD_HASH_REF_RE.match(result.record_hash)

    def test_mirror_line_is_envelope_with_producer_sidecar(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        result = client.attest({"what": "x"})

        raw_lines = (tmp_path / "write.jsonl").read_text(encoding="utf-8").splitlines()
        assert len(raw_lines) == 1

        parsed = parse_mirror_line(raw_lines[0])
        assert parsed is not None
        assert parsed.sidecar is not None, "attest must write a Shape-1 envelope"
        assert parsed.sidecar["producer"] == "atrib-sdk-py"
        assert parsed.sidecar["content"] == {"what": "x"}

        # The sidecar lives at envelope level, never inside the record.
        assert "_local" not in parsed.record

        # Roundtrip: the mirrored record IS the record the client hashed.
        assert record_hash_ref(parsed.record) == result.record_hash
        assert parsed.record["context_id"] == CONTEXT_A
        assert parsed.record["event_type"] == EVENT_TYPE_OBSERVATION_URI
        assert verify_record(parsed.record) is True


# ── 2. chain continuity via mirror-tail inheritance ──────────────────────


class TestChainContinuity:
    def test_second_attest_chains_to_first(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        first = client.attest({"step": 1})
        second = client.attest({"step": 2})
        assert second.via == "in-process"

        lines = read_mirror(tmp_path / "write.jsonl")
        assert len(lines) == 2
        # Genesis first, then the mirror tail becomes the parent.
        assert lines[0].record["chain_root"] == genesis_chain_root(CONTEXT_A)
        assert lines[1].record["chain_root"] == first.record_hash
        assert record_hash_ref(lines[1].record) == second.record_hash


# ── 3. ref → event_type mapping ──────────────────────────────────────────


class TestAttestRefMapping:
    def test_revises_ref_sets_field_and_revision_event_type(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        first = client.attest({"claim": "v1"})
        assert first.record_hash is not None

        revised = client.attest(
            {"claim": "v2"},
            ref=AttestRef(kind="revises", record_hash=first.record_hash),
        )
        assert revised.via == "in-process"

        tail = read_mirror(tmp_path / "write.jsonl")[-1].record
        assert tail["event_type"] == EVENT_TYPE_REVISION_URI
        assert tail["revises"] == first.record_hash
        assert "annotates" not in tail
        assert verify_record(tail) is True

    def test_ref_kind_contradicting_explicit_event_type_raises(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        first = client.attest({"claim": "v1"})
        assert first.record_hash is not None
        with pytest.raises(ValueError):
            client.attest(
                {"claim": "v2"},
                event_type="observation",
                ref=AttestRef(kind="revises", record_hash=first.record_hash),
            )

    def test_annotation_event_type_without_ref_raises(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        with pytest.raises(ValueError):
            client.attest({"note": "important"}, event_type="annotation")


# ── 4. pass-through mode (§5.8 rule 5) ───────────────────────────────────


class TestPassThrough:
    def test_explicit_none_key_degrades_without_raising(self, tmp_path: Path) -> None:
        client = make_client(tmp_path, key=None, env={})
        result = client.attest({"what": "x"})
        assert result.via == "none"
        assert result.record_hash is None
        assert result.context_id is None
        assert any("pass-through" in warning for warning in result.warnings)
        # Pass-through emits nothing: no mirror file appears.
        assert not (tmp_path / "write.jsonl").exists()


# ── 5. recall shapes ─────────────────────────────────────────────────────


class TestRecall:
    def test_history_newest_first_with_verified_signatures(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        first = client.attest({"n": 1})
        second = client.attest({"n": 2}, event_type="tool_call", tool_name="grep")

        outcome = client.recall(shape="history")
        assert outcome.via == "in-process"
        assert outcome.warnings == []
        records = recall_records(outcome)
        assert [entry["record_hash"] for entry in records] == [
            second.record_hash,
            first.record_hash,
        ]
        assert all(entry["signature_verified"] is True for entry in records)
        # The producer sidecar content is surfaced back through recall.
        assert records[0]["local_content"] == {"n": 2}

    def test_history_event_type_filter_normalizes_short_alias(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        client.attest({"n": 1})
        tool = client.attest({"n": 2}, event_type="tool_call", tool_name="grep")

        outcome = client.recall(shape="history", event_type="tool_call")
        records = recall_records(outcome)
        assert [entry["record_hash"] for entry in records] == [tool.record_hash]
        assert records[0]["event_type"] == EVENT_TYPE_TOOL_CALL_URI

    def test_history_context_filter(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        client.attest({"n": 1})
        other = client.attest({"n": 2}, context_id=CONTEXT_B)

        outcome = client.recall(shape="history", context_id=CONTEXT_B)
        records = recall_records(outcome)
        assert [entry["record_hash"] for entry in records] == [other.record_hash]
        assert records[0]["context_id"] == CONTEXT_B

    def test_unknown_shape_degrades_with_warning(self, tmp_path: Path) -> None:
        client = make_client(tmp_path)
        client.attest({"n": 1})
        outcome = client.recall(shape="semantic")
        assert outcome.via == "none"
        assert outcome.shape == "semantic"
        assert outcome.data is None
        assert len(outcome.warnings) == 1
        assert "semantic" in outcome.warnings[0]

    def test_session_chain_scopes_to_client_context_and_accepts_filter(
        self, tmp_path: Path
    ) -> None:
        client = make_client(tmp_path)
        mine = client.attest({"n": 1})
        other = client.attest({"n": 2}, context_id=CONTEXT_B)

        default_scope = client.recall(shape="session_chain")
        assert default_scope.via == "in-process"
        assert [entry["record_hash"] for entry in recall_records(default_scope)] == [
            mine.record_hash
        ]

        explicit_scope = client.recall(shape="session_chain", context_id=CONTEXT_B)
        assert [entry["record_hash"] for entry in recall_records(explicit_scope)] == [
            other.record_hash
        ]


# ── 6. §5.9.2 mirror line shapes ─────────────────────────────────────────


class TestParseMirrorLineShapes:
    def test_shape_1_envelope_with_local_sidecar(self) -> None:
        record = signed_fixture_record()
        sidecar = {"producer": "test-producer", "content": {"k": "v"}}
        line = json.dumps({"record": record, "_local": sidecar, "written_at": 17})
        parsed = parse_mirror_line(line)
        assert parsed is not None
        assert parsed.record == record
        assert parsed.sidecar == sidecar
        assert parsed.written_at == 17

    def test_shape_2_envelope_without_sidecar(self) -> None:
        record = signed_fixture_record()
        line = json.dumps({"record": record, "written_at": 17})
        parsed = parse_mirror_line(line)
        assert parsed is not None
        assert parsed.record == record
        assert parsed.sidecar is None
        assert parsed.written_at == 17

    def test_shape_3_bare_record(self) -> None:
        record = signed_fixture_record()
        parsed = parse_mirror_line(json.dumps(record))
        assert parsed is not None
        assert parsed.record == record
        assert parsed.sidecar is None
        assert parsed.proof is None
        assert parsed.written_at is None

    def test_malformed_lines_return_none(self) -> None:
        assert parse_mirror_line("not json at all") is None
        assert parse_mirror_line("[1,2,3]") is None
        assert parse_mirror_line('"just a string"') is None
        assert parse_mirror_line('{"record": {"spec_version": "atrib/1.0"}}') is None
        # A non-transaction record missing its signature is malformed.
        unsigned = signed_fixture_record()
        del unsigned["signature"]
        assert parse_mirror_line(json.dumps(unsigned)) is None

    def test_transaction_record_with_signers_and_no_signature_parses(self) -> None:
        creator_key = base64url_encode(get_public_key(SEED))
        transaction = {
            "spec_version": SPEC_VERSION,
            "content_id": "sha256:" + "0" * 64,
            "creator_key": creator_key,
            "chain_root": genesis_chain_root(CONTEXT_A),
            "event_type": EVENT_TYPE_TRANSACTION_URI,
            "context_id": CONTEXT_A,
            "timestamp": FIXED_TIMESTAMP_MS,
            "signers": [{"creator_key": creator_key, "signature": "A" * 86}],
        }
        assert "signature" not in transaction
        parsed = parse_mirror_line(json.dumps(transaction))
        assert parsed is not None
        assert parsed.record["event_type"] == EVENT_TYPE_TRANSACTION_URI
        assert parsed.record["signers"] == transaction["signers"]


# ── 7. resolve_key ladder (§5.6) ─────────────────────────────────────────


class TestResolveKey:
    def test_env_var_wins_over_key_file(self, tmp_path: Path) -> None:
        key_file = tmp_path / "seed.txt"
        key_file.write_text(OTHER_SEED_B64URL, encoding="utf-8")
        resolved = resolve_key(
            {"ATRIB_PRIVATE_KEY": SEED_B64URL, "ATRIB_KEY_FILE": str(key_file)}
        )
        assert resolved is not None
        assert resolved.source == "env"
        assert resolved.private_key == SEED

    def test_malformed_env_value_degrades_to_file(self, tmp_path: Path) -> None:
        key_file = tmp_path / "seed.txt"
        key_file.write_text(OTHER_SEED_B64URL, encoding="utf-8")
        resolved = resolve_key(
            {"ATRIB_PRIVATE_KEY": "not-a-valid-seed", "ATRIB_KEY_FILE": str(key_file)}
        )
        assert resolved is not None
        assert resolved.source == "file"
        assert resolved.private_key == OTHER_SEED

    def test_malformed_env_value_without_file_degrades_to_none(self) -> None:
        # Both a non-decodable value and a wrong-length seed degrade
        # silently to None (§5.8: absence of a key is not an error).
        assert resolve_key({"ATRIB_PRIVATE_KEY": "not-a-valid-seed"}) is None
        assert resolve_key({"ATRIB_PRIVATE_KEY": base64url_encode(b"short")}) is None

    def test_key_file_with_valid_seed_works(self, tmp_path: Path) -> None:
        key_file = tmp_path / "seed.txt"
        key_file.write_text(SEED_B64URL + "\n", encoding="utf-8")
        resolved = resolve_key({"ATRIB_KEY_FILE": str(key_file)})
        assert resolved is not None
        assert resolved.source == "file"
        assert resolved.private_key == SEED

    def test_unreadable_key_file_degrades_to_none(self, tmp_path: Path) -> None:
        resolved = resolve_key({"ATRIB_KEY_FILE": str(tmp_path / "missing.txt")})
        assert resolved is None


# ── 8. fresh-orphan context synthesis (§1.5.1) ───────────────────────────


class TestFreshOrphan:
    def test_synthesizes_fresh_context_and_never_inherits_mirror_tail(
        self, tmp_path: Path
    ) -> None:
        seeded_context = "c" * 32
        seeded = make_client(tmp_path, context_id=seeded_context)
        prior = seeded.attest({"seed": True})
        assert prior.context_id == seeded_context

        orphan = AtribClient(
            anchors=[DEAD_ANCHOR],
            mirror_write_path=tmp_path / "write.jsonl",
            mirror_read_path=tmp_path / "read.jsonl",
            env={"ATRIB_PRIVATE_KEY": SEED_B64URL},
        )
        result = orphan.attest({"what": "orphan"})
        assert result.via == "in-process"
        assert result.context_id is not None
        assert CONTEXT_ID_RE.match(result.context_id)
        # MUST NOT inherit the mirror tail's context (§1.5.1).
        assert result.context_id != seeded_context
        assert any("orphan" in warning for warning in result.warnings)

        tail = read_mirror(tmp_path / "write.jsonl")[-1].record
        assert tail["context_id"] == result.context_id
        # Fresh context ⇒ genesis chain_root, not the seeded tail.
        assert tail["chain_root"] == genesis_chain_root(result.context_id)
        assert tail["chain_root"] != prior.record_hash
