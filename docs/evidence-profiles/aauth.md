# Evidence profile: `aauth`

- **Type URI:** `https://atrib.dev/v1/evidence/aauth`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Mapped 1:1 from the legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) `aauth` protocol string (frozen legacy set).

Carries AAuth agent-authorization results: agent tokens, resource tokens, auth tokens, mission claims, HTTP message signatures, and R3 (resource-request-restriction) evidence for a signed agent action. Verifier-side only; never alters `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media types and hash rule

| Media type         | Payload                                     | Hash rule                   |
| ------------------ | ------------------------------------------- | --------------------------- |
| `application/jwt`  | Compact AAuth token (`aa-agent+jwt`, UTF-8) | raw bytes (`rawSha256`)     |
| `application/json` | Claims / mission / R3 / signature evidence  | JCS (RFC 8785, `jcsSha256`) |

`payload.hash` = `"sha256:" + hex(SHA-256(bytes))`. Raw tokens and HTTP-signature material stay local-only.

## Facts schema

| Fact             | JSON type        | Provenance class |
| ---------------- | ---------------- | ---------------- |
| `issuer`         | string \| null   | verifier-derived |
| `subject`        | string \| null   | verifier-derived |
| `scope`          | string[]         | verifier-derived |
| `attenuation_ok` | boolean \| null  | verifier-derived |
| `delegation_ok`  | boolean \| null  | verifier-derived |
| `details_hash`   | string (sha256:) | verifier-derived |

`delegation_ok` reflects the AAuth `act` chain; `details_hash` commits the token kind, `typ`, mission, R3, HTTP-signature covered components, and access mode.

## Tier semantics

- `declared` / `shape`: asserted / offline-parsed AAuth token.
- `attested`: a caller-owned AAuth path accepted the token; legacy-mapping default.
- `verified`: token signature, HTTP message signature, and R3 document hash verified against declared keys, reproducible from the envelope.

## Verifier behavior

`verifyAAuthAuthorizationEvidence` in `@atrib/verify` produces `result.constraints` for scope, `aauth.typ`, mission, R3 grants/`s256`/document-hash, and HTTP-signature coverage. Failures set `result.valid: false` only.

## Sanitization contract

Hashes and sanitized facts only; raw AAuth tokens, HTTP-signature inputs, and R3 documents MUST NOT appear in public projections.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks)
- [D119](../../DECISIONS.md#d119-aauth-evidence-stays-verifier-side), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Profile-internal corpus: [`spec/conformance/5.5.6/aauth/`](../../spec/conformance/5.5.6/aauth/); envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
