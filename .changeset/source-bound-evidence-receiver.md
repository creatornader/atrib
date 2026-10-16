---
'@atrib/action-gate': minor
'@atrib/mcp': minor
'@atrib/runtime-log': minor
'@atrib/verify': minor
---

Add closed source-bound evidence body schemas, cryptographic nonces and body
commitments. Export a receiver that checks exact requests, authenticated source
artifacts, pinned authority snapshots, coverage and conflicts from supplied
bytes and policy. Keep generic record validity separate from evidence reliance.

Add opt-in durable evidence retention to the existing protected MCP executor
using the private mirror. Add runtime-log CLI reconstruction of retained
evidence and the fixed host-inventory coverage method. These authenticate the
named host's account of capture, not remote destination effects.

Validate source and basis locator slots while preserving arbitrary JSON
parameters and state. Reject recognized credentials in relative query and fragment hints.
Distinguish absent publication proofs from present invalid proofs without
aborting other evidence checks.

Allow non-tool statements to omit content_id and transactions to use their
creator's signers entry without a top-level signature. Align submission helper
checks with the five-minute future-clock limit already enforced by core record
verification. Let callers supply a fixed evaluation clock to that verifier.
