---
'@atrib/emit': minor
---

`handleEmit` now reads `ATRIB_PARENT_RECORD_HASH` from the environment and auto-prepends a valid value to `informed_by` before signing. Producers that spawn child processes (subagents, workers, framework nodes) can thread parent-child causality through the existing `§1.2.5` informed_by primitive without a spec change. Only `sha256:<64-hex>` values are honored; invalid values are silently ignored. Caller-supplied `informed_by` entries are deduplicated against the env-seeded hash via `Set`. Limitation: single-process hosts where parent and child share env cannot use this convention naively because the parent's record signature fires after the child has already emitted; those cases need retroactive annotation. See the pending decision in `DECISIONS.md` for the layered design that frames this as the cheap baseline alongside a future `handoff` event_type promotion.
