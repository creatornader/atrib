---
"@atrib/mcp": minor
"@atrib/mcp-wrap": minor
"@atrib/attest": minor
"@atrib/emit": minor
"@atrib/annotate": minor
"@atrib/revise": minor
"@atrib/recall": minor
"@atrib/summarize": minor
"@atrib/trace": minor
"@atrib/verify-mcp": minor
"@atrib/daemon": minor
---

Migrate maintained MCP servers, clients, and the primitive runtime to the v2 SDK split. atribd now negotiates dev.atrib/attribution receipts on stateless v2 tool calls. The retired primitives HTTP entry point delegates to atribd's stateless host.
