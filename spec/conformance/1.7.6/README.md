# atrib spec [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) conformance corpus

Test fixtures for cross-attestation per spec [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) ([D052](../../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)).

The corpus is the shared contract between every implementation that produces or consumes transaction records. It is used by `@atrib/verify` and any third-party verifier implementation that surfaces a `cross_attestation` annotation.

## Cases

| File                                   | Asserts                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cases/legacy-single-signer.json`      | A transaction record with only the top-level `signature` field (no `signers[]` array). Verifier MUST surface `signers_count: 0, signers_valid: 0, missing: true`. The record stays cryptographically valid via the legacy signature; missing is a SIGNAL per [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), not invalidation. |
| `cases/one-signer.json`                | A transaction record with one entry in `signers[]`. Below the [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) normative minimum of 2 distinct signer keys. `signers_valid: 1, missing: true`.                                                                                                                                   |
| `cases/two-signers-valid.json`         | The canonical happy path: two independent signers (agent + counterparty). Both cover the SAME cross-attestation canonical bytes (JCS form with `signers: []` and top-level `signature` omitted). `signers_valid: 2, missing: false`.                                                                                                                                       |
| `cases/three-signers.json`             | Three signers (agent + counterparty + facilitator). Demonstrates that the [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) minimum of 2 is a floor, not a cap. `signers_valid: 3, missing: false`.                                                                                                                               |
| `cases/tampered-second-signature.json` | Two signers attached but the second signature has been tampered. `signers_count: 2, signers_valid: 1, missing: true`. Demonstrates that count and valid are independent: a cosigner cannot inflate `signers_valid` by attaching a bogus signature.                                                                                                                         |
| `cases/creator-signer-missing.json`    | Two counterparty signatures verify, but no signer entry matches the top-level `creator_key`. `cross_attestation.missing: false`, while the record's base signature path fails.                                                                                                                                                                                             |
| `cases/duplicate-signer-key.json`      | Two entries from the same `creator_key` verify, but they count as one distinct signer. `signers_count: 2, signers_valid: 1, missing: true`.                                                                                                                                                                                                                              |

## Generator

`packages/log-dev/scripts/generate-conformance-1.7.6.ts`. Run with:

```sh
pnpm exec tsx packages/log-dev/scripts/generate-conformance-1.7.6.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce byte-identical files. Regenerate when:

- [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) detection invariant changes
- Canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes, particularly the cross-attestation bytes (signers: [] + signature omitted)
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-1.7.6.test.ts` loads each case and asserts the full `cross_attestation` annotation matches `expected.cross_attestation` deep-equal, plus the [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) signal-not-invalidation guarantee where applicable. Conforming third-party implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Nine-case corpus shipped.** Cases collectively exercise the [§1.7.6](../../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) algorithm: legacy single-sig (case 1), below-minimum signer counts (cases 1-2 and case 7), the canonical happy path (case 3), above-minimum (case 4), tamper-detection (case 5), creator-signer separation (case 6), duplicate-signer rejection (case 7), and trusted signer composition (cases 8-9): two verified but untrusted signers surface `signers_trusted: 0` and `sybil_suspected: true` while staying valid (case 8), and two trusted signers surface `signers_trusted: 2` (case 9), per [D149](../../../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance).
