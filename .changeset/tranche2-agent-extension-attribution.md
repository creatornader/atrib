---
'@atrib/agent': minor
---

Add client-side `dev.atrib/attribution` extension support per [D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133): declare the extension on outbound requests and parse attestation receipts from `result._meta`, behind an opt-in flag with unchanged behavior when unset.
