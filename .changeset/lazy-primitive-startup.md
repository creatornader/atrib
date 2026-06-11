---
'@atrib/emit': patch
'@atrib/annotate': patch
'@atrib/revise': patch
'@atrib/recall': patch
---

Resolve write-primitive signing keys lazily on tool calls instead of during MCP server startup, and let recall be embedded without taking over stdio on import. This keeps standalone binaries compatible while allowing a private combined primitives runtime to start and list tools without waiting on keychain access.
