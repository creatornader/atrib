# @atrib/primitives-runtime

Private local MCP runtime for atrib's verifiable action layer dogfood.

Per the attest/recall rename ([D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)), `atrib-primitives` mounts three primitives in process: the `attest` write home (`@atrib/attest`), the `recall` read home (`@atrib/recall`), and `@atrib/summarize`. Together they serve the seventeen-tool union (fifteen legacy tool names plus `attest` plus `recall`) through one local runtime. It supports direct stdio for compatibility, Streamable HTTP for host-owned dogfood configs that should share one primitive backend across active threads for the same agent profile, and stdio-to-HTTP proxy mode for clients that only support stdio MCP.

It does not replace the public packages. `@atrib/attest`, `@atrib/recall`, and `@atrib/summarize` remain the published surfaces; `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, and `@atrib/verify-mcp` remain published as legacy re-export shims. This package is private and exists to reduce local process bloat in dogfood configs. It is superseded as the recommended local topology by `@atrib/daemon` (`services/atribd/`, binary `atribd`) per [D148](../../DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime); it is retained for compatibility and test coverage.

## Build

```sh
pnpm --filter @atrib/primitives-runtime build
```

## Run With Stdio

```sh
node services/atrib-primitives/dist/index.js
```

The default server speaks MCP over stdio. A host can configure this binary instead of the three standalone primitive binaries when it wants one local atrib primitive process per thread.

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

The HTTP host creates one mounted primitive backend per host process, gives each MCP client its own Streamable HTTP session transport, closes idle sessions after 12 hours by default, and never spawns the three standalone primitive binaries.

The HTTP listener binds before the backend finishes mounting. During that window the health endpoint returns HTTP 503 with `status: "starting"` and `primitive_runtime.backend: "starting"` instead of refusing the connection. Once the three primitive packages are mounted, health returns HTTP 200 with `status: "healthy"` and `primitive_runtime.backend: "shared"`. The `--json` ready line is still printed only after the shared backend is ready.

Each primitive tool dispatch has a runtime deadline. The default is 45 seconds and can be changed with `--tool-timeout-ms` or `ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS`. If a child primitive call crosses the deadline, the runtime returns an MCP timeout before the client-level deadline, logs a structured `tool_call_timed_out` event on stderr, and keeps the underlying call visible in health until it settles. During that window health stays HTTP 200 but reports `status: "degraded"` with `report.tool_calls.active_tool_calls`, `calls_timed_out`, and `in_flight_tool_calls`.

Health reports `report.primitive_runtime.primitive_contracts` for all three mounted primitives (`attest`, `recall`, `summarize`), plus the legacy alias tool names each one mounts. Each contract includes the mounted package version, expected and mounted tool names, missing or unexpected tools, whether normal calls mutate the log, and the probe mode used by the updater. Health also reports `report.primitive_runtime.behavioral_probes`. The runtime calls deterministic non-mutating probes for `recall`, `trace`, `summarize`, and `verify`; it reports `emit`, `atrib-annotate`, and `atrib-revise` as skipped until those write primitives expose validate-only contracts. Health still reports `report.primitive_runtime.recall_contract` for recall's content-index contract. Missing or stale primitive contract metadata, or a failed read-only behavioral probe, makes the host report `status: "degraded"` so stale long-lived MCP hosts do not look ready after source or npm has already moved forward.

The health report includes the profile's context policy. Set `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID=1` on hosts that should refuse write-primitive calls when neither the caller nor the harness can provide a `context_id`. The write primitives then return a warnings-only response instead of signing a synthesized orphan context.

## Update Host-Owned LaunchAgents

After changing any mounted primitive package or `@atrib/primitives-runtime`, update the local host-owned Streamable HTTP runtimes with:

```sh
pnpm update:primitives-runtime
```

The command discovers `com.nader.atrib-primitives.*` LaunchAgents that run this checkout, builds the `@atrib/primitives-runtime` dependency closure, restarts the selected services, checks every primitive package/tool contract, validates the health-reported behavioral probes, lists the live MCP tool surface, calls `recall_by_content` over MCP Streamable HTTP, and fails if the tool result lacks `runtime.content_index_version` or `coverage.index`.

The updater does not call `emit`, `atrib-annotate`, or `atrib-revise` as health probes because normal calls sign records. Those write primitives are verified through package version and tool-surface contracts, with explicit skipped probe diagnostics, until they expose validate-only semantics.

Useful bounded forms:

```sh
pnpm update:primitives-runtime -- --profile codex
pnpm update:primitives-runtime -- --skip-build --skip-restart
pnpm update:primitives-runtime -- --dry-run
```

The script refuses to manage a LaunchAgent whose plist points at another checkout, a non-loopback endpoint, or a non-Streamable HTTP transport.

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

The protocol test lists all seventeen tools over stdio, routes a recall call through the combined server, repeats the path through Streamable HTTP, checks the stdio proxy path, verifies that two HTTP sessions share one mounted primitive backend, checks the starting health state, asserts the health contract for explicit-context profiles, every primitive surface, deterministic non-mutating behavioral probes, and recall content-index support, and proves a hung child primitive returns a bounded timeout while health reports the stuck in-flight call. `pnpm doc-sync` also runs `scripts/check-primitives-runtime-update.mjs` so the LaunchAgent selection, primitive surface, behavioral probe, and direct recall payload contracts stay covered.
