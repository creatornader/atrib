# @atrib/primitives-runtime

Private local MCP runtime for atrib dogfood.

`atrib-primitives` mounts the seven public cognitive-primitive MCP packages in process and exposes their 15 physical tools through one local runtime. It supports direct stdio for compatibility, Streamable HTTP for host-owned dogfood configs that should share one primitive backend across active threads for the same agent profile, and stdio-to-HTTP proxy mode for clients that only support stdio MCP.

It does not replace the public packages. `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`, and `@atrib/verify-mcp` remain the published surfaces. This package is private and exists to reduce local process bloat in dogfood configs.

## Build

```sh
pnpm --filter @atrib/primitives-runtime build
```

## Run With Stdio

```sh
node services/atrib-primitives/dist/index.js
```

The default server speaks MCP over stdio. A host can configure this binary instead of the seven standalone primitive binaries when it wants one local atrib primitive process per thread.

## Run With Streamable HTTP

```sh
node services/atrib-primitives/dist/index.js \
  --transport streamable-http \
  --host 127.0.0.1 \
  --port 8796 \
  --path /mcp \
  --tool-timeout-ms 45000 \
  --json
```

Streamable HTTP mode keeps one host-owned process alive and lets MCP clients for the same agent profile connect to the same loopback endpoint. The host exposes:

- MCP endpoint: `http://127.0.0.1:8796/mcp`
- health endpoint: `http://127.0.0.1:8796/mcp/health`

The HTTP host creates one mounted primitive backend per host process, gives each MCP client its own Streamable HTTP session transport, closes idle sessions after 12 hours by default, and never spawns the seven standalone primitive binaries.

The HTTP listener binds before the backend finishes mounting. During that window the health endpoint returns HTTP 503 with `status: "starting"` and `primitive_runtime.backend: "starting"` instead of refusing the connection. Once the seven primitive packages are mounted, health returns HTTP 200 with `status: "healthy"` and `primitive_runtime.backend: "shared"`. The `--json` ready line is still printed only after the shared backend is ready.

Each primitive tool dispatch has a runtime deadline. The default is 45 seconds and can be changed with `--tool-timeout-ms` or `ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS`. If a child primitive call crosses the deadline, the runtime returns an MCP timeout before the client-level deadline, logs a structured `tool_call_timed_out` event on stderr, and keeps the underlying call visible in health until it settles. During that window health stays HTTP 200 but reports `status: "degraded"` with `report.tool_calls.active_tool_calls`, `calls_timed_out`, and `in_flight_tool_calls`.

Health also reports `report.primitive_runtime.recall_contract`. A healthy host must show `status: "pass"`, `coverage_version: "coverage-v1"`, and `content_index_version: "content-index-v1"` for `@atrib/recall`. Missing or stale recall contract metadata makes the host report `status: "degraded"` so stale long-lived MCP hosts do not look ready after source or npm has already moved forward.

The health report includes the profile's context policy. Set `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID=1` on hosts that should refuse write-primitive calls when neither the caller nor the harness can provide a `context_id`. The write primitives then return a warnings-only response instead of signing a synthesized orphan context.

## Run As A Stdio Proxy

```sh
node services/atrib-primitives/dist/index.js \
  --transport stdio-http-proxy \
  --endpoint http://127.0.0.1:8796/mcp
```

Proxy mode speaks MCP over stdio to the client, connects to the host-owned Streamable HTTP endpoint, lists the upstream tools, and forwards tool calls. It does not mount the primitive packages itself. Use it for stdio-only clients such as Claude Desktop or Claude Code when the real primitive backend should stay in one launchd-owned HTTP process.

Proxy mode uses the same tool timeout setting as the host runtime. The shared host should normally return first, but the proxy will also return a clean MCP timeout if it points at an older or wedged endpoint.

## Test

```sh
pnpm --filter @atrib/primitives-runtime test
```

The protocol test lists all 15 tools over stdio, routes a recall call through the combined server, repeats the path through Streamable HTTP, checks the stdio proxy path, verifies that two HTTP sessions share one mounted primitive backend, checks the starting health state, asserts the health contract for explicit-context profiles and recall content-index support, and proves a hung child primitive returns a bounded timeout while health reports the stuck in-flight call.
