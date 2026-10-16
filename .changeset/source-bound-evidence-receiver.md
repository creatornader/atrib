---
'@atrib/mcp': minor
'@atrib/verify': minor
'@atrib/sdk': major
'@atrib/emit': major
'@atrib/attest': minor
'@atrib/openinference': minor
'@atrib/memory-tool': minor
'@atrib/action-gate': minor
'@atrib/agent': minor
'@atrib/annotate': major
'@atrib/revise': major
'@atrib/trace': major
'@atrib/summarize': minor
'@atrib/cli': minor
---

Add closed source-bound evidence body schemas, cryptographic nonces and body
commitments. Export a receiver that checks exact requests, authenticated source
artifacts, pinned authority snapshots, coverage and conflicts from supplied
bytes and policy. Keep generic record validity separate from evidence reliance.

Validate source and basis locator slots while preserving arbitrary JSON
parameters and state. Reject recognized credentials in relative query and fragment hints.
Distinguish absent publication proofs from present invalid proofs without
aborting other evidence checks.

Allow non-tool statements to omit content_id and transactions to use their
creator's signers entry without a top-level signature. Align submission helper
checks with the five-minute future-clock limit already enforced by core record
verification. Let callers supply a fixed evaluation clock to that verifier.

This changes TypeScript source compatibility. Callers must handle optional
`content_id` on non-tool statements and the signature union, including signers-only
transactions without a top-level `signature`. The minor release for these `0.x`
packages includes these breaking source changes. Signing and log-leaf algorithms
remain unchanged; accepted record shapes and the submission clock window change.

The stable `@atrib/sdk` and `@atrib/emit` APIs expose these changed record fields.
Their major releases mark the same source compatibility break. The `0.x`
`@atrib/attest`, `@atrib/openinference`, `@atrib/memory-tool`, and
`@atrib/action-gate` APIs also expose these fields through signed records,
submission callbacks, or mapping results. `@atrib/agent` exposes them through
attribution receipts. Their minor releases mark that break.

The stable `@atrib/annotate` and `@atrib/revise` registration helpers expose
record types through submission queues. `@atrib/trace` exposes them through
trace compaction arguments. Their major releases mark the source break.
The `0.x` `@atrib/cli` package exposes record types through its shipped,
unrestricted identity subpath. `@atrib/summarize` exposes them through its
exported `__test_only__.selectRecords` helper. Minor releases mark these source
changes, including the test helper without making it a production guarantee.
