# Evidence profile: `delegation-certificate`

- **Type URI:** `https://atrib.dev/v1/evidence/delegation-certificate`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Envelope-native. No legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string exists or may be introduced for delegation; the legacy set is frozen ([§1.11.8](../../atrib-spec.md#1118-carriage)).

The verifier-facing carrier for a delegation certificate: a principal key's signed statement `{run_pubkey, scope, not_after, context_id?}` certifying an ephemeral run key that occupies the `creator_key` slot of run records ([D140](../../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys)). It is the third carrier alongside the `_local.delegation_cert` sidecar and the archive evidence surface ([§1.11.8](../../atrib-spec.md#1118-carriage)). It never alters `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)); depth-0 (uncertified) records verify exactly as today.

## Payload media type and hash rule

| Media type         | Payload                          | Hash rule                   |
| ------------------ | -------------------------------- | --------------------------- |
| `application/json` | The certificate object           | JCS (RFC 8785, `jcsSha256`) |

`payload.hash` = `"sha256:" + hex(SHA-256(JCS(certificate)))`, i.e. the certificate's `cert_hash`; the payload MAY instead be carried by reference as that `cert_hash`. **`ref.record_hash` never applies — a certificate is not a signed atrib record** ([§1.11.8](../../atrib-spec.md#1118-carriage)). `ref.kind` is `inline` (with the certificate body local-only), `mirror`, `archive`, or `withheld`.

## Facts schema

The profile's verifier facts are the [§1.11.4](../../atrib-spec.md#1114-verifier-walk) walk outputs (the `delegation` block), all verifier-derived:

| Fact             | JSON type       | Notes                                        |
| ---------------- | --------------- | -------------------------------------------- |
| `depth`          | number (0 \| 1) | 0 = identity case, no certificate            |
| `principal_key`  | string \| null  | null at depth 0                              |
| `cert_hash`      | string \| null  | matches `payload.hash`                        |
| `cert_valid`     | boolean \| null | certificate signature/format validity        |
| `in_window`      | boolean \| null | `not_before <= R.timestamp <= not_after`     |
| `context_bound`  | boolean \| null | null when the cert has no `context_id`        |
| `cert_bound`     | boolean \| null | null when no genesis `delegation_cert_hash`   |
| `scope_check`    | object \| null  | `{ in_scope, attenuation_ok, mismatches[] }` |
| `revoked`        | boolean \| null | run-key or principal revocation ([§1.11.5](../../atrib-spec.md#1115-run-key-revocation)) |

## Tier semantics

- `declared` — certificate hash and facts asserted.
- `shape` — certificate parsed and structurally validated.
- `attested` — a caller-owned path accepted the certificate.
- `verified` — principal signature over `{run_pubkey, scope, not_after, context_id?}` verified and the [§1.11.4](../../atrib-spec.md#1114-verifier-walk) walk reproduced offline against declared trust roots.

## Verifier behavior

The verifier runs the [§1.11.4](../../atrib-spec.md#1114-verifier-walk) offline walk: it never alters `R.signature` validity; run keys are resolved through the principal, not the directory (`run_key_in_directory: true` is a structural anomaly); scope is signal-not-block per [§6.7.3](../../atrib-spec.md#673-out-of-envelope-is-a-signal-not-invalidation); and two valid certificates from different principals covering one run key set `delegation_ambiguous: true` rather than choosing. All facts are signals; none invalidate the record.

## Sanitization contract

Certificates contain only public keys, a scope, and timestamps — no salted-commitment or PII concern ([§1.11.8](../../atrib-spec.md#1118-carriage)). `cert_hash`, `principal_key`, and every walk fact MAY appear in public projections; the certificate body MAY be surfaced (public-key/scope/timestamp only), unlike raw tokens in other profiles.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§1.11.4](../../atrib-spec.md#1114-verifier-walk), [§1.11.8](../../atrib-spec.md#1118-carriage)
- [D140](../../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Certificate corpus: [`spec/conformance/delegation-certificates/`](../../spec/conformance/delegation-certificates/); envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
