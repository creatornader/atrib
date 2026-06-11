# @atrib/primitives-runtime

Private local MCP runtime for atrib dogfood.

`atrib-primitives` mounts the seven public cognitive-primitive MCP packages in process and exposes their 15 physical tools through one stdio server. Use it for local harness configs that would otherwise spawn one atrib child process per primitive for every active thread.

It does not replace the public packages. `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`, and `@atrib/verify-mcp` remain the published surfaces. This package is private and exists to reduce local process bloat in dogfood configs.

## Build

```sh
pnpm --filter @atrib/primitives-runtime build
```

## Run

```sh
node services/atrib-primitives/dist/index.js
```

The server speaks MCP over stdio. A host should configure this binary instead of the seven standalone primitive binaries when it wants one local atrib primitive process per thread.

## Test

```sh
pnpm --filter @atrib/primitives-runtime test
```

The protocol test lists all 15 tools and routes a recall call through the combined server.
