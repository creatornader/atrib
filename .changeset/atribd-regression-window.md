---
'@atrib/daemon': patch
---

Count a legacy-after-modern MCP request as an active regression for 24 hours instead of forever. The report gains `compatibility.regression` (`active`, `window_ms`, `last_legacy_after_modern_at`); health degrades only while it is active, and `/mcp/ready` reports whether the daemon serves. Lifetime counters and removal readiness are unchanged.
