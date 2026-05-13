---
'@atrib/emit': minor
'@atrib/recall': minor
'@atrib/trace': minor
'@atrib/summarize': minor
---

Honor `ATRIB_CONTEXT_ID` environment variable as the default `context_id` for the four MCP servers when the caller omits the argument. See [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for the contract. Inspect-style harnesses ([P018](../DECISIONS.md#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) can now thread a per-run [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `context_id` into spawned MCP subprocesses via the env block, eliminating the silent no-op that previously broke per-arm context isolation in Pattern 1 v2. Backward-compatible: explicit caller args always win; invalid env values are ignored. Per-server: `@atrib/trace` gains a new optional `context_id` tool input that scopes the walk (out-of-scope upstream records surface as dangling).
