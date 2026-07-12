# Evidence profile: `oauth2`

- **Type URI:** `https://atrib.dev/v1/evidence/oauth2`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Mapped 1:1 from the legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) `oauth2` protocol string; the legacy string set is frozen.

Carries OAuth 2.x access-token authorization results for a signed agent action. This is verifier-side authorization evidence: it never alters record signature verification or `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media types and hash rule

| Media type         | Payload                                | Hash rule                    |
| ------------------ | -------------------------------------- | ---------------------------- |
| `application/jwt`  | Compact JWS access token (UTF-8 bytes) | raw bytes (`rawSha256`)      |
| `application/json` | Introspection response / claims object | JCS (RFC 8785, `jcsSha256`)  |

`payload.hash` = `"sha256:" + hex(SHA-256(bytes))`. Raw token/introspection bytes are local-only (`payload.inline` only under `ref.kind: "inline"`); public projections carry the hash and sanitized facts, never the token.

## Facts schema

| Fact             | JSON type          | Provenance class  |
| ---------------- | ------------------ | ----------------- |
| `issuer`         | string \| null     | verifier-derived  |
| `subject`        | string \| null     | verifier-derived  |
| `scope`          | string[]           | verifier-derived  |
| `attenuation_ok` | boolean \| null    | verifier-derived  |
| `delegation_ok`  | boolean \| null    | verifier-derived  |
| `details_hash`   | string (sha256:)   | verifier-derived  |

`details_hash` commits to the verifier's `details` block (token/DPoP/audience/resource checks) via JCS; the block itself is never inlined.

## Tier semantics

- `declared`: hash and facts asserted, nothing checked.
- `shape`: token/introspection parsed and structurally validated offline.
- `attested`: a caller-owned introspection path accepted the token ([D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)). The legacy-mapping default tier.
- `verified`: signature verified against declared JWKS/issuer with scope, audience, resource, and DPoP constraints reproducible from the envelope.

## Verifier behavior

`verifyOAuthAuthorizationEvidence` in `@atrib/verify` produces the facts and `result.constraints` (`scope`, `audience`, `resource`, `authorization_details`, `issuer`, `subject`, `client_id`, `cnf.jkt`, DPoP `htm`/`htu`/`jti`/`iat`/`ath`/`nonce`). Failing constraints set `result.valid: false` but never flip record validity.

## Sanitization contract

Public projections MAY carry: profile URI, tier, `payload.hash`, `issuer`, `subject`, `scope`, `attenuation_ok`, `delegation_ok`, `details_hash`, and `result` constraint statuses. Raw access tokens, introspection bodies, and DPoP proofs MUST NOT appear ([D110](../../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop)).

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks)
- [D109](../../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110](../../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Profile-internal corpus: [`spec/conformance/5.5.6/oauth/`](../../spec/conformance/5.5.6/oauth/); envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
