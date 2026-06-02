# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import importlib.metadata
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer
from typing import Any

from mem0 import Memory
from mem0.configs.base import EmbedderConfig, LlmConfig, MemoryConfig, VectorStoreConfig


os.environ["MEM0_TELEMETRY"] = "false"


class ReusableTcpServer(TCPServer):
    allow_reuse_address = True


class LocalOpenAiProvider:
    def __init__(self) -> None:
        self.paths: list[str] = []

        provider = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                provider.paths.append(self.path)
                body = read_json(self)
                if "/embeddings" in self.path:
                    inputs = body.get("input")
                    if not isinstance(inputs, list):
                        inputs = [inputs]
                    self.write_json(
                        {
                            "object": "list",
                            "model": body.get("model", "text-embedding-3-small"),
                            "data": [
                                {
                                    "object": "embedding",
                                    "index": index,
                                    "embedding": embedding_for(str(value)),
                                }
                                for index, value in enumerate(inputs)
                            ],
                            "usage": {"prompt_tokens": 1, "total_tokens": 1},
                        }
                    )
                    return

                if "/chat/completions" in self.path:
                    self.write_json(
                        {
                            "id": "chatcmpl-atrib-local-mem0-python",
                            "object": "chat.completion",
                            "created": 1780354200,
                            "model": body.get("model", "gpt-5-mini"),
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": json.dumps(
                                            {
                                                "memory": [
                                                    {
                                                        "text": "User prefers quiet sci-fi movies."
                                                    }
                                                ]
                                            }
                                        ),
                                    },
                                    "finish_reason": "stop",
                                }
                            ],
                            "usage": {
                                "prompt_tokens": 1,
                                "completion_tokens": 1,
                                "total_tokens": 2,
                            },
                        }
                    )
                    return

                self.send_response(404)
                self.end_headers()

            def write_json(self, body: Any) -> None:
                raw = json.dumps(body).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args: Any) -> None:
                return

        self.server = ReusableTcpServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=1)


def main() -> None:
    provider = LocalOpenAiProvider()
    memory: Memory | None = None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            config = MemoryConfig(
                vector_store=VectorStoreConfig(
                    provider="qdrant",
                    config={
                        "collection_name": "atrib_mem0_python_oss",
                        "embedding_model_dims": 2,
                        "path": tmp,
                    },
                ),
                llm=LlmConfig(
                    provider="openai",
                    config={
                        "api_key": "atrib-local-python",
                        "openai_base_url": provider.base_url,
                        "model": "gpt-5-mini",
                    },
                ),
                embedder=EmbedderConfig(
                    provider="openai",
                    config={
                        "api_key": "atrib-local-python",
                        "openai_base_url": provider.base_url,
                        "model": "text-embedding-3-small",
                        "embedding_dims": 2,
                    },
                ),
                history_db_path=os.path.join(tmp, "history.db"),
                version="v1.1",
            )
            memory = Memory(config=config)
            add_args = {
                "messages": [
                    {
                        "role": "user",
                        "content": "I prefer quiet sci-fi movies for weekends.",
                    },
                    {
                        "role": "assistant",
                        "content": "I will remember that movie preference.",
                    },
                ],
                "user_id": "alice",
                "metadata": {"category": "movie_recommendations"},
            }
            add_result = memory.add(**add_args)
            search_args = {
                "query": "What movie preference should I remember?",
                "filters": {"user_id": "alice"},
                "top_k": 3,
                "threshold": 0,
            }
            search_result = memory.search(**search_args)

            add_count = len(add_result.get("results", []))
            search_count = len(search_result.get("results", []))
            add_contains = any(
                "sci-fi" in item.get("memory", "").lower()
                for item in add_result.get("results", [])
            )
            search_contains = any(
                "sci-fi" in item.get("memory", "").lower()
                for item in search_result.get("results", [])
            )
            if add_count < 1 or search_count < 1:
                raise RuntimeError("mem0 Python proof expected add and search results")
            if not add_contains or not search_contains:
                raise RuntimeError("mem0 Python proof did not preserve the proof phrase")

            print(
                json.dumps(
                    {
                        "ok": True,
                        "mem0ai_python_version": importlib.metadata.version("mem0ai"),
                        "operations": [
                            {
                                "operation": "mem0.python.memory.add",
                                "args": add_args,
                                "result": {
                                    "status": "ok",
                                    "results": normalize_mem0_result(add_result),
                                },
                            },
                            {
                                "operation": "mem0.python.memory.search",
                                "args": search_args,
                                "result": {
                                    "status": "ok",
                                    "results": normalize_mem0_result(search_result),
                                },
                            },
                        ],
                        "summary": {
                            "add_result_count": add_count,
                            "search_result_count": search_count,
                            "add_contains_proof_phrase": add_contains,
                            "search_contains_proof_phrase": search_contains,
                            "provider_paths_seen": provider.paths,
                        },
                    },
                    indent=2,
                )
            )
    finally:
        close_mem0(memory)
        provider.close()


def normalize_mem0_result(value: dict[str, Any]) -> list[dict[str, Any]]:
    items = value.get("results", [])
    normalized: list[dict[str, Any]] = []
    for item in items:
        normalized.append(
            {
                key: item[key]
                for key in (
                    "id",
                    "memory",
                    "event",
                    "score",
                    "hash",
                    "metadata",
                    "user_id",
                )
                if key in item
            }
        )
    return normalized


def close_mem0(memory: Memory | None) -> None:
    if memory is None:
        return
    vector_store = getattr(memory, "vector_store", None)
    client = getattr(vector_store, "client", None)
    close = getattr(client, "close", None)
    if callable(close):
        close()


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    raw = handler.rfile.read(int(handler.headers.get("content-length", "0")))
    return json.loads(raw.decode("utf-8")) if raw else {}


def embedding_for(text: str) -> list[float]:
    normalized = text.lower()
    if "sci-fi" in normalized or "movie" in normalized:
        return [1.0, 0.0]
    return [0.0, 1.0]


if __name__ == "__main__":
    main()
