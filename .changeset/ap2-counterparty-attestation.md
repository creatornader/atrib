---
'@atrib/mcp': minor
'@atrib/verify': patch
---

Add AP2 counterparty transaction attestation support.

`@atrib/mcp` now exposes `signTransactionAttestation()` so AP2 counterparties can sign the finalized atrib transaction bytes. `@atrib/verify` now counts distinct verified signer keys for transaction cross-attestation, so duplicate signer entries cannot satisfy the two-party requirement.
