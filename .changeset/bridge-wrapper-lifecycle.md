---
'@atrib/mcp-wrap': patch
'@atrib/mcp': patch
---

Shut down stdio wrappers when host stdin closes, the parent process exits, or the wrapper is reparented after a host restart. Make MCP proxy close idempotent so duplicate lifecycle events do not turn cleanup into a new error.
