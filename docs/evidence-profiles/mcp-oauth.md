# Evidence profile: `mcp-oauth`

- **Type URI:** `https://atrib.dev/v1/evidence/mcp-oauth`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. Mapped 1:1 from the legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) `mcp_oauth` protocol string (frozen legacy set).

Carries MCP-authorization-server results for a signed tool call: an OAuth access token bound to an MCP resource, with the MCP protected-resource metadata and (optionally) a DPoP proof of possession. Verifier-side authorization evidence; never alters `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media types and hash rule

| Media type         | Payload                                       | Hash rule                   |
| ------------------ | --------------------------------------------- | --------------------------- |
| `application/jwt`  | Compact JWS access token (UTF-8 bytes)        | raw bytes (`rawSha256`)     |
| `application/json` | Introspection / claims / protected-resource   | JCS (RFC 8785, `jcsSha256`) |

`payload.hash` = `"sha256:" + hex(SHA-256(bytes))`. Tokens and DPoP proofs stay local-only.

## Facts schema

| Fact             | JSON type        | Provenance class |
| ---------------- | ---------------- | ---------------- |
| `issuer`         | string \| null   | verifier-derived |
| `subject`        | string \| null   | verifier-derived |
| `scope`          | string[]         | verifier-derived |
| `attenuation_ok` | boolean \| null  | verifier-derived |
| `delegation_ok`  | boolean \| null  | verifier-derived |
| `details_hash`   | string (sha256:) | verifier-derived |

The `mcp-oauth` profile differs from `oauth2` in the checks the verifier runs (MCP resource binding, protected-resource `authorization_servers`, DPoP `cnf.jkt` binding), not in the fact vocabulary; those checks are committed under `details_hash`.

## Tier semantics

- `declared` / `shape`: asserted / offline-parsed.
- `attested`: caller-owned introspection accepted the token ([D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)); legacy-mapping default.
- `verified`: token signature and DPoP proof verified against declared JWKS with the MCP resource binding reproducible.

## Verifier behavior

`verifyOAuthAuthorizationEvidence` with `protocol: 'mcp_oauth'`. Adds resource-binding and DPoP replay-cache checks over the `oauth2` behavior; a failed DPoP `jti` (replay) or resource mismatch sets `result.valid: false` only.

## Sanitization contract

Same as `oauth2`: hashes and sanitized facts only; raw tokens, introspection bodies, DPoP proofs never surfaced ([D110](../../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop)).

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks)
- [D109](../../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110](../../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Profile-internal corpus: [`spec/conformance/5.5.6/oauth/`](../../spec/conformance/5.5.6/oauth/); envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
