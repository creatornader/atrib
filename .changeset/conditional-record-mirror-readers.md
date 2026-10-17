---
'@atrib/recall': major
'@atrib/mcp-wrap': minor
---

Retain transaction records whose creator signature appears in signers when loading local mirrors. Keep signature verification on recalled records.

Both packages expose record types through their public APIs. Callers must handle
optional `content_id` and transactions with a creator signer but no top-level
`signature`. The stable `@atrib/recall` API takes a major release for this source
compatibility break. The `0.x` `@atrib/mcp-wrap` API takes a minor release.
