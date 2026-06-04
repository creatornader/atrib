---
'@atrib/mcp': minor
'@atrib/mcp-wrap': minor
'@atrib/emit': patch
---

Add `buildSubagentProducerEnv()` for same-session agent-to-subagent handoff.

The helper builds the canonical child producer env bundle with `ATRIB_CONTEXT_ID`,
`ATRIB_CHAIN_TAIL_<context_id>`, and `ATRIB_PARENT_RECORD_HASH` so adapters do
not hand-copy the parent-child threading rules.

Add source-aware `informed_by` validation hooks and shared record-reference
resolution through local mirrors plus log lookup. `@atrib/mcp-wrap` now uses the
resolver for configured `informedByPaths`, and `@atrib/emit` reuses the shared
resolver implementation.
