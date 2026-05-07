# atrib spec [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash) conformance corpus

Test fixtures for the causal chain endpoint per spec [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash) ([D068](../../../DECISIONS.md#d068-trace-operations-split--provenance-trace-vs-causal-chain)).

The corpus is the shared contract for the **substrate-derived chain_root walk**. Causal chain walks the chain_root linkage every record carries per [§1.2.3](../../../atrib-spec.md#123-chain_root-for-genesis-records); the walk terminates at the session's genesis record (where `chain_root = SHA-256(context_id)`). Symmetric counterpart to [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash): producer claims (INFORMED_BY, ANNOTATES, REVISES) MUST NOT be walked here. Producers do not declare these chain edges; the substrate derives them per [§3.2.4](../../../atrib-spec.md#324-edge-derivation-rules).

## Cases

| File | Asserts |
|---|---|
| `cases/linear-chain-to-genesis.json` | Linear chain walk. Three-record chain A → B → C in one context_id. Chain walk from C returns {A, B, C} and terminates at A (the session-genesis record where `chain_root = SHA-256(context_id)`). `truncated_by_depth=false`. |
| `cases/informed-by-not-walked.json` | Producer-claim prohibition. Two records: B is informed by A but B carries the genesis chain_root for its context_id. Chain walk from B MUST return ONLY {B} — informed_by is a producer claim, not substrate structure, and [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash) forbids the chain walk from following producer claims. Symmetric counterpart to [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash)'s `chain-precedes-not-walked` invariant. |
| `cases/depth-limit-truncates.json` | Depth truncation. Three-record chain A → B → C. Chain walk from C with depth=1 returns {B, C} and sets `truncated_by_depth=true` (B's predecessor A is unwalked and is not the genesis). |

## Generator

[`packages/log-dev/scripts/generate-conformance-3.4.5-7.ts`](../../../packages/log-dev/scripts/generate-conformance-3.4.5-7.ts) (single generator covers [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash), [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash), and [§3.4.7](../../../atrib-spec.md#347-get-v1creatorscreator_keygraph)). Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.4.5-7.ts
```

## Reference test

[`services/graph-node/test/conformance-3.4.5-7.test.ts`](../../../services/graph-node/test/conformance-3.4.5-7.test.ts) — ingests each case's fixture into a graph-node test server and asserts the `/v1/chain/<hash>` response set matches the expected record indexes (and excluded indexes are absent).
