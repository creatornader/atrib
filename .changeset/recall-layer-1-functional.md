---
'@atrib/recall': minor
---

Layer 1 of the recall semantic surface lands functional. The existing `recall_my_attribution_history` tool gains seven new optional parameters, all enforced end-to-end:

- `min_importance`: minimum annotation-derived importance threshold. Records with no annotation are excluded.
- `topic_tags`: OR-match against annotation topic_tags.
- `include_revised`: default false keeps revised records visible with `superseded_by` populated; true hides them.
- `min_signers`: distinct-signer count filter. Transaction records carry `signers[]`; non-transaction records have count 1.
- `rank_by`: result ordering. `'timestamp'` (default, newest first), `'relevance'` (Park et al. weighted-sum scoring: recency + annotation-derived importance + BM25 relevance against `rank_anchor`), or `'causal_distance'` (BFS shortest path from `rank_anchor` over the local derived graph).
- `rank_anchor`: anchor for non-timestamp `rank_by` modes. Record_hash for `causal_distance`; free-form text query for `relevance`.
- `toc`: when true, returns the ~40-80-token-per-entry table-of-contents shape (record_hash, tool_name, summary, importance, topic_tags, timestamp, superseded_by) suitable for SessionStart auto-injected scaffolds.

Every returned record gains two new fields when applicable: `annotations` (max_importance + topics + latest summary, aggregated across all [D058](../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) annotations pointing at the record) and `superseded_by` ([D059](../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) revision hashes superseding the record).

Four new MCP tools join the surface, all functional:

- `recall_walk`: BFS over the local derived graph from a starting record_hash. Layer 1 covers four edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases.
- `recall_annotations`: aggregated annotation summary lookup for a target record_hash.
- `recall_revisions`: forward revision-chain walk for a target record_hash.
- `recall_by_content`: BM25 free-form retrieval over each record's annotation summary + topic_tags, reranked by Park et al. weighted-sum scoring. Layer 2 (sqlite-vec sidecar, separate ship) will extend with embedding similarity.

Park et al. 2023 ranking weights and recency time constant are environment-tunable for per-axis sensitivity studies (`ATRIB_RECALL_ALPHA` / `BETA` / `GAMMA` / `TAU_DAYS`).

Event_type filter accepts `annotation` and `revision` in addition to the existing `tool_call` and `transaction` short forms; URI form is also accepted.

Backward-compatible additive surface. All pre-0.5.0 calls produce identical responses under the new code path. The base `RecallResult` shape gains optional `annotations` + `superseded_by` per record (omitted when no annotation/revision points at the record).
