---
'@atrib/mcp': patch
'@atrib/recall': patch
'@atrib/attest': patch
'@atrib/emit': patch
---

Recall skips a stale durable content index without parsing it and keeps one bounded search window across different `max_records` limits. The signer's mirror tail index folds in appends that land during its incremental read instead of rescanning the whole mirror. `@atrib/attest` and `@atrib/emit` take the signer fix so the global `atrib-emit-cli` hook signer gets it on its next refresh.
