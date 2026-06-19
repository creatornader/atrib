---
'@atrib/mcp': patch
'@atrib/emit': patch
'@atrib/mcp-wrap': patch
---

Raise the local-substrate coordinator default timeout to 1500 ms and reuse cached local mirror hash scans across repeated unresolved reference checks. `@atrib/mcp-wrap` now includes lookup timing fields when it drops unresolved `informed_by` candidates.
