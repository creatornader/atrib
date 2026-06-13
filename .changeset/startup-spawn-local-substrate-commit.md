---
'@atrib/mcp': minor
'@atrib/mcp-wrap': minor
---

Add opt-in startup-spawn local-substrate commit mode. `@atrib/mcp` can send a post-success `sign_record` commit request to a coordinator and skip its local log-submission queue after the returned `record_hash` matches. `@atrib/mcp-wrap` exposes the path through `localSubstrate.mode = "commit"` while keeping shadow mode as the default.
