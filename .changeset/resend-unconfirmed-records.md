---
'@atrib/mcp': minor
'@atrib/attest': minor
---

Records the log never confirmed are now resent by a later process.

`createSubmissionQueue` accepts an `outbox`, and `createFileSubmissionOutbox`
keeps one file per unconfirmed record. `@atrib/attest` keeps an outbox beside
the mirror file by default, so an emit that was killed or timed out after
signing is delivered by the next emit instead of staying local. Set
`submissionOutbox: false` or `ATRIB_SUBMISSION_OUTBOX=off` to turn it off.

`emitInProcess` now reports a record's log index whenever the log confirmed
it, even when the flush as a whole ran past its deadline.
