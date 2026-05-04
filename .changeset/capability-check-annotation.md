---
"@atrib/verify": minor
---

Add `capability_check` per-record annotation (D051 / atrib spec §6.7).

`verifyRecord(record, options)` now accepts `options.identityClaim` and surfaces a `capability_check: { envelope, in_envelope, mismatches, unresolvable }` field on the result. The verifier checks the record against the envelope's `event_types` allowlist and `expires_at` cutoff. Constraints that depend on data not on the standard record shape (`tool_names` against `tool_call`) or out-of-band protocol-event data (`max_amount`, `counterparties` against `transaction`) flag `unresolvable: true` rather than passing or failing silently, per spec §6.7.2.

Per spec §6.7.3 out-of-envelope is a signal, not invalidation: mismatches do not flip `valid` to false. Callers decide policy.

The caller is responsible for fetching the active capability envelope at the record's timestamp (typically via `@atrib/directory`'s `lookup()` or a cached equivalent). `@atrib/verify` intentionally has no `@atrib/directory` dependency — the new `ResolvedIdentityClaim` interface is structurally compatible with `@atrib/directory`'s `IdentityClaim`, so callers can pass either the directory's response or a hand-rolled cache entry.

New exports: `CapabilityEnvelope`, `CapabilityCheckAnnotation`, `ResolvedIdentityClaim`, `VerifyRecordOptions.identityClaim`.
