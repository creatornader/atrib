# Evidence profile: `counterparty-attestation`

- **Type URI:** `https://atrib.dev/v1/evidence/counterparty-attestation`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Envelope-native (no legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string; frozen set).

Carries an out-of-band co-signature receipt from a counterparty about an agent action or transaction, for example an AP2 receipt signature that arrives outside the record's `signers[]` array. This is external evidence about attestation, never a substitute for the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross-attestation rule ([D098](../../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) / [D107](../../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)). It never alters `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media types and hash rule

| Media type         | Payload                                    | Hash rule                   |
| ------------------ | ------------------------------------------ | --------------------------- |
| `application/jwt`  | Signed receipt / attestation JWT (UTF-8)   | raw bytes (`rawSha256`)     |
| `application/json` | Attestation object / co-signature receipt  | JCS (RFC 8785, `jcsSha256`) |

`payload.hash` = `"sha256:" + hex(SHA-256(bytes))`. When the attestation signs the atrib transaction bytes ([D107](../../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)), `ref.record_hash` MAY name the attested transaction record. Raw receipts stay local-only.

## Facts schema

| Fact                | JSON type       | Provenance class |
| ------------------- | --------------- | ---------------- |
| `attester_key`      | string \| null  | verifier-derived |
| `attested_subject`  | string \| null  | caller-attested  |
| `signature_valid`   | boolean \| null | verifier-derived |
| `attested_at_ms`    | number \| null  | caller-attested  |

`attester_key` is the counterparty key; `signature_valid` reflects verification of the receipt signature over the attested bytes.

## Tier semantics

- `declared`: receipt hash and facts asserted.
- `shape`: receipt parsed and structurally validated.
- `attested`: a caller-owned path accepted the counterparty signature.
- `verified`: the counterparty signature verified against `attester_key` over the attested bytes, reproducible from the envelope.

## Verifier behavior

The verifier checks the receipt signature and surfaces `signature_valid`. Critically, a verifier that sees only a `counterparty-attestation` envelope for a transaction record still reports `cross_attestation_missing: true` ([D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)): only distinct verified `signers[]` entries over the canonical transaction bytes satisfy the ≥2-distinct-keys minimum. The envelope is corroborating evidence, not a signer.

## Sanitization contract

`attester_key`, `attested_subject`, `signature_valid`, `attested_at_ms`, and `payload.hash` MAY appear in public projections. Raw receipt tokens and any counterparty PII in the receipt body MUST NOT appear.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
- [D098](../../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation), [D107](../../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
