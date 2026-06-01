# @atrib/memory-tool

Verifiable backend wrapper for Anthropic's Memory Tool.

Anthropic's Memory Tool is client-side: the application chooses where memory
files live and implements handlers for `view`, `create`, `str_replace`,
`insert`, `delete`, and `rename`. `@atrib/memory-tool` wraps those handlers and
signs memory commands as atrib `tool_call` records while leaving the storage
backend alone.

## Install

```bash
pnpm add @atrib/memory-tool @atrib/mcp @anthropic-ai/sdk
```

## Quick start

```ts
import { betaMemoryTool } from '@anthropic-ai/sdk/helpers/beta/memory'
import { BetaLocalFilesystemMemoryTool } from '@anthropic-ai/sdk/tools/memory/node'
import { createAtribMemoryTool } from '@atrib/memory-tool'

const fsMemory = await BetaLocalFilesystemMemoryTool.init('./memory')
const memory = betaMemoryTool(
  await createAtribMemoryTool(fsMemory, {
    privateKey: process.env.ATRIB_PRIVATE_KEY,
    contextId: '4bf92f3577b34da6a3ce929d0e0e4736',
  }),
)

// Pass `memory` to `client.beta.messages.toolRunner({ tools: [memory], ... })`.
```

## What gets signed

By default the wrapper signs mutating commands:

- `create`
- `str_replace`
- `insert`
- `delete`
- `rename`

Set `signReads: true` to sign `view` commands too.

Each signed record carries:

- `tool_name`: `anthropic.memory.<command>`
- `args_hash`: JCS SHA-256 of the command payload
- `result_hash`: JCS SHA-256 of `{ status, result }` or `{ status, error }`
- `context_id`: caller-supplied or process-local
- `chain_root`: resolved with the shared `@atrib/mcp` chain-root helper

The signed record does not store memory file contents. It commits to them by
hash so the application can keep the memory body in its own store, local mirror,
or archive policy.

## Offline and test mode

```ts
const records = []
const memory = await createAtribMemoryTool(handlers, {
  privateKey,
  logSubmission: 'disabled',
  onRecord: (record) => records.push(record),
})
```

`logSubmission: 'disabled'` still signs records and calls `onRecord`; it only
skips public log submission.

If neither `privateKey` nor `ATRIB_PRIVATE_KEY` is configured, the wrapper
passes commands through to the underlying handlers without signing. An invalid
key has the same pass-through behavior. Memory operations must not fail because
the atrib layer is missing or misconfigured.

## Smoke test

The package includes a local smoke script that wraps Anthropic's filesystem
handler, runs `create`, `str_replace`, `view`, and `delete`, then verifies each
signed record offline.

```bash
pnpm --filter @atrib/memory-tool smoke
```

## Caveat

This package wraps Anthropic's TypeScript handler shape from
`@anthropic-ai/sdk@0.100.1`. The Memory Tool is a beta surface, so callers should
pin the SDK version they test against.
