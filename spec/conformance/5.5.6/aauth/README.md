# AAuth authorization evidence conformance corpus

Offline cases for AAuth evidence blocks in
[`@atrib/verify`](../../../../packages/verify/src/aauth-evidence.ts) and
[§5.5.6](../../../../atrib-spec.md#556-generic-authorization-evidence-blocks).

AAuth evidence is verifier-side authorization evidence, not base atrib record
validity. The corpus pins the boundary:

- AAuth tokens and HTTP signature facts can be projected into `evidence[]`.
- The verifier checks supplied claims, trusted local JWKS, constraints, and
  caller-supplied HTTP-signature facts.
- The verifier does not fetch AAuth metadata, call a Person Server, issue
  tokens, run interaction flows, or store raw JWTs by default.
- Failed AAuth evidence leaves the signed atrib record valid; consumers decide
  policy from the tiered evidence block.

The cases cover:

- Agent-token identity evidence.
- Resource-token scope and `agent_jkt` evidence.
- Auth-token `act`, mission, and R3 evidence.
- `cnf.jwk` mismatch failure.
- Expired claim failure.
- `AAuth-Access` requests where the `authorization` header was not covered by
  the HTTP message signature.
- Missing `act` on auth tokens.

`packages/verify/test/aauth-evidence-conformance.test.ts` loads the manifest,
builds deterministic local JWTs where needed, and verifies every expected
evidence result without network access.
