---
'@atrib/recall': patch
---

Accept all atrib normative event type filters on recall tools.

The MCP schema now accepts `observation`, `annotation`, `revision`,
`directory_anchor`, `tool_call`, and `transaction`, plus full event type URIs.
`recall_my_attribution_history` and `recall_orphans` share one local schema
and normalize through `@atrib/mcp` before matching signed URI-form records.
This fixes the stale schema that rejected observation filters before the
handler ran, and updates the atrib skill doc so agents stop learning the old
two-type limitation.
