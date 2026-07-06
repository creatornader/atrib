# SPDX-License-Identifier: Apache-2.0
"""Non-blocking log submission (§5.3.5, §2.6.1).

Port of the ``@atrib/mcp`` submission queue contract: submission is always
non-blocking (a background thread), failures never propagate, retry is
exponential backoff with max 3 attempts inside a 30-second window, and
proof bundles cache keyed by bare-hex record_hash. The POST body is the
bare signed record — never the mirror envelope (§5.9.4).
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field

from .hashes import record_hash_hex
from .types import EVENT_TYPE_TRANSACTION_URI, AtribRecord

DEFAULT_LOG_ENDPOINT = "https://log.atrib.dev/v1/entries"
_MAX_RETRIES = 3
_INITIAL_BACKOFF_S = 1.0
_MAX_WINDOW_S = 30.0


def normalize_log_endpoint(endpoint: str) -> str:
    """Append /v1/entries when given a bare origin, mirroring the TS helper."""
    trimmed = endpoint.rstrip("/")
    if trimmed.endswith("/entries"):
        return trimmed
    if trimmed.endswith("/v1"):
        return f"{trimmed}/entries"
    return f"{trimmed}/v1/entries"


@dataclass
class _Job:
    record: AtribRecord
    priority: str  # 'high' | 'normal'
    enqueued_at: float = field(default_factory=time.monotonic)

    def sort_key(self) -> tuple[int, float]:
        return (0 if self.priority == "high" else 1, self.enqueued_at)


class SubmissionQueue:
    """Fire-and-forget §2.6.1 submitter with a bounded worker thread."""

    def __init__(self, log_endpoint: str | None = None, *, timeout_s: float = 5.0) -> None:
        self._endpoint = normalize_log_endpoint(log_endpoint or DEFAULT_LOG_ENDPOINT)
        self._timeout_s = timeout_s
        self._proofs: dict[str, Mapping[str, object]] = {}
        self._pending: "queue.Queue[_Job | None]" = queue.Queue()
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._idle = threading.Event()
        self._idle.set()

    def submit(self, record: AtribRecord, priority: str = "normal") -> None:
        """Non-blocking enqueue. Never raises (§5.8)."""
        try:
            self._pending.put(_Job(record=record, priority=priority))
            self._idle.clear()
            self._ensure_worker()
        except Exception as exc:  # noqa: BLE001 — degradation contract
            print(f"atrib: submission enqueue failed: {exc}", file=sys.stderr)

    def get_proof(self, record_hash_bare_hex: str) -> Mapping[str, object] | None:
        """Proof bundle cache, keyed by BARE hex (no ``sha256:`` prefix)."""
        return self._proofs.get(record_hash_bare_hex)

    def flush(self, deadline_s: float = 30.0) -> None:
        """Wait (bounded) for the queue to drain. Never raises."""
        self._idle.wait(timeout=deadline_s)

    def _ensure_worker(self) -> None:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._drain, name="atrib-submission", daemon=True
            )
            self._worker.start()

    def _drain(self) -> None:
        while True:
            try:
                job = self._pending.get(timeout=0.25)
            except queue.Empty:
                self._idle.set()
                return
            if job is None:
                continue
            try:
                self._submit_with_retry(job)
            except Exception as exc:  # noqa: BLE001 — degradation contract
                print(f"atrib: submission worker error: {exc}", file=sys.stderr)
            finally:
                self._pending.task_done()

    def _submit_with_retry(self, job: _Job) -> None:
        started = time.monotonic()
        backoff = _INITIAL_BACKOFF_S
        for attempt in range(1, _MAX_RETRIES + 1):
            outcome = self._post_once(job.record)
            if outcome == "accepted":
                return
            if outcome == "permanent":
                # 4xx: permanent reject; drop per §5.3.5.
                priority_note = " (transaction)" if job.priority == "high" else ""
                print(
                    f"atrib: log rejected record{priority_note}; dropping",
                    file=sys.stderr,
                )
                return
            if attempt == _MAX_RETRIES:
                break
            remaining = _MAX_WINDOW_S - (time.monotonic() - started)
            if remaining <= 0:
                break
            time.sleep(min(backoff, remaining))
            backoff *= 2
        print(
            f"atrib: log submission failed after {_MAX_RETRIES} attempts; record kept locally",
            file=sys.stderr,
        )

    def _post_once(self, record: AtribRecord) -> str:
        body = json.dumps(record, separators=(",", ":")).encode("utf-8")
        priority = (
            "high"
            if record.get("event_type") == EVENT_TYPE_TRANSACTION_URI
            else "normal"
        )
        request = urllib.request.Request(
            self._endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-atrib-Priority": priority,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict) and isinstance(
                    payload.get("log_index"), int
                ):
                    self._proofs[record_hash_hex(record)] = payload
                return "accepted"
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                return "permanent"
            return "retry"
        except Exception:  # noqa: BLE001 — network failures are silent+retry
            return "retry"
