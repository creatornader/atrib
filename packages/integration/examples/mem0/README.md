# mem0 boundary attribution example

This example wraps the `Memory.add()` and `Memory.search()` boundary that mem0's
Node SDK documents through `mem0ai/oss`.

The wrapper does not replace mem0 storage, extraction, ranking, or return
values. It signs a hash-only atrib `tool_call` record around each add and search
call, then keeps the raw messages, filters, and results in the local sidecar for
the developer who owns the memory system.

## Run it

```bash
pnpm --filter @atrib/integration mem0-wrapper-demo
```

The demo uses a small mem0-shaped memory fixture so it runs without an OpenAI
key, Mem0 API key, vector database, or hosted service. The fixture is deliberate:
it proves the wrapper boundary, record signatures, result pass-through, and
privacy posture without making a network call.

To smoke the same wrapper against the real mem0 OSS Node package, run:

```bash
pnpm --filter @atrib/integration mem0-oss-compat-smoke
```

The compatibility smoke imports `Memory` from `mem0ai/oss`, starts a local
OpenAI-shaped provider that rejects requests, and calls the real `Memory.add()`
path through `attributeMem0Memory()`. The expected provider failure is part of
the check: atrib signs the `mem0.memory.add` boundary, preserves mem0's thrown
error, keeps private message text out of the public record, and stores the raw
request shape only in the local sidecar. It does not need an OpenAI key, Mem0
API key, vector database, or hosted service.

## Use it with mem0

The same wrapper targets the public `add` and `search` shape:

```ts
import { Memory } from 'mem0ai/oss'
import { attributeMem0Memory } from '../../src/mem0-attribution.js'

const mem0 = new Memory()
const memory = attributeMem0Memory(mem0, {
  privateKey: process.env.ATRIB_PRIVATE_KEY,
})

await memory.add(messages, {
  userId: 'alice',
  metadata: { category: 'movie_recommendations' },
})

const results = await memory.search('What do you know about me?', {
  filters: { userId: 'alice' },
})
```

## What it proves

- `add()` and `search()` return the same values as the wrapped memory object.
- The real `mem0ai/oss` package can run through the signed `add()` boundary
  without changing mem0's thrown error.
- Signing errors never break the underlying memory call.
- Public signed records disclose `mem0.memory.add` / `mem0.memory.search`,
  `args_hash`, and `result_hash`, not private memory bodies.
- Local sidecars preserve the raw add/search shape for the operator who is
  debugging poisoning, silent loss, recall quality, or search filters.

## What it does not prove yet

This is a Node boundary proof, not a Python SDK release and not a mem0-hosted
integration. The compatibility smoke reaches the real `mem0ai/oss` add path,
but it stops at the local provider denial. A successful extraction and search
cycle, a Python `atrib-py` slice, or both should come before asking mem0
maintainers to review it as an official recipe.
