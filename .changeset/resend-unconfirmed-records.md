---
'@atrib/mcp': minor
'@atrib/attest': minor
---

Records the log never confirmed are now resent by a later process.

`createSubmissionQueue` accepts an `outbox`, and `createFileSubmissionOutbox`
keeps one file per unconfirmed record, per log endpoint. An entry is removed
when the log confirms the record or refuses the record itself (400, 413,
422). `@atrib/attest` keeps an outbox beside the mirror file by default, so
an emit that was killed or timed out after signing is delivered by a later
write instead of staying local. A long-lived queue looks for such records
when it submits, at most once a minute. Set
`submissionOutbox: false` or `ATRIB_SUBMISSION_OUTBOX=off` to turn it off.

`emitInProcess` now reports a record's log index whenever the log confirmed
it, even when the flush as a whole ran past its deadline.
