---
"@atrib/mcp": minor
"@atrib/emit": patch
"@atrib/mcp-wrap": patch
---

Add [D104](../DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash) parent-child `informed_by` threading through `ATRIB_PARENT_RECORD_HASH`.

`@atrib/mcp` now validates the env value with a shared record-hash helper and applies it to the first successful wrapper-signed child record. `@atrib/emit` uses the same helper for explicit emit records, and `@atrib/mcp-wrap` documents the inherited wrapper behavior.
