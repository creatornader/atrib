---
'@atrib/verify': minor
'@atrib/verify-mcp': minor
---

Promote Pattern 3 handoff verification into the verifier library and agent-facing MCP primitive.

`@atrib/verify` now accepts packet-derived handoff claims, checks allowed contexts, and preserves missing required records as explicit rejections. `@atrib/verify-mcp` exposes the read-only `atrib-verify` primitive for receiving agents before they link follow-up work through `informed_by`.
