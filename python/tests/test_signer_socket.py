# SPDX-License-Identifier: Apache-2.0
"""D190 signer socket client: the same rules as @atrib/mcp signer-socket.ts."""

from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from atrib import (
    AtribClient,
    ResolvedKey,
    SignerSocket,
    SignerSocketError,
    resolve_key,
    sign_record,
    signer_socket_from_env,
    verify_record,
)
from atrib.encoding import base64url_encode
from atrib.records import build_and_sign_emit_record
from atrib.signing import get_public_key

BROKER_SEED = bytes([7]) * 32
OTHER_SEED = bytes([8]) * 32
PINNED = base64url_encode(get_public_key(BROKER_SEED))
CONTEXT_ID = "4bf92f3577b34da6a3ce929d0e0e4736"

Handler = Callable[[dict[str, object]], dict[str, object] | None]


@pytest.fixture
def broker() -> Iterator[Callable[[Handler], str]]:
    # AF_UNIX paths are short; pytest's tmp_path can exceed the limit.
    directory = tempfile.mkdtemp(prefix="atrib-signer-")
    path = os.path.join(directory, "signer.sock")
    servers: list[socket.socket] = []

    def start(handler: Handler) -> str:
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(path)
        server.listen()
        servers.append(server)

        def serve() -> None:
            while True:
                try:
                    conn, _ = server.accept()
                except OSError:
                    return
                with conn:
                    data = b""
                    while b"\n" not in data:
                        chunk = conn.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                    response = handler(json.loads(data.split(b"\n")[0]))
                    if response is not None:
                        conn.sendall((json.dumps(response) + "\n").encode())

        threading.Thread(target=serve, daemon=True).start()
        return path

    yield start
    for server in servers:
        server.close()
    if os.path.exists(path):
        os.unlink(path)
    os.rmdir(directory)


def signing_broker(seed: bytes) -> Handler:
    def handle(request: dict[str, object]) -> dict[str, object]:
        record = request["record"]
        assert isinstance(record, dict)
        return {"v": 1, "ok": True, "signature": sign_record(record, seed)["signature"]}

    return handle


def unsigned(creator_key: str = PINNED, **overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "spec_version": "atrib/1.0",
        "content_id": "sha256:" + "3f8a2b" + "0" * 58,
        "creator_key": creator_key,
        "chain_root": "sha256:" + "7e1f4a" + "0" * 58,
        "event_type": "https://atrib.dev/v1/types/observation",
        "context_id": CONTEXT_ID,
        "timestamp": 1743850000000,
        "signature": "",
    }
    record.update(overrides)
    return record


def client_signer(path: str, **kwargs: object) -> SignerSocket:
    return SignerSocket(
        socket_path=path,
        creator_key=PINNED,
        identity="test-agent",
        allow_same_owner=True,
        **kwargs,  # type: ignore[arg-type]
    )


def test_returns_a_record_byte_identical_to_in_process_signing(broker) -> None:
    path = broker(signing_broker(BROKER_SEED))
    signed = client_signer(path).sign_record(unsigned())
    assert signed == sign_record(unsigned(), BROKER_SEED)
    assert verify_record(signed, now_ms=1743850000000)


def test_rejects_a_signature_that_does_not_verify_under_the_pinned_key(broker) -> None:
    path = broker(signing_broker(OTHER_SEED))
    with pytest.raises(SignerSocketError, match="does not verify under the pinned key"):
        client_signer(path).sign_record(unsigned())


def test_surfaces_a_refusal(broker) -> None:
    path = broker(lambda _request: {"v": 1, "ok": False, "error": "identity not allowed"})
    with pytest.raises(SignerSocketError, match="signer refused: identity not allowed"):
        client_signer(path).sign_record(unsigned())


def test_refuses_transactions_and_foreign_creator_keys_before_connecting(broker) -> None:
    calls: list[object] = []
    path = broker(lambda request: calls.append(request) or signing_broker(BROKER_SEED)(request))
    signer = client_signer(path)
    with pytest.raises(SignerSocketError, match="transaction"):
        signer.sign_record(unsigned(event_type="https://atrib.dev/v1/types/transaction"))
    other = base64url_encode(get_public_key(OTHER_SEED))
    with pytest.raises(SignerSocketError, match="does not match the pinned"):
        signer.sign_record(unsigned(creator_key=other))
    assert calls == []


def test_times_out_when_the_signer_never_answers(broker) -> None:
    path = broker(lambda _request: None)
    with pytest.raises(SignerSocketError, match="timed out|without answering"):
        client_signer(path, timeout_ms=100).sign_record(unsigned())


def test_refuses_a_socket_owned_by_the_calling_user(broker) -> None:
    path = broker(signing_broker(BROKER_SEED))
    signer = SignerSocket(socket_path=path, creator_key=PINNED, identity="test-agent")
    with pytest.raises(SignerSocketError, match="owned by the calling user"):
        signer.sign_record(unsigned())


def test_from_env_requires_a_pinned_key_and_defaults_the_identity() -> None:
    assert signer_socket_from_env({}) is None
    with pytest.raises(ValueError, match="ATRIB_SIGNER_PUBKEY"):
        signer_socket_from_env({"ATRIB_SIGNER_SOCK": "/run/s.sock"})
    signer = signer_socket_from_env(
        {"ATRIB_SIGNER_SOCK": "/run/s.sock", "ATRIB_SIGNER_PUBKEY": PINNED, "ATRIB_AGENT": "codex"}
    )
    assert signer is not None and signer.identity == "codex" and signer.timeout_ms == 500


def test_resolve_key_treats_the_socket_as_final() -> None:
    seed = base64url_encode(OTHER_SEED)
    key = resolve_key(
        {
            "ATRIB_SIGNER_SOCK": "/run/s.sock",
            "ATRIB_SIGNER_PUBKEY": PINNED,
            "ATRIB_PRIVATE_KEY": seed,
        }
    )
    assert key is not None and key.source == "signer-socket" and key.private_key == b""
    assert key.signer is not None and key.signer.creator_key == PINNED
    # Misconfigured socket: pass-through, never the seed.
    assert resolve_key({"ATRIB_SIGNER_SOCK": "/run/s.sock", "ATRIB_PRIVATE_KEY": seed}) is None


def test_build_record_requires_exactly_one_key_source(broker) -> None:
    path = broker(signing_broker(BROKER_SEED))
    common = {
        "event_type": "https://atrib.dev/v1/types/observation",
        "context_id": CONTEXT_ID,
        "chain_root": "sha256:" + "0" * 64,
        "content": {"note": "hello"},
        "timestamp_ms": 1743850000000,
    }
    via_signer = build_and_sign_emit_record(signer=client_signer(path), **common)  # type: ignore[arg-type]
    via_seed = build_and_sign_emit_record(private_key=BROKER_SEED, **common)  # type: ignore[arg-type]
    assert via_signer == via_seed
    with pytest.raises(ValueError, match="exactly one"):
        build_and_sign_emit_record(**common)  # type: ignore[arg-type]


def test_client_attest_signs_through_the_socket_and_degrades_without_a_seed(
    broker, tmp_path: Path
) -> None:
    path = broker(signing_broker(BROKER_SEED))
    key = ResolvedKey(private_key=b"", source="signer-socket", signer=client_signer(path))
    mirror = tmp_path / "mirror.jsonl"
    client = AtribClient(
        key=key, context_id=CONTEXT_ID, daemon_mode="off", mirror_write_path=mirror, env={}
    )
    result = client.attest({"note": "hello"})
    assert result.record_hash is not None and result.via == "in-process"
    written = json.loads(mirror.read_text().splitlines()[0])
    assert written["record"]["creator_key"] == PINNED
    assert verify_record(written["record"])

    dead = ResolvedKey(
        private_key=b"",
        source="signer-socket",
        signer=SignerSocket(
            socket_path=str(tmp_path / "none.sock"),
            creator_key=PINNED,
            identity="x",
            allow_same_owner=True,
        ),
    )
    degraded = AtribClient(
        key=dead,
        context_id=CONTEXT_ID,
        daemon_mode="off",
        mirror_write_path=tmp_path / "m2.jsonl",
        env={},
    )
    out = degraded.attest({"note": "hello"})
    assert out.record_hash is None
    assert any("signing failed" in warning for warning in out.warnings)
