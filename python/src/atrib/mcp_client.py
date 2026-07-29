# SPDX-License-Identifier: Apache-2.0
"""Independent stateless MCP 2026-07-28 HTTP client for atribd."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .attribution import (
    ATTRIBUTION_EXTENSION_KEY,
    ATTRIBUTION_EXTENSION_VERSION,
    AttributionReceiptBlock,
    AttributionReceiptVerification,
    build_attribution_request_meta,
    parse_attribution_receipt_block,
    verify_attribution_receipt,
)

PROTOCOL_VERSION = "2026-07-28"
PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion"
CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo"
CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities"


class McpTransportError(RuntimeError):
    """The request could not get a usable response from the endpoint."""


class McpProtocolError(RuntimeError):
    """The peer answered, but rejected or violated the MCP request."""


@dataclass(frozen=True)
class McpTransportInfo:
    protocol_version: str
    protocol_era: str
    discover: Mapping[str, object]
    attribution_declared: bool
    attribution_version: str | None


@dataclass(frozen=True)
class McpToolOutcome:
    value: object
    transport: McpTransportInfo
    attribution_receipt: AttributionReceiptBlock | None
    attribution_verification: AttributionReceiptVerification | None


def _package_version() -> str:
    try:
        return version("atrib")
    except PackageNotFoundError:
        return "0.2.0"


def _decode_sse(body: str) -> object:
    data_lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
        elif not line and data_lines:
            return json.loads("\n".join(data_lines))
    if data_lines:
        return json.loads("\n".join(data_lines))
    raise ValueError("SSE response contained no data event")


class StatelessMcpClient:
    """One endpoint, per-request v2 envelopes, no semantic session state."""

    def __init__(
        self,
        endpoint: str,
        *,
        timeout_s: float = 10.0,
        request_meta: Mapping[str, object] | None = None,
        client_capabilities: Mapping[str, object] | None = None,
        session_token: str | None = None,
        attribution_accept: tuple[str, ...] = ("token",),
    ) -> None:
        self.endpoint = endpoint
        self.timeout_s = timeout_s
        self.request_meta = dict(request_meta or {})
        self.client_info = {"name": "atrib-sdk-py", "version": _package_version()}
        request_capabilities_raw = self.request_meta.get(CLIENT_CAPABILITIES_META_KEY)
        request_capabilities = (
            dict(request_capabilities_raw)
            if isinstance(request_capabilities_raw, Mapping)
            else {}
        )
        self.client_capabilities = {
            **request_capabilities,
            **dict(client_capabilities or {}),
        }
        raw_extensions = self.client_capabilities.get("extensions")
        request_extensions_raw = request_capabilities.get("extensions")
        request_extensions = (
            dict(request_extensions_raw)
            if isinstance(request_extensions_raw, Mapping)
            else {}
        )
        extensions = {
            **request_extensions,
            **(dict(raw_extensions) if isinstance(raw_extensions, Mapping) else {}),
        }
        extensions[ATTRIBUTION_EXTENSION_KEY] = {
            "version": ATTRIBUTION_EXTENSION_VERSION,
            "accept": list(attribution_accept),
        }
        self.client_capabilities["extensions"] = extensions
        self.session_token = session_token
        self.attribution_accept = attribution_accept
        self._discover: dict[str, object] | None = None
        self._request_id = 0
        self._latest_token: str | None = None

    def discover(self) -> McpTransportInfo:
        if self._discover is None:
            result = self._rpc(
                "server/discover",
                {},
                protocol_version=PROTOCOL_VERSION,
                include_envelope=True,
            )
            if not isinstance(result, Mapping):
                raise McpProtocolError("server/discover returned a non-object result")
            supported = result.get("supportedVersions")
            capabilities = result.get("capabilities")
            if not isinstance(supported, list) or PROTOCOL_VERSION not in supported:
                raise McpProtocolError(
                    f"server/discover did not offer protocol {PROTOCOL_VERSION}"
                )
            if not isinstance(capabilities, Mapping):
                raise McpProtocolError("server/discover omitted capabilities")
            self._discover = dict(result)
        return self._transport_info()

    def call_tool(
        self,
        name: str,
        arguments: Mapping[str, object],
        *,
        context_id: str | None = None,
        idempotency_key: str | None = None,
        request_meta: Mapping[str, object] | None = None,
    ) -> McpToolOutcome:
        transport = self.discover()
        meta = {
            **self.request_meta,
            **dict(request_meta or {}),
            CLIENT_CAPABILITIES_META_KEY: self.client_capabilities,
        }
        if idempotency_key is not None:
            meta["dev.atrib/idempotencyKey"] = idempotency_key
        meta = build_attribution_request_meta(
            meta,
            accept=self.attribution_accept,
            token=self._latest_token,
            context_id=context_id,
            session_token=self.session_token,
        )
        meta[PROTOCOL_VERSION_META_KEY] = PROTOCOL_VERSION
        meta[CLIENT_INFO_META_KEY] = self.client_info
        params: dict[str, object] = {
            "name": name,
            "arguments": dict(arguments),
            "_meta": meta,
        }
        result = self._rpc(
            "tools/call",
            params,
            protocol_version=PROTOCOL_VERSION,
            include_envelope=False,
        )
        if not isinstance(result, Mapping):
            raise McpProtocolError(f"tools/call {name} returned a non-object result")
        content = result.get("content")
        text: str | None = None
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, Mapping) and first.get("type") == "text":
                raw_text = first.get("text")
                text = raw_text if isinstance(raw_text, str) else None
        if result.get("isError") is True:
            raise McpProtocolError(f"daemon tool {name} errored: {text or 'unknown error'}")
        value: object = result
        if text is not None:
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                value = text
        result_meta = result.get("_meta")
        receipt = parse_attribution_receipt_block(result_meta)
        verification: AttributionReceiptVerification | None = None
        if receipt is not None and isinstance(result_meta, Mapping):
            verification = verify_attribution_receipt(
                result_meta.get(ATTRIBUTION_EXTENSION_KEY)
            )
            if verification.valid and receipt.token is not None:
                self._latest_token = receipt.token
        return McpToolOutcome(
            value=value,
            transport=transport,
            attribution_receipt=receipt,
            attribution_verification=verification,
        )

    def _transport_info(self) -> McpTransportInfo:
        assert self._discover is not None
        capabilities = cast(Mapping[str, object], self._discover["capabilities"])
        raw_extensions = capabilities.get("extensions")
        settings = (
            raw_extensions.get(ATTRIBUTION_EXTENSION_KEY)
            if isinstance(raw_extensions, Mapping)
            else None
        )
        declared = (
            isinstance(settings, Mapping)
            and isinstance(settings.get("version"), str)
            and bool(settings["version"])
        )
        return McpTransportInfo(
            protocol_version=PROTOCOL_VERSION,
            protocol_era="modern",
            discover=self._discover,
            attribution_declared=declared,
            attribution_version=(
                cast(str, settings["version"]) if declared and settings is not None else None
            ),
        )

    def _rpc(
        self,
        method: str,
        params: Mapping[str, object],
        *,
        protocol_version: str,
        include_envelope: bool,
    ) -> object:
        self._request_id += 1
        request_params = dict(params)
        if include_envelope:
            meta = build_attribution_request_meta(
                self.request_meta,
                accept=self.attribution_accept,
                session_token=self.session_token,
            )
            meta[PROTOCOL_VERSION_META_KEY] = protocol_version
            meta[CLIENT_INFO_META_KEY] = self.client_info
            meta[CLIENT_CAPABILITIES_META_KEY] = self.client_capabilities
            request_params["_meta"] = meta
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": self._request_id,
                "method": method,
                "params": request_params,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Mcp-Method": method,
        }
        request_name = request_params.get("name")
        if method == "tools/call" and isinstance(request_name, str):
            headers["Mcp-Name"] = request_name
        if method != "server/discover":
            headers["Mcp-Protocol-Version"] = protocol_version
        request = Request(self.endpoint, data=payload, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=self.timeout_s) as response:
                body = response.read().decode("utf-8")
                content_type = response.headers.get("Content-Type", "")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise McpProtocolError(
                f"MCP HTTP {exc.code} for {method}: {detail[:500]}"
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise McpTransportError(f"MCP transport failed for {method}: {exc}") from exc
        try:
            message = (
                _decode_sse(body)
                if "text/event-stream" in content_type
                else json.loads(body)
            )
        except (ValueError, json.JSONDecodeError) as exc:
            raise McpProtocolError(f"MCP response for {method} was not valid JSON/SSE") from exc
        if not isinstance(message, Mapping):
            raise McpProtocolError(f"MCP response for {method} was not an object")
        if "error" in message:
            raise McpProtocolError(f"MCP {method} error: {message['error']}")
        if "result" not in message:
            raise McpProtocolError(f"MCP response for {method} omitted result")
        return message["result"]
