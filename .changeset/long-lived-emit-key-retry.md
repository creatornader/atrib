---
'@atrib/emit': patch
---

Retry missing MCP server key resolution after a bounded cooldown instead of caching a transient Keychain miss for the lifetime of a long-lived emit server.
