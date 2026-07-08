# Evidence profile: `ap2-vi`

- **Type URI:** `https://atrib.dev/v1/evidence/ap2-vi`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Mapped 1:1 from the legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) `ap2_vi` protocol string (frozen legacy set).

Carries AP2 (Agent Payments Protocol) receipt evidence plus Verifiable Intent (VI) credential and mandate-constraint evidence for a signed transaction record. Verifier-side evidence off the settlement critical path; never alters `verifyRecord().valid` and never substitutes for the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) `signers[]` cross-attestation rule ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media types and hash rule

| Media type         | Payload                                        | Hash rule                   |
| ------------------ | ---------------------------------------------- | --------------------------- |
| `application/jwt`  | AP2 receipt JWT / SD-JWT VC (UTF-8)            | raw bytes (`rawSha256`)     |
| `application/json` | Mandate / constraint / VI evidence bundle      | JCS (RFC 8785, `jcsSha256`) |

`payload.hash` = `"sha256:" + hex(SHA-256(bytes))`. Raw receipt JWTs and SD-JWT disclosures stay local-only.

## Facts schema

| Fact             | JSON type        | Provenance class |
| ---------------- | ---------------- | ---------------- |
| `issuer`         | string \| null   | verifier-derived |
| `subject`        | string \| null   | verifier-derived |
| `scope`          | string[]         | verifier-derived |
| `attenuation_ok` | boolean \| null  | verifier-derived |
| `delegation_ok`  | boolean \| null  | verifier-derived |
| `details_hash`   | string (sha256:) | verifier-derived |

`delegation_ok` reflects the VI delegation chain; `details_hash` commits the AP2 receipt checks, VI credential layers, checkout/payment binding, and mandate-constraint evaluation.

## Tier semantics

- `declared` / `shape` — asserted / offline-parsed receipt.
- `attested` — a caller-owned AP2 path accepted the receipt; legacy-mapping default.
- `verified` — receipt JWT, JWKS, and SD-JWT VC conformance verified against the pinned offline corpus ([D096](../../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus)), reproducible from the envelope.

## Verifier behavior

`verifyAp2ViEvidenceAsync` / `evaluateAp2ViConstraints` in `@atrib/verify` produce the AP2 receipt checks, VI credential checks, and typed mandate-constraint evaluation. A verifier that sees only a `counterparty-attestation` envelope still reports `cross_attestation_missing: true` — the AP2 receipt signature is external evidence ([D098](../../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation)).

## Sanitization contract

Hashes and sanitized facts only; raw receipt JWTs, SD-JWT disclosures, and mandate bodies MUST NOT appear in public projections.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks), [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
- [D098](../../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation), [D107](../../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Profile-internal corpus: [`spec/conformance/ap2-vi-crypto/`](../../spec/conformance/ap2-vi-crypto/); envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
