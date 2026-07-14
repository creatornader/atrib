# atribd

Local daemon for atrib. Serves the two-verb cognitive surface plus the
legacy alias tools from one stateless-native process over Streamable HTTP
or stdio.

Per the attest/recall rename
([D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)),
atribd mounts three primitives in process: the `attest` write home
(`@atrib/attest`), the `recall` read home (`@atrib/recall`), and
`@atrib/summarize`. Together they serve the seventeen-tool union: the
fifteen legacy tool names plus `attest` plus `recall`. A record signed
through the daemon is byte-identical to one signed through the standalone
per-primitive binary: same handler code paths, same `_local.producer`
sidecar labels, same `resolveChainRoot` chain selection. The daemon is the
recommended local topology; the standalone binaries keep shipping and keep
working.

## Install

Published as `@atrib/daemon`; the daemon and its binary are named `atribd`:

```sh
npm install -g @atrib/daemon
atribd --help
```

Or run without installing:

```sh
npx --package @atrib/daemon atribd --help
```

From the workspace (development):

```sh
pnpm --filter @atrib/daemon... build
node services/atribd/dist/index.js --help
```

## Quick start

One daemon per profile ([D120](../../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) partition axis). Start the HTTP daemon:

```sh
atribd --transport streamable-http --port 8796 --json
```

Point an MCP client at `http://127.0.0.1:8796/mcp`. Startup-spawn harnesses
that can only spawn stdio children use the proxy shim:

```sh
atribd --transport stdio-http-proxy --endpoint http://127.0.0.1:8796/mcp
```

Direct stdio (no shared daemon) also works:

```sh
atribd
```

Health lives at `<endpoint>/health` and carries the [D127](../../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness)-[D130](../../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) gates: recall
contract freshness, per-package tool-surface contracts, non-mutating
behavioral probes (write primitives stay skipped), plus request counters.
There is no `sessions` block; the daemon has no sessions.

## Stateless transport

Every HTTP request is self-describing and any request can land on any
instance:

- No `initialize` handshake is required. A legacy `initialize` POST gets a
  valid response with no session id issued; a legacy `Mcp-Session-Id` header
  is ignored, never a 404.
- `Mcp-Method` / `Mcp-Name` routing headers (SEP-2243) are validated against
  the body when present; a mismatch is HTTP 400 with nothing routed.
- Inbound context carriers travel in per-request `_meta` (SEP-414) and
  resolve through the spec [§1.5.4](../../atrib-spec.md#154-mcp-transport-params_meta) ladder with the [§1.5.3](../../atrib-spec.md#153-http-fallback-x-atrib-chain) `X-Atrib-Chain`
  fallback.
- `tools/list` responses carry `ttlMs` and `cacheScope` (SEP-2549) so clients
  can cache the tool catalogue. The default `ttlMs` is 5 minutes during the
  alias window (operator-tunable via `--tools-list-ttl-ms` /
  `ATRIBD_TOOLS_LIST_TTL_MS`).

The transport binding sits behind an adapter
(`src/transport-adapter.ts`). The current adapter runs the session-era MCP
TypeScript SDK in its documented stateless mode; when the SDK ships native
stateless-transport support, the adapter internals swap and nothing above
the boundary changes.

## Context identity on HTTP

Write primitives require an explicit context per request:

1. An explicit 32-hex `context_id` tool argument wins.
2. Otherwise the daemon resolves the inbound `_meta` carriers; a resolved
   trace context injects `context_id`, and a resolved propagation token
   seeds `chain_root` on tools that accept it.
3. Otherwise the write returns a typed tool error:
   `atrib: context_id required on stateless transport`.

Read primitives that support unscoped queries proceed per their own scope
rules. A single-tenant daemon can opt back into ambient env and profile-file
discovery ([D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)) with `--ambient-context` or `ATRIBD_AMBIENT_CONTEXT=1`;
the flag name is a
[D148](../../DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime)
open question. The stdio surfaces keep the ambient ladder unchanged.

## Write serialization

The daemon serializes calls to any write-union tool name (`attest`, `emit`,
`atrib-annotate`, `atrib-revise`) per resolved `context_id`: read-tail,
sign, append runs one writer at a time per context, so concurrent writes
routed through one daemon, regardless of which tool name the caller used,
yield a linear chain. Writers that append to the mirror corpus without
routing through the daemon sit outside this boundary and can still fork a
chain; the `spec/conformance/atribd/cases/concurrent-writer-serialization/`
family pins both sides of that line.

## Degradation

The [§5.8](../../atrib-spec.md#58-degradation-contract) contract is absolute. Log submission, mirror writes, and health
probing fail silently with `atrib:`-prefixed logging and never block a
primary tool call. With the log endpoint unreachable, a write still returns
a signed `record_hash` and the record lands in the local mirror. Probe and
call timeouts degrade the health report; they never kill the process. The
daemon binds `127.0.0.1` by default and is never a public service; the key
and mirror stay on the host.

## Migration from @atrib/primitives-runtime

- **LaunchAgents.** Migrate through the [D128](../../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe) updater:
  `node scripts/update-primitives-runtime.mjs --runtime atribd`. It discovers
  `com.nader.atribd.*` LaunchAgents running this package's `dist/index.js`,
  builds the dependency closure, restarts, probes health and the direct MCP
  surface, and gates on the daemon health shape. The topology gate reports
  skipped until the operator cutover, because the topology scripts still
  read the legacy shape.
- **Deprecated session flags.** `--session-idle-ms` and
  `ATRIB_PRIMITIVES_SESSION_IDLE_MS` are accepted and ignored with a
  one-line stderr notice, never a fatal error. The stateless daemon has no
  sessions to expire.
- **Environment.** `ATRIBD_*` variables take precedence; the legacy
  `ATRIB_PRIMITIVES_HTTP_HOST` / `_PORT` / `_PATH` / `_TOOL_TIMEOUT_MS`
  values are honored so existing LaunchAgent plists migrate without config
  churn. `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID` is redundant on HTTP (explicit
  is the default) and keeps its meaning on stdio.
- **Old MCP clients.** Session-era clients work through the
  legacy-initialize window on HTTP, or through the stdio shim indefinitely.
- **Rollback.** Re-point the harness MCP config at the per-primitive
  binaries or at `atrib-primitives`. Rollback is a config change, not a data
  migration; no signed byte differs between the topologies.

## Verify locally

```sh
pnpm --filter @atrib/daemon... build
pnpm --filter @atrib/daemon test
```

The test suite includes the reference tests for
[`spec/conformance/atribd/`](../../spec/conformance/atribd/), which pin the
stateless transport contract, routing-header rejection, the context ladder,
record byte parity across surfaces, health gates, degradation posture, and
write serialization.
