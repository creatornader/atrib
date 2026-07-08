---
'@atrib/mcp': patch
'@atrib/agent': patch
'@atrib/action-gate': patch
'@atrib/verify': patch
'@atrib/cli': patch
'@atrib/mcp-wrap': patch
'@atrib/directory': patch
'@atrib/openinference': patch
'@atrib/memory-tool': patch
'@atrib/runtime-log': patch
'@atrib/sdk': patch
'@atrib/emit': patch
'@atrib/annotate': patch
'@atrib/revise': patch
'@atrib/recall': patch
'@atrib/trace': patch
'@atrib/summarize': patch
'@atrib/verify-mcp': patch
---

Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.
