# AP2 / VI crypto conformance corpus

Pinned offline adversarial cases for AP2 receipt JWTs and Verifiable Intent
SD-JWT evidence checks.

This corpus is the hardened layer above the AP2 fixture corpus in
`packages/agent/test/fixtures/ap2/`. The fixture corpus proves the detector
and verifier compose against AP2-shaped evidence. This corpus fixes named
cryptographic edge behavior so dependency upgrades cannot silently change the
trust boundary.

**Ownership.** The vectors are unchanged by the
[P048](../../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core)
payments spin-out; the corpus path is a stable identifier and does not move.
The normative owner of the AP2 / VI evidence-check catalog is now
[payments profile §11](../../../docs/payments-profile.md#11-ap2--verifiable-intent-evidence-checks)
(relocated from core [§5.5.4](../../../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks),
whose anchor remains stable). The `ap2-vi` evidence-envelope profile keeps
its URI, document path, and this corpus path unchanged.

## Scope

- JOSE header policy: unsupported `alg`, unexpected `crit`, malformed compact
  JWTs.
- JWKS policy: duplicate `kid`, mismatched `alg`, unsupported `use`, and
  unsupported `key_ops`.
- Receipt JWT clocks: `iat`, `nbf`, and `exp` inside and past the skew boundary.
- Metadata resolution: inline `jwks` precedence over `jwks_uri`, and issuer
  isolation when keys share a `kid`.
- VI SD-JWT structure: duplicate disclosures, repeated digest references,
  unused disclosures, unsupported `_sd_alg`, and `nbf` boundaries.

## Reference implementation

`packages/verify/test/ap2-vi-crypto-conformance.test.ts` loads
`manifest.json` and applies each mutation to local deterministic fixture
material. Static-JWKS cases use a fetch function that throws on any network
attempt.

## Regeneration

There is no external generator. Case inputs are deterministic and derived
inside the reference test from fixed test-only P-256 seeds. Update
`manifest.json` and the reference test together when [§5.5.4](../../../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks)
or the AP2 / VI verifier's named failure codes change.
