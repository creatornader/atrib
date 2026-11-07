---
'@atrib/daemon': patch
---

Give an indeterminate keyed write a way out. `atribd reconcile-idempotency --key <key>` releases the key (`--not-dispatched`) or stores the result the write produced (`--result <file>`), and the store gains `reconcile()`. A completion now applies only to a pending entry, so a late or repeated completion cannot replace a stored result.

Closing the HTTP host is now terminal: health and readiness report `closed` with a 503, a second close shares the first, and a backend that finishes mounting after close no longer reports ready.
