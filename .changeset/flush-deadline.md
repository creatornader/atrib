---
"@atrib/emit": patch
---

`emitInProcess` now bounds its post-sign queue flush with `flushDeadlineMs` (default 5000ms). The submission queue's own retry budget against an unreachable log is 30s, which would otherwise stall detached hook processes on a network blip. Past the deadline, `emitInProcess` returns the record with a `flush exceeded Nms deadline` warning attached: the record is still signed and mirrored locally, only `log.atrib.dev` confirmation is uncertain.
