# SPDX-License-Identifier: Apache-2.0
"""Stateless MCP v2 HTTP transport and daemon-first client behavior."""

from __future__ import annotations

import json
import socketserver
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import cast

from atrib import AtribClient, StatelessMcpClient

CONTEXT_ID = "2" * 32
CORPUS = (
    Path(__file__).resolve().parents[2]
    / "spec"
    / "conformance"
    / "mcp-extension"
    / "cases"
)


class _Handler(BaseHTTPRequestHandler):
    requests: list[tuple[dict[str, str], dict[str, object]]] = []
    use_sse = False

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = cast(
            dict[str, object],
            json.loads(self.rfile.read(length).decode("utf-8")),
        )
        self.requests.append((dict(self.headers.items()), body))
        method = body["method"]
        request_id = body["id"]
        if method == "server/discover":
            result: dict[str, object] = {
                "supportedVersions": ["2026-07-28"],
                "capabilities": {
                    "tools": {},
                    "extensions": {
                        "dev.atrib/attribution": {
                            "version": "0.1",
                            "receipts": ["token", "record"],
                        }
                    },
                },
                "ttlMs": 0,
                "cacheScope": "private",
                "resultType": "complete",
            }
        else:
            receipt_case = json.loads(
                (CORPUS / "receipt--consistent.json").read_text(encoding="utf-8")
            )
            receipt = receipt_case["input"]["result_block"]
            params = cast(dict[str, object], body["params"])
            arguments = cast(dict[str, object], params["arguments"])
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "record_hash": "sha256:" + "a" * 64,
                                "context_id": arguments.get("context_id"),
                                "warnings": [],
                            }
                        ),
                    }
                ],
                "_meta": {"dev.atrib/attribution": receipt},
            }
        message = json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "result": result}
        )
        encoded = (
            f"event: message\ndata: {message}\n\n".encode("utf-8")
            if self.use_sse
            else message.encode("utf-8")
        )
        self.send_response(200)
        self.send_header(
            "Content-Type", "text/event-stream" if self.use_sse else "application/json"
        )
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


class _ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@contextmanager
def _server(
    *, use_sse: bool = False
) -> Iterator[tuple[str, list[tuple[dict[str, str], dict[str, object]]]]]:
    _Handler.requests = []
    _Handler.use_sse = use_sse
    server = _ThreadingServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}/mcp", _Handler.requests
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def test_independent_client_sends_complete_v2_envelope_and_headers() -> None:
    with _server() as (endpoint, requests):
        client = StatelessMcpClient(
            endpoint,
            request_meta={"custom": {"keep": True}},
            attribution_accept=("token", "record"),
        )
        outcome = client.call_tool(
            "emit",
            {"event_type": "observation", "content": {"what": "test"}, "context_id": CONTEXT_ID},
            context_id=CONTEXT_ID,
            idempotency_key="python-test-key-0001",
        )

    assert outcome.transport.protocol_version == "2026-07-28"
    assert outcome.transport.attribution_declared is True
    assert outcome.attribution_verification is not None
    assert outcome.attribution_verification.valid is True
    assert len(requests) == 2
    discover_headers, discover_body = requests[0]
    assert discover_headers["Mcp-Method"] == "server/discover"
    discover_meta = cast(dict[str, object], cast(dict[str, object], discover_body["params"])["_meta"])
    assert discover_meta["io.modelcontextprotocol/protocolVersion"] == "2026-07-28"

    call_headers, call_body = requests[1]
    assert call_headers["Mcp-Method"] == "tools/call"
    assert call_headers["Mcp-Name"] == "emit"
    assert call_headers["Mcp-Protocol-Version"] == "2026-07-28"
    params = cast(dict[str, object], call_body["params"])
    meta = cast(dict[str, object], params["_meta"])
    assert meta["custom"] == {"keep": True}
    assert meta["dev.atrib/idempotencyKey"] == "python-test-key-0001"
    assert meta["X-atrib-Context"] == CONTEXT_ID
    assert cast(dict[str, object], meta["dev.atrib/attribution"])["context_id"] == CONTEXT_ID


def test_atrib_client_daemon_path_surfaces_negotiation_and_receipt() -> None:
    with _server() as (endpoint, _requests):
        client = AtribClient(
            daemon_endpoint=endpoint,
            daemon_mode="require",
            context_id=CONTEXT_ID,
            anchors=[],
        )
        result = client.attest(
            {"what": "daemon path"},
            idempotency_key="python-test-key-0002",
        )

    assert result.via == "daemon"
    assert result.record_hash == "sha256:" + "a" * 64
    assert result.transport is not None
    assert result.transport.protocol_version == "2026-07-28"
    assert result.attribution_verification is not None
    assert result.attribution_verification.valid is True


def test_independent_client_accepts_sse_responses() -> None:
    with _server(use_sse=True) as (endpoint, _requests):
        outcome = StatelessMcpClient(endpoint).call_tool(
            "emit",
            {"event_type": "observation", "content": {}, "context_id": CONTEXT_ID},
            context_id=CONTEXT_ID,
        )
    assert isinstance(outcome.value, dict)
    assert outcome.transport.protocol_era == "modern"


def test_reachable_daemon_refuses_write_without_explicit_context() -> None:
    with _server() as (endpoint, requests):
        client = AtribClient(
            daemon_endpoint=endpoint,
            daemon_mode="require",
            anchors=[],
            env={},
        )
        result = client.attest({"what": "must not sign"})

    assert result.via == "none"
    assert result.record_hash is None
    assert any("requires an explicit context_id" in warning for warning in result.warnings)
    assert [body["method"] for _, body in requests] == ["server/discover"]
