---
'@atrib/recall': minor
---

Add `evidence_mode` to `recall_by_content`. The default bounded mode keeps casual search fast, while `require_complete` searches the full mirror when it fits and refuses partial evidence with `fallback_required` when a cap would truncate the corpus.
