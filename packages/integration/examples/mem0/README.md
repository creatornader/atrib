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

To smoke a successful real-package add/search cycle, run:

```bash
pnpm --filter @atrib/integration mem0-oss-full-cycle-smoke
```

That smoke imports `Memory` from `mem0ai/oss`, starts a local
OpenAI-compatible provider, lets mem0's extraction branch write to the in-memory
vector store, then searches the stored memory through `attributeMem0Memory()`.
It proves the wrapper signs both `mem0.memory.add` and `mem0.memory.search`
records, verifies those records, preserves mem0's normal result values, and
keeps private message text out of public records. It does not need an OpenAI
key, Mem0 API key, vector database, or hosted service.

To smoke the hosted-client shape without hitting Mem0 production, run:

```bash
pnpm --filter @atrib/integration mem0-client-smoke
```

That smoke imports the real `MemoryClient` from `mem0ai`, starts a local
Mem0-shaped API for `ping`, `add`, and `search`, then calls the client through
`attributeMem0Memory()`. It proves the same hash-only signing posture works for
platform-client `MemoryClient.add()` and `MemoryClient.search()` boundaries,
while preserving the client return values. It does not need a Mem0 API key and
does not call the hosted Mem0 service.

To smoke the Python OSS `Memory` shape without an external model provider, run:

```bash
pnpm --filter @atrib/integration mem0-python-oss-smoke
```

That smoke runs Python `mem0ai==2.0.4` through `uv`, starts a local
OpenAI-compatible provider, calls the real Python `Memory.add()` and
`Memory.search()` paths against a local Qdrant store, then signs host-side
atrib records for `mem0.python.memory.add` and `mem0.python.memory.search`.
It proves the Python OSS boundary can be recorded as hash-only atrib history
while the raw memory payload stays in local sidecars. It does not need an
OpenAI key, Mem0 API key, vector database server, or hosted service.

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
- The real `mem0ai/oss` package can complete an add/search cycle through a
  local OpenAI-compatible provider while atrib signs the public hash-only
  records.
- The real `mem0ai` platform client can call a Mem0-shaped add/search API while
  atrib signs the same hash-only boundary and preserves return values.
- The real Python `mem0ai` OSS `Memory` class can complete add/search through a
  local provider while host-side atrib signing records hash-only operations.
- Signing errors never break the underlying memory call.
- Public signed records disclose `mem0.memory.add` / `mem0.memory.search`,
  `args_hash`, and `result_hash`, not private memory bodies.
- Local sidecars preserve the raw add/search shape for the operator who is
  debugging poisoning, silent loss, recall quality, or search filters.

## What it does not prove yet

This is a TypeScript proof, not a Python SDK release and not a production hosted
Mem0 integration. The compatibility smoke reaches the real `mem0ai/oss` add
path, the full-cycle smoke proves a successful local-provider add/search path,
the client smoke reaches the real `MemoryClient` request shape against a local
Mem0-shaped API, and the Python smoke reaches Python `mem0.Memory.add()` /
`mem0.Memory.search()` with host-side signing. The proof still does not cover a
Python atrib package release, a real hosted Mem0 account, or a real model
provider. A Python SDK slice, real hosted-account proof, or explicit approval
for TypeScript-plus-Python-OSS framing should come before asking mem0
maintainers to review it as an official recipe.
