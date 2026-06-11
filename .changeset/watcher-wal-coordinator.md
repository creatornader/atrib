---
"@atrib/emit": minor
---

Add an explicit watcher-WAL local-substrate commit path for `emitInProcess()` and `atrib-emit-cli`.

Accepted coordinator commits now return `receipt_id` and skip duplicate local queue submission after matching `record_hash`. Rejected, unavailable, or mismatched coordinator attempts fall back to local signing.
