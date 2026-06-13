---
'@atrib/emit': minor
---

Honor `ATRIB_LOCAL_SUBSTRATE_MODE=commit` for long-lived emit producers. Emit now sends `sign_record` commit requests to the local substrate coordinator, skips its own log-submission queue only after the returned hash matches, and falls back to the local queue on rejection, timeout, or hash mismatch.
