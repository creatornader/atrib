# `@atrib/directory`

**AKD-backed identity-claim directory SDK for atrib's verifiable action layer. Lets producers publish signed identity claims and capability envelopes; lets verifiers look up and verify those claims with cryptographic proofs.**

Implements spec [§6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#6-key-directory) (Public-Key Directory) as a thin TypeScript SDK over an AKD WASM bridge. Per [D034](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers): ships the WASM bridge inline. No platform-specific binaries, no native build steps.

```typescript
import { AtribDirectory, signClaim, verifyLookupProof } from '@atrib/directory'

// The directory is an in-process AKD instance. The operator key is optional;
// a random one is generated when omitted. directory-node wraps this SDK, and
// you can also embed it directly.
const dir = await AtribDirectory.create()

// Producer side: sign an identity claim, then publish it.
const unsigned = {
  spec_version: 'atrib/1.0',
  claim_subject: {
    display_name: 'My Agent',
    organization: 'My Org',
    url: 'https://my-tool.example.com',
  },
  // ... the rest of the spec §6.1 IdentityClaim shape
}
const signed = await signClaim(unsigned, privateKey) // privateKey: 32-byte Ed25519 seed (Uint8Array)
const { epoch } = await dir.publishSigned(signed)

// Verifier side: look up a claim by creator_key.
const result = await dir.lookup('haoZK4D1AXmy_r05GJP4CZGOv0zh0iK1l7ls1FA8oZI')
if (result.claim) {
  console.log('claim:', result.claim)     // the IdentityClaim, or null for verified non-membership
  console.log('version:', result.version) // 1 on first publish, increments on rotation
  console.log('proof:', result.proof)     // AKD lookup proof (Uint8Array)
}
```

## What the SDK does

Per spec [§6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#62-directory-operations) (operations) and [§6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#63-verifier-consultation-algorithm) (verifier consultation), the package exports the `AtribDirectory` class and a set of stateless helpers.

`AtribDirectory`, an AKD directory instance:

- **`AtribDirectory.create(operatorPrivateKey?)`**: build a directory. A random operator key is generated when none is passed.
- **`publishSigned(claim)`** and **`publishAndSign(unsigned)`**: publish a claim, returning the `{ epoch }` it landed in. `publishAndSign` signs with the operator key first.
- **`lookup(creatorKey)`**: returns a `LookupResult` `{ claim, version, proof }`. `claim` is `null` for a verified non-membership result.
- **`history(creatorKey)`**: returns a `HistoryResult` `{ versions, proof }` covering rotations and revocations.
- **`auditProof(fromEpoch, toEpoch)`**: returns the append-only consistency proof between two epochs.

Stateless helpers that need no directory instance:

- **`signClaim(unsigned, privateKey)`**: JCS-canonicalize an IdentityClaim and Ed25519-sign it. `privateKey` is a 32-byte Ed25519 seed (`Uint8Array`).
- **`verifyClaimSignature(claim)`**: check a claim's signature against its `creator_key`.
- **`verifyLookupProof(input)`** and **`verifyAuditProof(input)`**: re-validate an AKD lookup or audit proof against the anchored checkpoint root per [§6.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log).
- **`directoryVrfPublicKey()`**: the directory's VRF public key, used in proof verification.

To publish to the hosted directory at `directory.atrib.dev`, use the `@atrib/cli publish-claim` command; this SDK is the AKD engine behind that directory and its verifier-side proof checks.

## Capability envelopes ([§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations))

Optional `capabilities` field on a published claim declares what the signer is authorized to do: tool names, event types, payment limits, counterparty restrictions, expiry. Verifiers cross-check the envelope against records signed by that key and surface `in_envelope: false` annotations on out-of-envelope records (signal not block).

```typescript
const claim = {
  // ... base IdentityClaim fields
  capabilities: {
    tool_names: ['search', 'fetch'],
    event_types: ['tool_call'],
    max_amount: { currency: 'USD', value: 100 },
    expires_at: '2027-01-01T00:00:00Z',
  },
}
```

See spec [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) for the full schema.

## Trust posture ([§6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#63-verifier-consultation-algorithm) + [§8.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#87-adversarial-threat-model))

The directory returns **claims, not facts**. The SDK does not assert that a claim is true: only that it was signed by the holder of the named creator_key. Verifiers cross-check against the anchored checkpoint root from the tlog ([§6.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)) and surface signals; downstream consumers decide policy.

## Install

```bash
npm install @atrib/directory
```

The WASM artifact (~80 kB) ships inside the package. No additional installs.

## License

Apache-2.0.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
