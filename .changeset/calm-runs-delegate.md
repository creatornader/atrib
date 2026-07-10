---
"@atrib/agent": patch
"@atrib/cli": minor
"@atrib/mcp": minor
---

Add delegation-certificate producer conveniences. The CLI can issue scoped certificates for ephemeral run keys, and MCP middleware carries a configured certificate in the local mirror sidecar. Agent receipt parsing now uses the shared MCP verifier.
