---
'@atrib/mcp': patch
'@atrib/mcp-wrap': minor
---

Add harness context resolution and structured informed_by controls for long-lived wrappers. `@atrib/mcp-wrap` now keeps broad hash scanning off by default, so wrappers only sign provenance links from explicit paths unless an operator opts into free-text detection.
