---
"@atrib/mcp": patch
"@atrib/mcp-wrap": patch
---

Add opt-in local substrate shadow wiring for startup-spawn wrappers. `@atrib/mcp`
now accepts a transport-backed shadow option that sends the exact unsigned record
body to a coordinator with `mode: "shadow_probe"`, compares the returned hash to
the local signer, and keeps local signing, mirror append, outbound context, and
queue submission authoritative. `@atrib/mcp-wrap` exposes the first JSON config
path through an HTTP endpoint and logs each shadow attempt for rollout checks.
