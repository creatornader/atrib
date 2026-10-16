---
'@atrib/mcp': patch
---

`extractTraceId` now rejects the forbidden traceparent version `ff` and version `00` values with more than four fields, per W3C Trace Context.
