# SPDX-License-Identifier: Apache-2.0
"""Local signer socket client (D190).

Port of ``packages/mcp/src/signer-socket.ts``. A producer that uses this
client never holds the Ed25519 seed. It builds the unsigned record with the
pinned ``creator_key``, sends it to a host-owned signer process over a Unix
socket, and accepts the returned signature only if it verifies under the
pinned key.

Wire format: one newline-terminated JSON request per connection, answered by
one newline-terminated JSON response::

    request:  {"v":1,"op":"sign","identity":"<name>","record":{...,"signature":""}}
    response: {"v":1,"ok":true,"signature":"<base64url>"}
              {"v":1,"ok":false,"error":"<reason>"}

Configuration comes from the environment through ``signer_socket_from_env``:

    ATRIB_SIGNER_SOCK        socket path. When set, it is the only key source.
    ATRIB_SIGNER_PUBKEY      pinned creator_key (base64url). Required.
    ATRIB_SIGNER_IDENTITY    identity requested from the signer. Defaults to
                             ATRIB_AGENT, then 'claude-code'.
    ATRIB_SIGNER_TIMEOUT_MS  bound on one request, connect included. Default 500.
"""

from __future__ import annotations

import json
import os
import socket
import stat
import time
from collections.abc import Mapping
from dataclasses import dataclass

from .encoding import base64url_decode
from .signing import verify_record
from .types import EVENT_TYPE_TRANSACTION_URI, AtribRecord

ATRIB_SIGNER_SOCK_ENV = "ATRIB_SIGNER_SOCK"
ATRIB_SIGNER_PUBKEY_ENV = "ATRIB_SIGNER_PUBKEY"
ATRIB_SIGNER_IDENTITY_ENV = "ATRIB_SIGNER_IDENTITY"
ATRIB_SIGNER_TIMEOUT_MS_ENV = "ATRIB_SIGNER_TIMEOUT_MS"

DEFAULT_TIMEOUT_MS = 500
MAX_RESPONSE_BYTES = 64 * 1024


class SignerSocketError(Exception):
    """The signer could not produce a verified signature."""


@dataclass(frozen=True)
class SignerSocket:
    """A signer that holds the key outside the calling process."""

    socket_path: str
    creator_key: str  # pinned, base64url
    identity: str
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    # Accept a socket, or a socket directory, owned by the calling user. Off by
    # default: a same-user socket can be planted by any process running as
    # that user. Tests and single-user development set this.
    allow_same_owner: bool = False

    def __post_init__(self) -> None:
        try:
            pinned = base64url_decode(self.creator_key.strip())
        except ValueError as exc:
            raise ValueError("atrib: signer socket creator key is not valid base64url") from exc
        if len(pinned) != 32:
            raise ValueError("atrib: signer socket creator key must decode to 32 bytes")
        object.__setattr__(self, "creator_key", self.creator_key.strip())
        if self.timeout_ms <= 0:
            object.__setattr__(self, "timeout_ms", DEFAULT_TIMEOUT_MS)

    def sign_record(self, record: Mapping[str, object]) -> AtribRecord:
        """Sign a record whose creator_key equals the pinned key. Raises
        ``SignerSocketError`` unless the returned signature verifies."""
        if record.get("creator_key") != self.creator_key:
            raise SignerSocketError(
                "atrib: record creator_key does not match the pinned signer key"
            )
        if record.get("event_type") == EVENT_TYPE_TRANSACTION_URI:
            raise SignerSocketError("atrib: the signer socket does not sign transaction records")
        if not self.allow_same_owner:
            _check_socket_ownership(self.socket_path)
        unsigned = {k: v for k, v in record.items() if k != "signature"}
        unsigned["signature"] = ""
        response = _request(
            self.socket_path,
            {"v": 1, "op": "sign", "identity": self.identity, "record": unsigned},
            self.timeout_ms,
        )
        signature = response.get("signature")
        if response.get("ok") is not True or not isinstance(signature, str):
            error = response.get("error")
            reason = error if isinstance(error, str) else "malformed response"
            raise SignerSocketError(f"atrib: signer refused: {reason}")
        signed = dict(unsigned)
        signed["signature"] = signature
        if not verify_record(signed):
            raise SignerSocketError(
                "atrib: signer returned a signature that does not verify under the pinned key"
            )
        return signed  # type: ignore[return-value]


def signer_socket_from_env(env: Mapping[str, str] | None = None) -> SignerSocket | None:
    """Build a signer from the environment. Returns None when
    ATRIB_SIGNER_SOCK is unset. Raises ``ValueError`` when it is set but the
    rest of the configuration is missing or invalid, so callers fail closed
    instead of falling back to a seed."""
    environment: Mapping[str, str] = os.environ if env is None else env
    socket_path = environment.get(ATRIB_SIGNER_SOCK_ENV)
    if not socket_path:
        return None
    creator_key = environment.get(ATRIB_SIGNER_PUBKEY_ENV)
    if not creator_key:
        raise ValueError(
            f"atrib: {ATRIB_SIGNER_SOCK_ENV} is set but {ATRIB_SIGNER_PUBKEY_ENV} is not; "
            "refusing to sign without a pinned key"
        )
    identity = (
        environment.get(ATRIB_SIGNER_IDENTITY_ENV)
        or environment.get("ATRIB_AGENT")
        or "claude-code"
    )
    raw_timeout = environment.get(ATRIB_SIGNER_TIMEOUT_MS_ENV)
    try:
        timeout_ms = int(raw_timeout) if raw_timeout else DEFAULT_TIMEOUT_MS
    except ValueError:
        timeout_ms = DEFAULT_TIMEOUT_MS
    return SignerSocket(
        socket_path=socket_path,
        creator_key=creator_key,
        identity=identity,
        timeout_ms=timeout_ms,
    )


def _check_socket_ownership(socket_path: str) -> None:
    """Refuse a socket that the calling user could have planted: one owned by
    the calling uid, or one in a directory the calling uid owns or anyone can
    write."""
    if not hasattr(os, "getuid"):
        return
    uid = os.getuid()
    try:
        sock = os.stat(socket_path)
        directory = os.stat(os.path.dirname(socket_path) or ".")
    except OSError as exc:
        raise SignerSocketError(f"atrib: signer socket: {exc}") from exc
    if sock.st_uid == uid or directory.st_uid == uid:
        raise SignerSocketError(
            "atrib: signer socket is owned by the calling user; "
            "it must belong to a separate signer account"
        )
    if directory.st_mode & stat.S_IWOTH:
        raise SignerSocketError("atrib: signer socket directory is world-writable")


def _request(socket_path: str, body: object, timeout_ms: int) -> dict[str, object]:
    deadline = time.monotonic() + timeout_ms / 1000
    payload = (json.dumps(body, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    received = bytearray()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(timeout_ms / 1000)
            conn.connect(socket_path)
            conn.sendall(payload)
            while b"\n" not in received:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                conn.settimeout(remaining)
                chunk = conn.recv(4096)
                if not chunk:
                    raise SignerSocketError("atrib: signer closed the connection without answering")
                received.extend(chunk)
                if len(received) > MAX_RESPONSE_BYTES:
                    raise SignerSocketError("atrib: signer response too large")
    except (TimeoutError, socket.timeout) as exc:
        raise SignerSocketError(f"atrib: signer socket timed out after {timeout_ms}ms") from exc
    except OSError as exc:
        raise SignerSocketError(f"atrib: signer socket: {exc}") from exc
    line = bytes(received[: received.index(b"\n")])
    try:
        parsed = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SignerSocketError("atrib: signer response is not JSON") from exc
    if not isinstance(parsed, dict):
        raise SignerSocketError("atrib: signer response is not an object")
    return parsed
