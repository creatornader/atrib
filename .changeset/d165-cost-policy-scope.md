---
'@atrib/verify': minor
---

Add the [D165](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d165-orchestration-wiring-with-routing-and-cost-accounting) `cost_policy` capability-envelope sub-field (`model_tiers`, `max_tokens`) to `DelegationScope`, with `checkCostPolicy(policy, usage)` for caller-supplied usage facts. Signal-only per [§6.7.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#673-out-of-envelope-is-a-signal-not-invalidation); the record-only [§1.11.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1114-verifier-walk) walk produces no `cost_policy` mismatch. New conformance case `walk-scope-cost-policy` with pinned usage vectors.
