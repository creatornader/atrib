# SPDX-License-Identifier: Apache-2.0
"""Conditional content identity and admission parity."""

import json
import subprocess
from pathlib import Path
from typing import get_origin, get_type_hints
from typing_extensions import NotRequired

import pytest

from atrib.canon import canonical_record
from atrib.encoding import base64url_encode
from atrib.signing import get_public_key, sign_record, sign_transaction_record, verify_record
from atrib.validation import validate_submission
from atrib.types import AtribRecord, SignerEntry

NOW = 1_800_000_000_000
SEED = bytes([7] * 32)
BASE = {
    "spec_version": "atrib/1.0",
    "event_type": "https://atrib.dev/v1/types/observation",
    "timestamp": NOW,
    "context_id": "00112233445566778899aabbccddeeff",
    "creator_key": base64url_encode(get_public_key(SEED)),
    "chain_root": "sha256:" + "a" * 64,
}


def test_record_signature_is_optional_but_signer_signature_is_required():
    assert get_origin(get_type_hints(AtribRecord, include_extras=True)["signature"]) is NotRequired
    assert get_type_hints(SignerEntry, include_extras=True)["signature"] is str


def test_observation_omission_round_trip():
    record = sign_record(BASE, SEED)
    assert "content_id" not in record
    assert validate_submission(record, now_ms=NOW).ok
    assert verify_record(record, now_ms=NOW)
    assert json.loads(canonical_record(record)) == record


@pytest.mark.parametrize("event", ["tool_call", "transaction", "directory_anchor", "session_checkpoint"])
def test_type_specific_content_id_required(event):
    record = {**BASE, "event_type": f"https://atrib.dev/v1/types/{event}", "signature": "sig"}
    assert not validate_submission(record, now_ms=NOW).ok


@pytest.mark.parametrize("content_id", [None, "", "sha256:abc", 1])
def test_present_content_id_must_be_valid(content_id):
    assert not validate_submission({**BASE, "signature": "sig", "content_id": content_id}, now_ms=NOW).ok


def test_transaction_without_top_level_signature():
    record = sign_transaction_record({**BASE, "event_type": "https://atrib.dev/v1/types/transaction", "content_id": "sha256:" + "b" * 64}, SEED)
    del record["signature"]
    assert validate_submission(record, now_ms=NOW).ok
    assert verify_record(record, now_ms=NOW)
    assert not validate_submission({**record, "signers": []}, now_ms=NOW).ok
    assert not validate_submission({**record, "event_type": BASE["event_type"]}, now_ms=NOW).ok
    assert not validate_submission({**record, "signers": [{"creator_key": "another", "signature": "sig"}]}, now_ms=NOW).ok


def test_five_minute_boundary():
    assert validate_submission({**BASE, "signature": "sig", "timestamp": NOW + 300_000}, now_ms=NOW).ok
    assert not validate_submission({**BASE, "signature": "sig", "timestamp": NOW + 300_001}, now_ms=NOW).ok


def test_typescript_python_signature_bytes_without_content_id():
    root = Path(__file__).resolve().parents[2]
    script = """
      import { signRecord, canonicalRecord } from './packages/mcp/dist/index.js';
      let input = ''; for await (const part of process.stdin) input += part;
      const record = await signRecord(JSON.parse(input), new Uint8Array(32).fill(7));
      process.stdout.write(new TextDecoder().decode(canonicalRecord(record)));
    """
    output = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(BASE), text=True, cwd=root, check=True, capture_output=True)
    assert output.stdout.encode() == canonical_record(sign_record(BASE, SEED))
