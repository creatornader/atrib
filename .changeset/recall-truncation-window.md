---
'@atrib/recall': patch
---

Fix content-search snapshot truncation reporting when a broad mirror load is
exhaustive, and reload cached tail snapshots when a later query asks for a
larger window.
