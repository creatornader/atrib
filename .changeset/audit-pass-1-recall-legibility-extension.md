---
"@atrib/recall": minor
---

Audit-pass-1 follow-up to 0.8.0 legibility patch. Extends `display_summary`, `display_producer`, `age` from `recall_my_attribution_history` to the sibling tools `recall_by_content` and `recall_walk` so agents get consistent legibility across the recall surface (previously sibling tools still returned opaque-ish responses). Adds defensive handling in `formatAge` to return `"unknown"` for non-finite timestamps instead of throwing `RangeError`. Inline comments lock in the producer-vs-signer distinction (do not repurpose `display_producer` for AKD lookups; add `display_signer` as a separate field instead) and the derivation of the `ATRIB_RECALL_NOISE_FLOOR=0.15` default (`alpha * 0.5`). No behavior change for callers; all additions are backward-compatible.
