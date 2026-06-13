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
  --json
```

Streamable HTTP mode keeps one host-owned process alive and lets MCP clients for the same agent profile connect to the same loopback endpoint. The host exposes:

- MCP endpoint: `http://127.0.0.1:8796/mcp`
- health endpoint: `http://127.0.0.1:8796/mcp/health`

The HTTP host creates one mounted primitive backend per host process, gives each MCP client its own Streamable HTTP session transport, closes idle sessions after 12 hours by default, and never spawns the seven standalone primitive binaries.

The health report includes the profile's context policy. Set `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID=1` on hosts that should refuse write-primitive calls when neither the caller nor the harness can provide a `context_id`. The write primitives then return a warnings-only response instead of signing a synthesized orphan context.

## Run As A Stdio Proxy

```sh
node services/atrib-primitives/dist/index.js \
  --transport stdio-http-proxy \
  --endpoint http://127.0.0.1:8796/mcp
```

Proxy mode speaks MCP over stdio to the client, connects to the host-owned Streamable HTTP endpoint, lists the upstream tools, and forwards tool calls. It does not mount the primitive packages itself. Use it for stdio-only clients such as Claude Desktop or Claude Code when the real primitive backend should stay in one launchd-owned HTTP process.

## Test

```sh
pnpm --filter @atrib/primitives-runtime test
```

The protocol test lists all 15 tools over stdio, routes a recall call through the combined server, repeats the path through Streamable HTTP, checks the stdio proxy path, verifies that two HTTP sessions share one mounted primitive backend, and asserts the health contract for explicit-context profiles.
