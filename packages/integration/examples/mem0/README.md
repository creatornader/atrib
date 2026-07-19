# mem0 action evidence examples

These examples add signed action evidence around mem0 without changing its
storage or retrieval behavior. One covers mutations that need a policy decision
and a state check. The other records `add()` and `search()` calls as hash-only
atrib history.

## Mutation assurance

Run the real-package mutation proof:

```bash
pnpm --filter @atrib/integration mem0-mutation-assurance
```

The smoke imports `Memory` from `mem0ai/oss@3.1.0` and uses its in-memory vector
store with a local OpenAI-compatible embedding endpoint. It then runs four
operations against the real SDK:

- Add a memory under `tenant-a`.
- Block an update that tries to set `user_id` through freeform metadata. The
  mem0 update body never runs.
- Allow an ordinary text and metadata update, then read the memory back and
  check the text, metadata, and tenant scope.
- Delete the memory, then check that `get()` returns `null`.

`runMem0MutationAssurance()` signs the host policy decision before each
mutation. After an allowed call, it signs the operation result together with a
sanitized postcondition. A caller can therefore distinguish three cases: a
blocked action, a failed call, and a call that reported success but did not
produce the expected state.

Identity scope and approval authority stay with the host. The example policy
treats `actor_id`, `user_id`, `agent_id`, and `run_id` as protected fields when
they appear inside update metadata. Applications can supply another policy to
the helper.

The postcondition contains check names and booleans. Memory text remains in the
local action sidecar. Public records contain hashes that commit to the private
arguments and sanitized result.

## Add and search attribution

The add/search wrapper targets the `Memory.add()` and `Memory.search()` boundary
documented by mem0's Node SDK through `mem0ai/oss`.

The wrapper does not replace mem0 storage, extraction, ranking, or return
values. It signs a hash-only atrib `tool_call` record around each add and search
call, then keeps the raw messages, filters, and results in the local sidecar for
the developer who owns the memory system.

### Run the fixture

```bash
pnpm --filter @atrib/integration mem0-wrapper-demo
```

The demo uses a small mem0-shaped memory fixture so it runs without an OpenAI
key, Mem0 API key, vector database, or hosted service. The fixture is deliberate:
it proves the wrapper boundary, record signatures, result pass-through, and
privacy posture without making a network call.

### Run the real OSS package

To exercise the same wrapper against the real mem0 OSS Node package, run:

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

To run a successful real-package add/search cycle, use:

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

### Run the hosted-client shape

To exercise the hosted-client shape without hitting Mem0 production, run:

```bash
pnpm --filter @atrib/integration mem0-client-smoke
```

That smoke imports the real `MemoryClient` from `mem0ai`, starts a local
Mem0-shaped API for `ping`, `add`, and `search`, then calls the client through
`attributeMem0Memory()`. It proves the same hash-only signing posture works for
platform-client `MemoryClient.add()` and `MemoryClient.search()` boundaries,
while preserving the client return values. It does not need a Mem0 API key and
does not call the hosted Mem0 service.

### Run the Python OSS shape

To exercise the Python OSS `Memory` shape without an external model provider,
run:

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

### Use the add/search wrapper

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

## What the examples prove

- The real `mem0ai/oss@3.1.0` package can run a policy-gated update and a
  read-back-verified delete.
- Freeform metadata that contains an identity-scope field can be blocked before
  the mem0 mutation executes.
- An allowed mutation carries a signed postcondition, so a success response and
  the resulting state remain separate facts.
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

## Boundaries

Mem0 continues to own extraction, storage, history, and retrieval. Its internal
tracing can explain which phases ran and where time was spent. atrib records the
host's pre-action decision and commits to the resulting state check. The two
surfaces answer different questions and can run together.

The host still owns identity, authorization, policy, and any approval UI. atrib
records what that host decided and what its postcondition observed.

## Limits

The mutation smoke does not reproduce the reported Python Qdrant reset failure.
It proves the TypeScript host pattern that would expose a false success when the
read-back check fails. The examples do not cover a production hosted Mem0
account or a real model provider. The Python add/search smoke signs from the
host; it is not a Python atrib package release.
