# atrib spec [§1.11](../../../atrib-spec.md#111-delegation-certificates) conformance corpus

Test fixtures for delegation certificates per spec [§1.11](../../../atrib-spec.md#111-delegation-certificates) (promoted from [P045](../../../DECISIONS.md#p045-delegation-certificates-principal-keys-certify-ephemeral-run-keys)): a *principal* Ed25519 key certifies an ephemeral *run* key with an explicit scope, expiry, and optional session binding. Run records occupy the existing `creator_key` slot unchanged; verification of every existing record is byte-for-byte unaffected (delegation depth 0).

The corpus is the shared contract between every implementation that issues, carries, or resolves delegation certificates. It is used by `@atrib/verify` and any third-party implementation that asserts the [§1.11](../../../atrib-spec.md#111-delegation-certificates) invariants.

## Cases

| File | Family | Asserts |
|---|---|---|
| `cases/cert-canonical-full.json` | Certificate form | JCS canonical form with every optional field present (`cert_type` < `context_id` < `not_after` < `not_before` < `principal_key` < `run_pubkey` < `scope` < `signature`); real Ed25519 principal signature over the signing input; `cert_hash` over the signed bytes. |
| `cases/cert-canonical-minimal.json` | Certificate form | Absence-not-null: optional fields omitted entirely; signing input, signature, and `cert_hash` all differ from the full form. `not_before` defaults to `0` when absent. |
| `cases/cert-invalid-self.json` | Certificate form | Self-certificate (`run_pubkey === principal_key`) is invalid as delegation evidence (`self_certificate`) even though the signature verifies. |
| `cases/cert-invalid-wrong-signer.json` | Certificate form | Signature produced by a key other than the declared `principal_key` fails verification; certificate rejected (`principal_signature_invalid`). |
| `cases/walk-valid.json` | Verifier walk | Depth-1 happy path: record → run key → certificate → principal. Cert valid, in window, context-bound, cert-bound, in scope, not revoked. |
| `cases/walk-expired.json` | Verifier walk | `timestamp > not_after` → `in_window: false`. Signal only; record signature stays valid. |
| `cases/walk-scope-mismatch.json` | Verifier walk | `tool_name` outside `scope.tool_names` → `scope_check.in_scope: false`, mismatch `tool_names`. Signal, not invalidation, per [§6.7.3](../../../atrib-spec.md#673-out-of-envelope-is-a-signal-not-invalidation). |
| `cases/walk-wrong-principal-signature.json` | Verifier walk | Invalid certificate covering the run key → rejected as evidence, record falls back to depth 0. |
| `cases/walk-run-key-mismatch.json` | Verifier walk | `creator_key !== run_pubkey` → certificate never selected; genesis `delegation_cert_hash` that resolves to no covering certificate surfaces `delegation_unresolved: true`. |
| `cases/depth0-identity.json` | Depth-0 identity | A principal-signed record with no certificate verifies EXACTLY as today. Record, signing input, signature, and hash are embedded verbatim from [`spec/conformance/1.4/signing-vectors.json`](../1.4/signing-vectors.json) (first vector); implementations MUST confirm byte identity against that corpus. |
| `cases/genesis-field-canonical-form.json` | Genesis field | OPTIONAL `delegation_cert_hash` slots between `creator_key` and `event_type` in JCS order. With/without vectors carry distinct signatures and distinct record hashes; omission is byte-identical to pre-delegation output. |
| `cases/revocation-run-key.json` | Revocation ([§1.9](../../../atrib-spec.md#19-key-rotation-and-revocation)) | Principal-signed run-key revocation ([§1.9.2](../../../atrib-spec.md#192-signing-rules) rule 3) carrying `delegation_cert_hash`; pre/post log-index records flip per [§1.9.3](../../../atrib-spec.md#193-verifier-semantics). |
| `cases/revocation-cert-not-covering.json` | Revocation | Referenced certificate does not cover `revoked_key` → revoker not authorized, revocation rejected, states unaffected. |
| `cases/multi-producer-cert-bound-null.json` | Multi-producer ([D067](../../../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)) | A certified run key joining a context whose genesis a different producer signed: `cert_bound` stays `null` permanently, all other facts evaluable; the certificate's `context_id` is the substitute session binding. |

## Generator

`packages/log-dev/scripts/generate-conformance-delegation-certificates.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-delegation-certificates.ts
```

Seeds (principal `0x01` fill, run `0x02`, other producer `0x03`, rogue `0x04`, run2 `0x05`) and timestamps are hardcoded so successive regenerations produce byte-identical files. The principal seed deliberately matches the [§1.4](../../../atrib-spec.md#14-signing-and-verification) corpus signer so the depth-0 case is literally a principal signing directly. Regenerate when:

- the [§1.11](../../../atrib-spec.md#111-delegation-certificates) certificate schema or walk semantics change
- canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes
- a new test case is added

## Reference implementation

`packages/verify/test/conformance-delegation-certificates.test.ts` loads each case and asserts every expected field, including a reference implementation of the [§1.11.4](../../../atrib-spec.md#1114-verifier-walk) walk. Conforming third-party implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial fourteen-case corpus shipped.** Not yet covered (extend the generator when the corresponding surfaces land): two-principal ambiguity (`delegation_ambiguous`), chained-certificate `delegation_depth_exceeded`, `attenuation_ok` against a directory-published principal envelope, `scope.expires_at` capping `not_after`, directory `run_key_in_directory` anomaly, [D052](../../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) `signers_share_principal`, and the `delegation-certificate` evidence-envelope profile projection against [`spec/conformance/evidence-envelope/`](../evidence-envelope/).
