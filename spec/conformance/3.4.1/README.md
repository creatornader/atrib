# atrib spec [§3.4.1.1](../../../atrib-spec.md#3411-intra-session-edge-compaction) conformance corpus

Test fixtures for intra-session edge compaction per spec [§3.4.1.1](../../../atrib-spec.md#3411-intra-session-edge-compaction).

The corpus is the shared contract between every implementation that emits SESSION_PRECEDES / SESSION_PARALLEL edges from a graph endpoint. Compaction is information-preserving with respect to the partial order over the resolved record set: any "happens-before" relation derivable from the full pairwise edge set ([§3.2.4](../../../atrib-spec.md#324-edge-derivation-rules) steps 2–3) is still derivable from the compacted edge set plus CHAIN_PRECEDES transitivity. Both `?compact=true` (default) and `?compact=false` MUST be accepted by conformant `/v1/graph/<context_id>` implementations.

Full, non-compacted edge derivation is covered by [`../3.2.4/`](../3.2.4/).

## Cases

| File                                                  | Asserts                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cases/fully-chained-skip-redundant.json`             | Chain-component skip. Five records forming a single CHAIN_PRECEDES connected component within one context_id. Compact derivation emits the four CHAIN_PRECEDES links and zero SESSION_PRECEDES / SESSION_PARALLEL edges (the chain already encodes temporal order; additional intra-component edges would carry no information). |
| `cases/fully-unchained-adjacent-only.json`            | Adjacent-only emission. Five isolated-genesis records sharing one context_id with no chain links. Compact derivation emits SESSION_PRECEDES only between consecutive-in-time pairs (4 edges), down from N\*(N-1)/2 = 10 in the all-pairs derivation.                                                                             |
| `cases/mixed-chains-cross-component-only.json`        | Cross-component bridge. Two parallel chains in one context_id. Compact derivation emits CHAIN_PRECEDES within each chain plus exactly one SESSION_PRECEDES at the cross-component boundary.                                                                                                                                      |
| `cases/equal-timestamp-parallel-cross-component.json` | Equal-timestamp SESSION_PARALLEL. Two unchained-genesis records sharing one context_id and one timestamp. Compact derivation emits one SESSION_PARALLEL edge (different chain components, equal timestamps). The shape is deterministic regardless of any hash-tiebreak order applied to the time-sort.                          |

## Tiebreak invariant

Conformance cases MUST stay tiebreak-agnostic: any expected SESSION_PRECEDES / SESSION_PARALLEL edge whose endpoints depend on hash sort ordering invalidates portability across language implementations. Cases that would require a specific hash-tiebreak (for example, multiple equal-timestamp pairs across chain components where the adjacent walk's neighbor depends on sort order) are reduced to undirected SESSION_PARALLEL pairs at the same timestamp, which match regardless of tiebreak.

## Generator

[`packages/log-dev/scripts/generate-conformance-3.4.1.ts`](../../../packages/log-dev/scripts/generate-conformance-3.4.1.ts). Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.4.1.ts
```

## Reference tests

- [`services/graph-node/test/conformance-3.4.1.test.ts`](../../../services/graph-node/test/conformance-3.4.1.test.ts), runs each case through `services/graph-node/src/graph-builder.ts`.
- [`packages/integration/test/conformance-3.2.4.test.ts`](../../../packages/integration/test/conformance-3.2.4.test.ts) (`§3.4.1.1 corpus: both impls agree on all 4 cases`), runs each case through BOTH `services/graph-node` and `packages/integration/src/graph-builder.ts`, asserting the impls produce identical edge sets.
