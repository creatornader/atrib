---
'@atrib/daemon': patch
---

An idempotent write with a malformed `context_id` now reaches the primitive and gets its schema refusal, the same tool error a non-idempotent call gets, instead of a JSON-RPC invalid-params error.
