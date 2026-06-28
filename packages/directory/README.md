# `@atrib/directory`

**AKD-backed identity-claim directory SDK for Atrib's verifiable action layer. Lets producers publish signed identity claims and capability envelopes; lets verifiers look up and verify those claims with cryptographic proofs.**

Implements spec [§6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#6-key-directory) (Public-Key Directory) as a thin TypeScript SDK over an AKD WASM bridge. Per [D034](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers): ships the WASM bridge inline. No platform-specific binaries, no native build steps.

```typescript
import { signClaim, lookup } from '@atrib/directory'

// Producer side: publish your identity claim
const claim = {
  spec_version: 'atrib/1.0',
  claim_subject: {
    display_name: 'My Agent',
    organization: 'My Org',
    url: 'https://my-tool.example.com',
  },
  // ... per spec §6.1 IdentityClaim shape
}
const signed = await signClaim(claim, privateKey)
await fetch('https://directory.atrib.dev/v6/claims', {
  method: 'POST',
  body: JSON.stringify(signed),
})

// Verifier side: look up a claim by creator_key
const result = await lookup({
  endpoint: 'https://directory.atrib.dev/v6',
  creator_key: 'haoZK4D1AXmy_r05GJP4CZGOv0zh0iK1l7ls1FA8oZI',
})
if (result.found) {
  console.log('claim:', result.claim)
  console.log('proof:', result.lookup_proof) // AKD non-membership/membership proof
  console.log('anchor:', result.anchor)      // pointer to the directory_anchor tlog record
}
```

## What the SDK does

Per spec [§6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#62-directory-operations) (operations) and [§6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#63-verifier-consultation-algorithm) (verifier consultation):

- **`signClaim(claim, privateKey)`**: JCS-canonicalize an IdentityClaim and Ed25519-sign it. The claim_subject describes the producer; signature is over the canonical bytes.
- **`lookup({ endpoint, creator_key })`**: POST to the directory's `/lookup` endpoint, returns `LookupResult` with the claim (if found), an AKD lookup proof, and a reference to the `directory_anchor` tlog record per [§6.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log).
- **`history({ endpoint, creator_key })`**: Returns the full append-only history of claims for a creator_key (rotations, revocations).
- **`proveAbsence({ endpoint, creator_key })`**: AKD non-membership proof. Used by verifiers when they need to prove a key was NOT registered at a given epoch.

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
