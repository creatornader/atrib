# OAuth / MCP authorization evidence conformance corpus

Offline cases for generic authorization evidence blocks in
[`@atrib/verify`](../../../../packages/verify/README.md).

The corpus fixes the verifier boundary introduced in
[§5.5.6](../../../../atrib-spec.md#556-generic-authorization-evidence-blocks)
and [D109](../../../../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks):
authorization evidence is tiered verifier evidence, not base atrib record
validity.

## Scope

- Verified claims and JWT access-token evidence.
- MCP resource binding through `aud`, `resource`, and protected-resource metadata.
- Scope attenuation failures.
- Caller-supplied token introspection responses.
- DPoP proof checks for `htm`, `htu`, `ath`, `jti`, `iat`, and `cnf.jkt`.

## Reference implementation

`packages/verify/test/oauth-evidence-conformance.test.ts` loads
`manifest.json`, builds deterministic local JOSE material, and asserts the
expected evidence result for each case. No network access is allowed.
