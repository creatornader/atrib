# atrib spec §1.2.6 conformance corpus

Test fixtures for `provenance_token` per spec §1.2.6 (D044).

The corpus is the shared contract between every implementation that
produces or consumes records carrying `provenance_token`. It is used by
`@atrib/verify`, `services/atrib-emit`, and any third-party
implementation that asserts the §1.2.6 invariants.

## Cases

| File | Asserts |
|---|---|
| `cases/genesis-with-provenance.json` | Canonical form with `provenance_token` present. JCS sorts the field between `informed_by` and `session_token` (i < p < s). Signature round-trips. Validators + verifiers MUST accept. |
| `cases/upstream-derivation.json` | Token derivation: `provenance_token = base64url(sha256(JCS(upstream))[:16])`. Implementations producing a downstream session-genesis record MUST derive the token from the upstream record's canonical-form hash. |
| `cases/non-genesis-with-provenance.json` | Genesis-record-only invariant. A record carrying `provenance_token` with `chain_root != genesisChainRoot(context_id)` MUST be rejected by validators (§2.6.1) and flagged by verifiers (§5.5). The signature itself is valid; rejection is at the policy layer. |
| `cases/omits-when-absent.json` | Absence-not-null. A record without anchoring MUST omit `provenance_token` entirely (not `null`, not `""`). The canonical signing input differs from a record that includes `provenance_token: ""`, an implementation that emits empty string instead of omission produces a different signature. |

## Generator

`packages/log-dev/scripts/generate-conformance-1.2.6.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.2.6.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce
byte-identical files. Regenerate when:

- §1.2.6 derivation invariant changes
- Canonical record format (§1.2 / §1.3) changes
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-1.2.6.test.ts` loads each case and
asserts every expected field. Conforming third-party implementations
SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial four-case corpus shipped.** The four cases collectively cover
the §1.2.6 contract: canonical-form with the field, derivation from
upstream, genesis-only rejection, absence-not-null. Future cases (e.g.
malformed-token-rejection, length-edge-cases) can be added by extending
the generator.
