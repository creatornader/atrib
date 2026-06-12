# @atrib/primitives-runtime

Private local MCP runtime for atrib dogfood.

`atrib-primitives` mounts the seven public cognitive-primitive MCP packages in process and exposes their 15 physical tools through one MCP server. It supports stdio for compatibility and Streamable HTTP for host-owned dogfood configs that should share one primitive runtime across active threads for the same agent profile.

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

The HTTP host creates one in-process primitive runtime per MCP session, closes idle sessions after 12 hours by default, and never spawns the seven standalone primitive binaries.

## Test

```sh
pnpm --filter @atrib/primitives-runtime test
```

The protocol test lists all 15 tools over stdio, routes a recall call through the combined server, then repeats the tool-list and recall path through Streamable HTTP.
