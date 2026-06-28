# Proof x401 Open-Thread Map

Status checked on 2026-06-28 with `gh issue list` and `gh pr list` across the public Proof organization repositories.

This document maps the current Proof x401 issue and PR surface to atrib's local implementation. It is a working integration map, not an upstream spec fork.

## Proof Repo Surface

| Repo                      | Current use for atrib                                   | Upstream posture                                                                                |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `proof/x401`              | Current spec source and issue/PR surface.               | Track first. Any upstream contribution should target this repo unless the change is SDK-only.   |
| `proof/x401-node`         | Pinned private SDK fixture target and upstream PR.       | Keep out of core/public runtime deps until npm exposes the hosted current header names.         |
| `proof/proof-vc-common`   | Possible future credential-verifier fixture helper.     | Use only for Proof-specific E2E once x401 header semantics are stable.                          |
| `proof/proof-vc-web`      | Credential Manager and browser UX reference.            | Not part of atrib core.                                                                         |
| `proof/verifier-vcp-demo` | Demo reference for Proof's own route and verifier flow. | Reference only until it updates from old x401 package shapes.                                   |

The local guard for this table is:

```bash
pnpm --filter @atrib/integration proof-repo-interop -- --repo-root /tmp/proof-repos-x401-map
```

The command classifies each Proof repo by role. Only a current-spec x401 wire SDK can become an atrib public package or core runtime dependency. `proof-vc-common` can become a credential-verifier fixture helper, `proof-vc-web` stays browser-demo scoped, and `verifier-vcp-demo` stays reference-only while it uses legacy x401 headers.

## Open Issues And PRs

| Thread                                                                                                 | Proof question                                                                                                          | atrib side                                                                                                                                                                                                                                                                                                                                                        | Upstream contribution path                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [proof/x401#21](https://github.com/proof/x401/issues/21), Generalize to Request and Response           | Rename draft headers to `PROOF-REQUEST`, `PROOF-RESPONSE`, and `PROOF-RESULT`.                                          | Implemented. `@atrib/verify`, the x401 corpus, the producer capture helper, and the local proof-gate harness use the current names. The private SDK fixture now pins `creatornader/x401-node@338b785` from [proof/x401-node#7](https://github.com/proof/x401-node/pull/7) and runs the current-spec Proof SDK helpers natively. Legacy names are accepted only as drift guards unless strict mode disables them. | Track [proof/x401-node#7](https://github.com/proof/x401-node/pull/7). Add more SDK test vectors if upstream asks for smaller follow-ups.             |
| [proof/x401#29](https://github.com/proof/x401/issues/29), Multi-endpoint Requests                      | Decide how an agent handles many proof-gated endpoints, either delegated credentials or combined on-behalf-of requests. | Locally addressed by composition, not by inventing x401 semantics. `runX401MultiEndpointHarness()` records each endpoint action and its x401 evidence as separate signed records in one `context_id`, then links follow-up records through `informed_by`. Combined request formats stay upstream-owned.                                                           | Ask for request id, endpoint id, audience, and replay rules for multi-endpoint flows. Add fixture vectors once the request-composition shape lands. |
| [proof/x401#22](https://github.com/proof/x401/issues/22), Agent-asserted origin for middleman handling | Define how an agent or middleman asserts origin.                                                                        | Locally addressed as caller-owned verifier facts. atrib signs the action with `creator_key`, can require `expectedAgentId`, can record `agentOriginVerified`, hashes origin references in public details, and binds successful actions to prior attempts. It does not claim HTTP Origin semantics.                                                                | Propose guidance for binding `agent_id`, asserted origin, request id, and proof response. Atrib can provide the external audit-log pattern.         |
| [proof/x401#20](https://github.com/proof/x401/issues/20), Issuer trust list generalization             | Avoid locking trust lists to one DIF shape.                                                                             | Locally addressed as caller-owned verifier facts. `@atrib/verify` accepts `issuerTrustVerified`, `issuerTrustRootType`, and a hashed `issuerTrustRootRef` after the host or Proof verifier evaluates issuer trust. atrib stores the accepted outcome and safe hashes, not the trust registry itself.                                                              | Ask upstream which trust-root fields should become canonical. Do not hard-code DIF, TRQP, OpenID Federation, ETSI, or AKI inside atrib.             |
| [proof/x401#19](https://github.com/proof/x401/issues/19), User interaction non-goal                    | Clarify whether user interaction is required.                                                                           | Addressed by boundary. x401 evidence says a proof gate was checked. It does not say the user was present. If a host needs human approval, use a separate signed approval or action-gate decision and link it through `informed_by`.                                                                                                                               | Agree with adding a non-goal. Keep user-presence or consent UX out of atrib's x401 adapter.                                                         |
| [proof/x401#18](https://github.com/proof/x401/issues/18), Credential Manager terminology               | Use Credential Manager instead of wallet in technical docs.                                                             | Addressed in new atrib-facing x401 docs. Avoid wallet-native wording unless quoting upstream PR text or a chain-specific profile name.                                                                                                                                                                                                                            | No atrib PR needed unless upstream asks for doc review.                                                                                             |
| [proof/x401#17](https://github.com/proof/x401/pull/17), Agent Identifiers and proof/payment binding    | Bind agent identity to proof and optional payment.                                                                      | Locally addressed at the evidence boundary. atrib treats `agent_id` as x401 evidence, records optional `proofPaymentBindingVerified` plus a hashed binding reference, and keeps AP2, x402, MPP, ACP, UCP, or a2a-x402 payment evidence separate. The action record's `creator_key` proves which atrib signer produced the action.                                 | Comment or PR with a fixture-backed external audit-log pattern after local x401 E2E is stable. Do not collapse proof and payment semantics.         |
| [proof/x401#32](https://github.com/proof/x401/pull/32), `trqp_v2` trusted authorities                  | Add TRQP v2 trusted authority type.                                                                                     | Locally addressed as caller-owned trust evidence. The current adapter can record a host-accepted `issuerTrustVerified` outcome, `issuerTrustRootType`, and a hashed root reference, but does not verify TRQP.                                                                                                                                                     | Wait for x401's issuer-trust model. Then map the upstream authority fields into the neutral evidence shape if needed.                               |

## Local Completion Bar

The atrib side is done for current-spec local E2E when one command proves:

- a protected endpoint emits `PROOF-REQUEST`;
- an agent retries with `PROOF-RESPONSE`;
- wrong request id and stale nonce fail;
- a successful action is signed and linked to the attempted action;
- multi-endpoint propagation keeps separate request ids and signed action records in one context;
- x401 evidence verifies through `@atrib/verify`;
- x401 and AAuth evidence can verify on the same successful action without merging their semantics;
- optional agent-origin, issuer-trust, and proof-payment binding facts are recorded as caller-owned verifier outcomes;
- raw credential payloads stay out of the public log and default archive projection;
- the Explorer shows proof-gate status and payment separation;
- optional AAuth, AP2 / VI, or x402 evidence remains separate from x401 semantics.

The pinned native Proof SDK bar is now met for a current-spec Node implementation: the private integration fixture imports `@proof.com/x401-node` from `github:creatornader/x401-node#338b785ac60b6021873d384a916fd405f561915a`, runs its real verifier and agent helpers, emits `PROOF-REQUEST` and `PROOF-RESPONSE` directly, verifies the resulting atrib action chain, and proves strict current-spec verification rejects raw legacy headers.

Run that native fixture with:

```bash
pnpm --filter @atrib/integration proof-x401-node-runtime-interop
```

Use `-- --require-native-current-spec --require-current-evidence` when a check should fail unless the pinned SDK is current-spec and the resulting atrib evidence verifies.

The live npm Proof-side interop bar is still higher. Do not claim live npm current-spec Proof SDK interop until `@proof.com/x401-node` itself publishes the current header and payload names. The pinned fixture can pass while the live npm readiness guard below still fails.

Run the live readiness guard before changing that claim:

```bash
pnpm --filter @atrib/integration x401-proof-sdk-compat
```

The command prints the latest `@proof.com/x401-node` compatibility report from npm. Add `-- --require-compatible` when a release or PR must fail closed until the SDK exposes the current header and payload names.

## Upstream Draft

Upstream PR:

- [proof/x401-node#7](https://github.com/proof/x401-node/pull/7), `fix: sync current x401 wire names`.

Original candidate issue or PR title:

```text
fix: sync x401-node examples with current proof headers
```

Draft body:

```markdown
The hosted x401 spec now uses `PROOF-REQUEST`, `PROOF-RESPONSE`, `PROOF-RESULT`, and `credential_requirements.digital`.

The current Node package and demo material still appear to expose older draft names such as `PROOF-REQUIRED`, `PROOF-PRESENTATION`, and `presentation_requirements`. The sharpest compatibility issue is that old `PROOF-RESPONSE` meant the verifier's response, while the current spec uses `PROOF-RESPONSE` for the agent's proof response.

Suggested fixture coverage:

- verifier sends `PROOF-REQUEST`;
- agent sends `PROOF-RESPONSE`;
- verifier sends `PROOF-RESULT` for result or error;
- request id mismatch fails;
- result-by-reference and direct result artifact both have test vectors;
- agent-origin, issuer-trust, and proof-payment binding have clear evidence fields;
- multi-endpoint examples show how request ids and endpoint audiences compose;
- payment hints remain separate from `402` payment protocol evidence.

Happy to split this into SDK constants/types and examples if that is easier to review.
```
