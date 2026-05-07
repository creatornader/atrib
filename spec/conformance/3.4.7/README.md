# atrib spec [§3.4.7](../../../atrib-spec.md#347-get-v1creatorscreator_keygraph) conformance corpus

Test fixtures for the creator activity-map endpoint per spec [§3.4.7](../../../atrib-spec.md#347-get-v1creatorscreator_keygraph).

The corpus is the shared contract for the **windowed cross-session view**. By default, the activity-map excludes intra-session edges (SESSION_PRECEDES, SESSION_PARALLEL) so the cross-session signal isn't drowned out by per-session sequencing. `?include_intra_session=true` restores the full edge set. Both modes preserve cross-session edges (CROSS_SESSION, INFORMED_BY across context_ids, PROVENANCE_OF, ANNOTATES, REVISES) and CHAIN_PRECEDES, chain integrity is intra-session linkage that nonetheless reflects producer-attested ordering rather than O(N²) fallback edges.

## Cases

| File | Asserts |
|---|---|
| `cases/cross-session-only-by-default.json` | Default filter behavior. Four records by one creator across two context_ids, with an INFORMED_BY edge from ctxB to ctxA. Default response (`include_intra_session=false`) MUST exclude SESSION_PRECEDES and SESSION_PARALLEL AND MUST include INFORMED_BY. `intra_session_edges_filtered` MUST be `true`. |
| `cases/include-intra-session-true-restores.json` | Opt-in toggle. Same fixture, `?include_intra_session=true`. The response MUST include intra-session edges (SESSION_PRECEDES at least, between the two unchained records in each context_id) alongside cross-session edges. `intra_session_edges_filtered` MUST flip to `false`. |

## Invariant

The `intra_session_edges_filtered` boolean is the inverse of `include_intra_session`. Implementations MUST NOT decouple them; otherwise consumers cannot use the flag to reason about which edges are present.

## Generator

[`packages/log-dev/scripts/generate-conformance-3.4.5-7.ts`](../../../packages/log-dev/scripts/generate-conformance-3.4.5-7.ts) (single generator covers [§3.4.5](../../../atrib-spec.md#345-get-v1tracerecord_hash), [§3.4.6](../../../atrib-spec.md#346-get-v1chainrecord_hash), and [§3.4.7](../../../atrib-spec.md#347-get-v1creatorscreator_keygraph)). Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.4.5-7.ts
```

## Reference test

[`services/graph-node/test/conformance-3.4.5-7.test.ts`](../../../services/graph-node/test/conformance-3.4.5-7.test.ts), ingests each case's fixture into a graph-node test server and asserts the `/v1/creators/<key>/graph` response edge-type membership matches the expected `edge_types_excluded` and `edge_types_present_at_least_one` sets, and the `intra_session_edges_filtered` flag matches.
