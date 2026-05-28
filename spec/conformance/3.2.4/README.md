# atrib spec [§3.2.4](../../../atrib-spec.md#324-edge-derivation-rules) conformance corpus

Language-neutral fixtures for the full graph edge derivation rules.

The compact intra-session corpus at [`../3.4.1/`](../3.4.1/) covers the reduced `/v1/graph/{context_id}` response shape. This corpus covers full [§3.2.4](../../../atrib-spec.md#324-edge-derivation-rules) derivation with `compactIntraSessionEdges` off.

## Cases

| File                                            | Asserts                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cases/all-nine-edge-types.json`                | One fixture exercises CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY, PROVENANCE_OF, ANNOTATES, and REVISES. |
| `cases/full-pairwise-session-precedes.json`     | Four isolated records in one context with increasing timestamps produce every pairwise SESSION_PRECEDES edge.                                              |
| `cases/equal-timestamp-parallel-all-pairs.json` | Four isolated records in one context with equal timestamps produce every pairwise SESSION_PARALLEL edge.                                                   |
| `cases/dangling-claim-edges.json`               | Missing producer-declared references still produce dangling INFORMED_BY, PROVENANCE_OF, ANNOTATES, and REVISES edges.                                      |

## Generator

`packages/log-dev/scripts/generate-conformance-3.2.4.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.2.4.ts
```

Seeds and timestamps are fixed so regeneration is byte-identical. Regenerate when:

- [§3.2.4](../../../atrib-spec.md#324-edge-derivation-rules) changes
- The canonical record format changes
- A new edge type is promoted
- A new adversarial edge case is added

## Reference implementation

`services/graph-node/test/conformance-3.2.4.test.ts` loads every case and asserts exact edge-set equality.

`services/graph-node/test/edge-derivation-properties.test.ts` complements the static corpus with generated property checks for ordered records, equal-timestamp records, linear chains, compact mode, and input-order invariance.
