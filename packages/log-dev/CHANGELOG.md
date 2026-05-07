# @atrib/log-dev

## 0.1.6

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0

## 0.1.3

### Patch Changes

- 8abcb67: [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records): cross-attestation type + verifier surface.

  `@atrib/mcp` `AtribRecord` type gains optional `signers?: SignerEntry[]` field for transaction records per spec [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records). New `canonicalCrossAttestationInput(record)` helper exported alongside `canonicalRecord` / `canonicalSigningInput` produces the JCS form with `signers: []` and the top-level `signature` field omitted — the bytes every signer in `signers[]` covers per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records).

  `@atrib/verify` `verifyRecord()` now surfaces `cross_attestation: { signers_count, signers_valid, missing }` on transaction records (`event_type = transaction`). Verifies each signer's Ed25519 signature against the cross-attestation canonical bytes; flags `missing: true` when below the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) normative minimum of 2 verified signers. Per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) missing is a SIGNAL, not invalidation: the underlying signature path keeps the record cryptographically valid. Legacy single-signer transaction records (no `signers[]`, top-level `signature` only) surface as `signers_count: 0, missing: true`.

  The verifier's top-level signature check is skipped for transaction records that carry a populated `signers[]` array per [§1.2.1](../../atrib-spec.md#121-field-definitions)'s "signature is OPTIONAL on transaction records" clause; in those records `signatureOk` is set to `true` and the actual cryptographic validity flows through `cross_attestation.signers_valid`.

  `spec/conformance/1.7.6/` corpus (5 cases) ships alongside: legacy-single-signer, one-signer (below minimum), two-signers-valid (canonical happy path), three-signers (above minimum), tampered-second-signature (count vs valid independence). Reference test at `packages/verify/test/conformance-1.7.6.test.ts`.

  7 new verifier tests + 5 conformance-corpus reference tests added; verify package now at 279 passing tests.

  **Middleware-side signing of multi-signer transaction records is a separable follow-up.** This change implements the verifier; the producer-side counterparty-coordination protocol (how the agent and counterparty exchange signatures over the same canonical bytes) is its own design problem and ships in a separate ADR when payment-protocol integration work begins.

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [edf710f]
  - @atrib/directory@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
  - @atrib/directory@0.1.1
