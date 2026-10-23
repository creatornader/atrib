---
'@atrib/mcp': minor
'@atrib/attest': minor
'@atrib/mcp-wrap': minor
'@atrib/memory-tool': minor
'@atrib/action-gate': minor
---

Add a local signer socket key source ([D190](../DECISIONS.md#d190-a-local-signer-socket-is-a-final-key-source)). `@atrib/mcp` exports `createSignerSocket` and `signerSocketFromEnv`. A producer sends each unsigned record over a Unix socket to a host signer and accepts the signature only if it verifies under the pinned `ATRIB_SIGNER_PUBKEY`. The `atrib()` middleware and `createInProcessLocalSubstrateCoordinator()` take the client as a `signer` option, so the seed never enters those processes. `@atrib/attest`, `@atrib/mcp-wrap`, the local substrate host, `@atrib/memory-tool` and `@atrib/action-gate` treat a set `ATRIB_SIGNER_SOCK` as their only environment key source, with no seed fallback; `@atrib/memory-tool` and `@atrib/action-gate` also accept an explicit `signer`. `ResolvedKey` from `@atrib/attest` and `@atrib/mcp-wrap` is now a union; callers reading the seed must check `source !== 'signer-socket'` first. `CreateInProcessLocalSubstrateCoordinatorOptions.creatorKey` is now optional, `signActionGateDecision()` and `signActionGateOutcome()` take `privateKey` or `signer`, and `resolveActionGatePrivateKey()` throws instead of reading `ATRIB_PRIVATE_KEY` while `ATRIB_SIGNER_SOCK` is set.
