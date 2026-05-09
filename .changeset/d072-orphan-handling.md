---
'@atrib/mcp': patch
'@atrib/emit': patch
---

[D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail): orphan handling, synthesize fresh, never inherit from mirror tail.

When `inheritChainContext` was called with no `callerContextId`, the prior implementation read the mirror tail and inherited BOTH the most-recent record's `context_id` AND its hash as the new record's `chain_root` (label: `'mirror-context-and-tail'`). In production, runtime miswires that failed to thread session_id caused every orphan record to absorb into whichever session was at the tail, producing pseudo-sessions that accumulated 1500+ unrelated records under one `context_id`.

`@atrib/mcp` now collapses `inheritChainContext` branch (3): when no `callerContextId` is supplied, the producer synthesizes a fresh random `context_id` and a genesis `chain_root`. The result is marked `inheritedFrom = 'fresh-orphan'` so consumers can identify orphans. The `'mirror-context-and-tail'` label is removed from the `ChainContext` union; producers MUST NOT consult the mirror tail for `context_id` inheritance. Producers that want orphan clustering for forensic reasons MAY cache a per-process synthetic and reuse it.

`@atrib/emit` adds a warning when `inheritedFrom === 'fresh-orphan'` so operators can trace the upstream runtime miswire (typically a Layer-2 hook that didn't pass session_id through). The warning text includes the synthesized `context_id` and a hint to fix the runtime per [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail).

Tests updated:
- `packages/mcp/test/mirror.test.ts`: the test that asserted the buggy mirror-tail inheritance now asserts orphan synthesis with a different `context_id` even when a tail exists.
- `services/atrib-emit/test/integration.test.ts`: replaced the autoChain-via-mirror test (which relied on the removed branch) with two tests, one for the canonical caller-managed-context_id path (`mirror-tail` branch), one for orphan isolation (two orphan emits land in different contexts).

Layer-2 hook miswires remain the runtime-side fix path. This change does NOT relax the requirement that runtimes pass session identifiers properly; it changes what happens when they don't, surfacing orphans as visible isolates rather than silent absorption. Sidecar tagging (`_local.fallback: 'orphan'` per [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)) MAY be added by producers as polish; not implemented yet.
