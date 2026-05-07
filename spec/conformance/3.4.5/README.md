# atrib spec [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash) conformance corpus

Test fixtures for the provenance trace endpoint per spec [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash) ([D068](../../../DECISIONS.md#d068-trace-operations-split--provenance-trace-vs-causal-chain)).

The corpus is the shared contract for the **producer-claim ancestry walk**. Provenance trace walks INFORMED_BY ([§1.2.5](../../../atrib-spec.md#125-informed_by)), ANNOTATES ([§1.2.7](../../../atrib-spec.md#127-annotates)), and REVISES ([§1.2.9](../../../atrib-spec.md#129-revises)) edges, every edge walked is a record where the producer explicitly named a prior record as informing, annotating, or revising the current one. The walk MUST NOT follow CHAIN_PRECEDES; that is substrate-derived structure and conflating the layers violates the structure-vs-claims separation in [§3.1](../../../atrib-spec.md#31-design-principles-and-rationale).

## Cases

| File | Asserts |
|---|---|
| `cases/linear-informed-by-chain.json` | Multi-hop INFORMED_BY walk. Three records linked C→B→A. Trace from C with default depth surfaces the full ancestry {A, B, C}. |
| `cases/chain-precedes-not-walked.json` | Structure-vs-claims invariant. Three records linked by `chain_root` only (no producer claims). Trace from C MUST return ONLY {C}, chain_root edges are substrate-derived structure, not producer claims, and [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash) forbids the trace walk from following them. |
| `cases/depth-limit-truncates.json` | Depth truncation. Three-record informed_by chain (C→B→A). Trace from C with depth=1 returns {B, C} and sets `truncated_by_depth=true`. |

## Generator

[`packages/log-dev/scripts/generate-conformance-3.4.5-7.ts`](../../../packages/log-dev/scripts/generate-conformance-3.4.5-7.ts) (single generator covers [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash), [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash), and [§3.4.7](../../../atrib-spec.md#347-get-v1creatorscreator_keygraph) since they share record-construction helpers). Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.4.5-7.ts
```

## Reference test

[`services/graph-node/test/conformance-3.4.5-7.test.ts`](../../../services/graph-node/test/conformance-3.4.5-7.test.ts), ingests each case's fixture into a graph-node test server and asserts the `/v1/trace/<hash>` response set matches the expected record indexes (and excluded indexes are absent).
