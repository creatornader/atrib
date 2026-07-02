# Proof x401 Open-Thread Map

Status checked on 2026-07-02 with `gh issue view`, `gh pr view`, `gh release list`, `npm view`, and the local Proof repo-surface guard.

This document maps the current Proof x401 issue and PR surface to atrib's local implementation. It is a working integration map, not an upstream spec fork.

## Proof Repo Surface

| Repo                      | Current use for atrib                                   | Upstream posture                                                                              |
| ------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `proof/x401`              | Current spec source and issue/PR surface.               | Track first. Any upstream contribution should target this repo unless the change is SDK-only. |
| `proof/x401-node`         | Released current-spec x401 wire SDK.                    | Private integration dependency is now allowed through `@proof.com/x401-node@0.3.0`.           |
| `proof/proof-vc-common`   | Opt-in credential request and verifier helper surface.  | `@proof.com/proof-vc-common` requests VP tokens; `@proof.com/proof-vc-server` verifies them.  |
| `proof/proof-vc-web`      | Credential Manager and browser UX reference.            | Browser-demo scope only. It is not an x401 wire implementation.                               |
| `proof/verifier-vcp-demo` | Demo reference for Proof's own route and verifier flow. | Reference only until it uses current x401 wire names.                                         |

The local guard for this table is:

```bash
pnpm --filter @atrib/integration proof-repo-interop -- --repo-root /tmp/proof-repos-x401-map
```

The command classifies each Proof repo by role. Only a current-spec x401 wire SDK can become an atrib public package or core runtime dependency. `proof-vc-common` is a credential request and verifier helper surface. `proof-vc-web` stays browser-demo scoped because it is a credential collection UX surface. `verifier-vcp-demo` stays reference-only while it uses legacy x401 headers. That is a scope judgment for atrib's interop claim, not a judgment that either repo is poorly built.

## Tracked Issues And PRs

| Thread                                                                                                 | Proof question                                                                                                          | atrib side                                                                                                                                                                                                                                                                                                                        | Upstream contribution path                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [proof/x401#21](https://github.com/proof/x401/issues/21), Generalize to Request and Response           | Rename draft headers to `PROOF-REQUEST`, `PROOF-RESPONSE`, and `PROOF-RESULT`.                                          | Closed upstream on 2026-06-29. Implemented in atrib and released in `@proof.com/x401-node@0.3.0`. The private SDK fixture now runs the released npm SDK directly, and legacy names stay drift guards unless strict mode disables them.                                                                                            | Done unless Proof asks for follow-up vectors.                                                                                                                                                                         |
| [proof/x401#29](https://github.com/proof/x401/issues/29), Multi-endpoint Requests                      | Decide how an agent handles many proof-gated endpoints, either delegated credentials or combined on-behalf-of requests. | Locally addressed by composition, not by inventing x401 semantics. `runX401MultiEndpointHarness()` records each endpoint action and its x401 evidence as separate signed records in one `context_id`, then links follow-up records through `informed_by`. Combined request formats stay upstream-owned.                           | Commented with the separate-record composition pattern on 2026-07-01: [issue comment](https://github.com/proof/x401/issues/29#issuecomment-4859577541). Add fixture vectors once the request-composition shape lands. |
| [proof/x401#22](https://github.com/proof/x401/issues/22), Agent-asserted origin for middleman handling | Define how an agent or middleman asserts origin.                                                                        | Locally addressed as caller-owned verifier facts. atrib signs the action with `creator_key`, can require `expectedAgentId`, can record `agentOriginVerified`, hashes origin references in public details, and binds successful actions to prior attempts. It does not claim HTTP Origin semantics.                                | Commented with the caller-owned origin evidence boundary on 2026-07-01: [issue comment](https://github.com/proof/x401/issues/22#issuecomment-4859578727).                                                             |
| [proof/x401#20](https://github.com/proof/x401/issues/20), Issuer trust list generalization             | Avoid locking trust lists to one DIF shape.                                                                             | Closed upstream on 2026-06-29. atrib keeps issuer trust caller-owned: `@atrib/verify` accepts `issuerTrustVerified`, `issuerTrustRootType`, and a hashed `issuerTrustRootRef` after the host or Proof verifier evaluates issuer trust.                                                                                            | Track PR #32 for concrete trusted-authority fields. Do not hard-code DIF, TRQP, OpenID Federation, ETSI, or AKI inside atrib.                                                                                         |
| [proof/x401#19](https://github.com/proof/x401/issues/19), User interaction non-goal                    | Clarify whether user interaction is required.                                                                           | Addressed by local boundary only. x401 evidence says a proof gate was checked. It does not say the user was present. If a host needs human approval, use a separate signed approval or action-gate decision and link it through `informed_by`.                                                                                    | No active atrib comment. The prior comment was deliberately deleted because the thread did not need another implementer note.                                                                                         |
| [proof/x401#18](https://github.com/proof/x401/issues/18), Credential Manager terminology               | Use Credential Manager instead of wallet in technical docs.                                                             | Closed upstream on 2026-06-29. atrib docs avoid wallet-native wording unless quoting upstream PR text or a chain-specific profile name.                                                                                                                                                                                           | Done unless upstream asks for doc review.                                                                                                                                                                             |
| [proof/x401#17](https://github.com/proof/x401/pull/17), Agent Identifiers and proof/payment binding    | Bind agent identity to proof and optional payment.                                                                      | Locally addressed at the evidence boundary. atrib treats `agent_id` as x401 evidence, records optional `proofPaymentBindingVerified` plus a hashed binding reference, and keeps AP2, x402, MPP, ACP, UCP, or a2a-x402 payment evidence separate. The action record's `creator_key` proves which atrib signer produced the action. | Commented with the separate proof/payment evidence boundary on 2026-07-01: [PR comment](https://github.com/proof/x401/pull/17#issuecomment-4859579935).                                                               |
| [proof/x401#32](https://github.com/proof/x401/pull/32), `trqp_v2` trusted authorities                  | Add TRQP v2 trusted authority type.                                                                                     | Locally addressed as caller-owned trust evidence. The current adapter can record a host-accepted `issuerTrustVerified` outcome, `issuerTrustRootType`, and a hashed root reference, but does not verify TRQP.                                                                                                                     | Wait for x401's issuer-trust model. Then map the upstream authority fields into the neutral evidence shape if needed.                                                                                                 |

## Local Completion Bar

The atrib side is done for current-spec local E2E when one command proves:

- a protected endpoint emits `PROOF-REQUEST`;
- an agent retries with `PROOF-RESPONSE`;
- wrong request id and stale nonce fail;
- local credential verification can accept a signed JWT VC / VP without a Proof platform account;
- a successful action is signed and linked to the attempted action;
- multi-endpoint propagation keeps separate request ids and signed action records in one context;
- x401 evidence verifies through `@atrib/verify`;
- x401 and AAuth evidence can verify on the same successful action without merging their semantics;
- optional agent-origin, issuer-trust, and proof-payment binding facts are recorded as caller-owned verifier outcomes;
- raw credential payloads stay out of the public log and default archive projection;
- the Explorer shows proof-gate status and payment separation;
- optional AAuth, AP2 / VI, or x402 evidence remains separate from x401 semantics.

The native Proof SDK bar is now met against the released npm SDK: the private integration fixture imports `@proof.com/x401-node@0.3.0`, runs its real verifier and agent helpers, emits `PROOF-REQUEST` and `PROOF-RESPONSE` directly, verifies the resulting atrib action chain, and proves strict current-spec verification rejects raw legacy headers.

The public x401 E2E bar is met without a Proof platform account by the open local credential verifier:

```bash
pnpm --filter @atrib/integration open-x401-credential-e2e
```

That path issues a local JWT VC, presents it inside a signed VP token, verifies holder signature, issuer signature, trusted issuer key, audience, x401 nonce, age, and KYC claims, accepts the `PROOF-RESPONSE`, and signs the atrib action chain. It uses `@proof.com/x401-node@0.3.0` for current x401 wire semantics but keeps credential verification provider-neutral.

Write the durable public packet for that path with:

```bash
pnpm --filter @atrib/integration open-x401-credential-packet
```

The packet lands in `proof-packets/x401-open-credential-e2e/` with verifier output, provenance, and a redaction manifest. It is the upstream-facing artifact for public x401 protocol evidence. It is offline-local by design and does not claim Proof-hosted credential acceptance.

Run that native fixture with:

```bash
pnpm --filter @atrib/integration proof-x401-node-runtime-interop
```

Use `-- --require-native-current-spec --require-current-evidence` when a check should fail unless the released SDK is current-spec and the resulting atrib evidence verifies.

Use the Proof VC verifier fixture when checking the credential-verifier handoff into x401 evidence:

```bash
pnpm --filter @atrib/integration proof-vc-common-x401-interop -- --require-current-evidence --require-proof-vc-common
```

The default path uses a local fixture verifier. Set `ATRIB_PROOF_VC_COMMON_LIVE=1` and `ATRIB_PROOF_VC_COMMON_VP_TOKEN=<token>` only when a real Proof VP token should be verified by `@proof.com/proof-vc-server`. The live path verifies that the credential key-binding nonce matches the x401 nonce before setting `resultVerified: true`. This is Proof-hosted credential interop, not the public x401 E2E gate. It is worth running when the question is Proof-specific: whether a Proof-issued credential and Proof verifier can feed atrib's caller-owned x401 evidence. It is not the first priority for the public protocol claim. Set `ATRIB_PROOF_VC_COMMON_TRUST_ROOT=development` for sandbox or development credentials, or `production` for production credentials.

To obtain a real Proof VP token, run the localhost capture helper:

```bash
ATRIB_PROOF_VC_CAPTURE_CLIENT_ID=<proof-oauth-client-id> \
ATRIB_PROOF_VC_CAPTURE_LOGIN_HINT=<holder-email> \
pnpm --filter @atrib/integration proof-vc-token-capture -- --open
```

That helper uses `@proof.com/proof-vc-common@0.3.0` to create the OID4VP authorization URL, captures the browser fragment on a local callback page, verifies the token in memory through `@proof.com/proof-vc-server@0.3.0`, and prints only the sanitized x401 evidence packet. Use `-- --print-url` to print the authorization URL without waiting for a browser callback. A real Proof credential, a Proof OAuth Application client id, a registered redirect URI matching the local callback, and the holder email as `ATRIB_PROOF_VC_CAPTURE_LOGIN_HINT` are required. Set `ATRIB_PROOF_VC_CAPTURE_AUD` when the verifier must check an expected audience.

The live npm Proof-side SDK interop bar is now met by `@proof.com/x401-node@0.3.0`. Keep the readiness guard so future releases fail closed if old wire names reappear.

Run the live readiness guard before making or keeping that claim:

```bash
pnpm --filter @atrib/integration x401-proof-sdk-compat
```

The command prints the latest `@proof.com/x401-node` compatibility report from npm. Add `-- --require-compatible` when a release or PR must fail closed unless the SDK exposes the current header and payload names.

## Upstream Result

Upstream PR and release:

- [proof/x401-node#7](https://github.com/proof/x401-node/pull/7), `fix: sync current x401 wire names`, merged on 2026-06-30.
- [`@proof.com/x401-node@0.3.0`](https://www.npmjs.com/package/@proof.com/x401-node/v/0.3.0), released on 2026-06-30.

Original candidate issue or PR title, preserved for traceability:

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
