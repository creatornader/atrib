---
'@atrib/mcp': minor
'@atrib/attest': minor
'@atrib/mcp-wrap': patch
---

Add a local signer socket key source ([D190](../DECISIONS.md#d190-a-local-signer-socket-is-a-final-key-source)). `@atrib/mcp` exports `createSignerSocket` and `signerSocketFromEnv`. A producer sends each unsigned record over a Unix socket to a host signer and accepts the signature only if it verifies under the pinned `ATRIB_SIGNER_PUBKEY`. `@atrib/attest` treats a set `ATRIB_SIGNER_SOCK` as its only key source, with no seed fallback. `@atrib/mcp-wrap` and the local substrate host refuse to start while it is set, because they still need an in-process seed. `ResolvedKey` from `@atrib/attest` is now a union; callers reading `privateKey` must check `source !== 'signer-socket'` first.
