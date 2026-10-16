---
'@atrib/mcp': patch
'@atrib/recall': patch
---

Recall skips a stale durable content index without parsing it and keeps one bounded search window across different `max_records` limits. The signer's mirror tail index folds in appends that land during its incremental read instead of rescanning the whole mirror.
