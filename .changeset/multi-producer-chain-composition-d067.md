---
"@atrib/mcp": minor
"@atrib/emit": patch
---

Multi-producer chain composition contract (D067 / spec §1.2.3.1).

`@atrib/mcp` exports two new helpers that single-source chain-root resolution across all atrib producers signing under one identity:

- `resolveChainRoot` gains a fourth-priority `mirrorTailHex` parameter for cross-producer mirror-file inheritance. The priority cascade is now: inbound propagation token > within-process auto-chain tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > mirror-file tail (caller pre-filters by context_id) > synthetic genesis.
- `inheritChainContext` orchestrates context_id inheritance + mirror file I/O end to end, calling `resolveChainRoot` internally. Producers omitting `callerContextId` inherit both context and chain from the mirror's most recent record; producers supplying `callerContextId` consult env-var → mirror tail (filtered to that context) → genesis. The mirror filter-by-context_id invariant blocks malformed records that would chain into a different context's chain.
- New `readMirrorTail({path, contextId?})` reads JSONL mirror files in both bare-record and envelope shapes, optionally filtering by `context_id`.

`atrib-emit` deletes its local `auto-chain.ts` resolver and calls `inheritChainContext` from `@atrib/mcp`. Pre-fix, the local resolver short-circuited on caller-supplied `context_id` and never consulted `ATRIB_CHAIN_TAIL_<context_id>`, producing isolated genesis records on every hook-spawned emit. The duplication is eliminated; future cognitive-primitive producers (`atrib-recall`, `atrib-trace`, `atrib-summarize`) and any third-party producer MUST use `resolveChainRoot` or replicate it bit-for-bit against the corpus.

Conformance corpus at `spec/conformance/1.2.3/multi-producer/` covers the precedence cascade plus malformed env-var fall-through and namespace isolation. Producers in any language can consume the JSON and assert their resolver matches the expected `chain_root` per case. Reference test at `packages/mcp/test/conformance-1.2.3-multi-producer.test.ts`. Co-producer regression test at `services/atrib-emit/test/co-producer-chain.test.ts` exercises the full chain through the emit handler with simulated cross-producer state.

The `inheritedFrom` value returned by `inheritChainContext` gains two new variants: `'env-tail'` and `'mirror-tail'` (replacing the prior `'wrapper-mirror'`); consumers reading the value must handle them.
