---
'@atrib/mcp': minor
'@atrib/recall': minor
---

[D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) extends the BM25 indexable corpus from `annotation summary + topics only` to `per-event_type record content + annotation summary + topics`. Lifts the per-event_type extraction to `@atrib/mcp` as a normative protocol-level contract so producers and consumers round-trip via the same shape definition.

**New in `@atrib/mcp`:** `extractIndexableText(eventTypeUri, content, opts?)` dispatcher + per-event_type type definitions (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + per-event_type extractors. Generic recursive string-walk fallback for extension URIs (depth ≤ 4, field cap 2KB via `DEFAULT_FIELD_CAP`). All additive; no removals.

**Changed in `@atrib/recall`:** `recall_by_content` and `rank_by='relevance'` BM25 corpus now indexes record-content tokens for ALL records (not just annotated ones). Empirical impact on the 2026-05-24 operator mirror: 84.6% of records produce non-zero indexable tokens, up from near-0% pre-ship. `ATRIB_RECALL_NOISE_FLOOR` default raised from 0.15 → 0.6 to track the corpus shift (the prior floor became a no-op against the content-extended corpus; new floor sits between the recent+annotated-only baseline ~0.55 and the empirical real-query minimum ~0.70). BM25 contribution clamped to `[0, 1]` at the parkScore site to honor the documented Park-component bound (raw BM25 was unbounded, accidentally fine when the corpus was sparse).

**Behavior change visible to callers:** queries that previously returned empty (no annotation in corpus) now may return records. Token weight in agent context windows scales with the existing `limit` parameter (default 10, unchanged from [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale)). Callers relying on the 0.15 floor to NOT trip suppression will see more `quality:below_threshold` responses; the env var still overrides for callers that want to retain prior behavior.

**Extension URIs:** non-normative event_type URIs fall back to the generic walker by default. Producers SHOULD adopt one of the recognizable normative-shape field names (`what`, `why_noted`, `summary`, `description`, `topics`) so the walker picks them up naturally, OR call `atrib-annotate` on important records to lift them via the curator path. The full extension-URI handling rationale is in the linked ADR.

Empirical calibration evidence: `services/atrib-recall/scripts/calibration-sweep-d086.mjs` (real vs nonsense query distributions against the 2026-05-24 mirror). Final calibration deferred to the gold-standard eval sweep queued in [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale).
