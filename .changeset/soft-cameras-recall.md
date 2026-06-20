---
'@atrib/recall': minor
---

Make base recall search cross-context by default and add `context_scope: "env"` for callers that need the [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) / [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) env-derived current-context filter.
