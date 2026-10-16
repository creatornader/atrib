---
'@atrib/daemon': patch
---

The HTTP context policy now resolves both context ladders of the MCP transport section: a write's `context_id` comes from the `dev.atrib/attribution` block, then the `traceparent` trace-id, and its `chain_root` from the extension token before the legacy carriers. A write whose only context is the extension block, or a bare `traceparent`, is no longer refused.
