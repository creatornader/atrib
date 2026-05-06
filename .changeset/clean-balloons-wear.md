---
'@atrib/mcp': minor
---

Add `ATRIB_CHAIN_TAIL_<context_id>` env var as the cross-producer chain-tail handoff. When a parent process spawns a child producer (different middleware instance, e.g. wrapper spawning an atrib-emit subprocess) and writes its current chain tail to this env var, the child's first sign chains to the parent's tail instead of starting at synthetic-genesis. Fills the gap between within-process autoChain and cross-process traceparent propagation.

Priority cascade now: inbound traceparent (§1.5.2) > autoChain in-memory tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > synthetic genesis.

Refactored chain_root determination into a pure `resolveChainRoot` helper exported from `@atrib/mcp` for unit-testable composition.
