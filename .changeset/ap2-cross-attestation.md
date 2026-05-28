---
'@atrib/mcp': minor
'@atrib/agent': patch
---

Add `signTransactionRecord()` for [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) transaction cross-attestation bytes and use it for agent-side Path 2 transaction records.

Path 2 records now carry an agent `signers[]` entry over the atrib transaction record bytes. AP2 receipt JWT signatures remain verifier evidence and are not counted as transaction signers unless a counterparty signs the same atrib canonical bytes.
