# SPDX-License-Identifier: Apache-2.0
"""Minimal MCP 2026-07-28 attribution server using only Python's stdlib.

Run from the repository root:

python3 docs/extensions/dev.atrib-attribution/independent-server.py \
  spec/conformance/mcp-extension/cases/receipt--consistent.json
"""

from __future__ import annotations

import json
import signal
import socketserver
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, cast

receipt_case = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
receipt_block = receipt_case["input"]["result_block"]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = cast(dict[str, Any], json.loads(self.rfile.read(length)))
        method = body["method"]
        if method == "server/discover":
            result: dict[str, Any] = {
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
        elif method == "tools/call":
            meta = cast(dict[str, Any], body["params"]["_meta"])
            declaration = cast(
                dict[str, Any],
                cast(dict[str, Any], meta["io.modelcontextprotocol/clientCapabilities"])[
                    "extensions"
                ]["dev.atrib/attribution"],
            )
            if declaration["version"] != "0.1":
                self.send_error(400)
                return
            result = {
                "content": [{"type": "text", "text": json.dumps({"ok": True})}],
                "_meta": {"dev.atrib/attribution": receipt_block},
                "resultType": "complete",
            }
        else:
            self.send_error(404)
            return
        encoded = json.dumps(
            {"jsonrpc": "2.0", "id": body["id"], "result": result},
            separators=(",", ":"),
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


server = Server(("127.0.0.1", 0), Handler)
signal.signal(signal.SIGTERM, lambda _signum, _frame: server.shutdown())
host, port = server.server_address
print(json.dumps({"endpoint": f"http://{host}:{port}/mcp"}), flush=True)
server.serve_forever()
