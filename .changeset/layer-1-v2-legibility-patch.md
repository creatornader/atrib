---
"@atrib/recall": minor
---

Layer 1 v2 legibility patch: every record in the compact response now carries `display_summary` (annotation summary if present, else per-event_type synthesis from record fields and `_local.content`), `display_producer` (friendly producer label from `_local.producer` sidecar, else `key:<8hex>` fallback), and `age` (relative time string like `5m ago` / `3d ago`). New anti-noise threshold via `ATRIB_RECALL_NOISE_FLOOR` env (default 0.15): when `rank_by="relevance"` returns a top Park score below the floor, recall returns empty records plus a `quality: "below_threshold"` signal rather than low-confidence top-K. Both changes are additive and backward-compatible. Addresses the legibility dimension that prior Layer 1 work (substrate-signal ranking) did not cover: agents previously had to dereference opaque hashes to figure out what each surfaced record was about.
