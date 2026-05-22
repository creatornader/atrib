---
"@atrib/emit": patch
---

Fix `emitInProcess` (and `handleEmit`) returning `log_index: null` and a "submission queued; proof not yet available" warning even when the submission had completed. The submission queue caches proofs by *bare hex* while atrib uses the spec [§1.4.2](../atrib-spec.md#142-record-hash) `sha256:<hex>` form everywhere else, so every `queue.getProof(recordHash)` call was returning undefined. A small bridging helper now strips the prefix before querying the cache, and `emitInProcess` re-reads the proof after its flush completes so the patched result reflects what actually landed on the log.

The fix surfaces the bug that was making the local mirror's `_local.proof` sidecar always null and producing the same misleading warning on every PostToolUse hook signing. Records were landing; the proof bookkeeping wasn't reaching the caller.
