# Delegation and capabilities

> atrib verifies the evidence around an action. It does not issue capabilities, run authorization flows, or decide whether an agent was allowed to act.

**Status**: DRAFT (v1, 2026-06-01; strategic boundary note)
**Spec anchors**: [§5.5.6 Generic authorization evidence blocks](../../atrib-spec.md#556-generic-authorization-evidence-blocks), [§6.7 Capability declarations](../../atrib-spec.md#67-capability-declarations), [§8.7 Adversarial Threat Model](../../atrib-spec.md#87-adversarial-threat-model)
**Builds on**: [Identity & the directory](03-identity-and-directory.md), [The trust model](06-trust-model.md), [Integration patterns](10-integration-patterns.md)
**Enables**: stable comparisons with OAuth, AP2, Verifiable Intent, ZCAP-LD, Vouch, AINS, UPIP, and other agent authorization systems

## Position

atrib is a verifiable action substrate. It records what an agent did, who signed the record, how that action links to earlier work, and which external evidence a verifier accepted.

Delegation and capability protocols answer a different question: who may ask whom to do what, under which constraints, and how that authority can be attenuated. OAuth, ZCAP-LD, AP2, Verifiable Intent, Vouch, and host policy engines live in that authorization layer.

The intended boundary:

| Layer                  | Responsibility                                                                              | atrib role     |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| Authorization protocol | Issue grants, tokens, mandates, capability chains, or delegation credentials                | External input |
| Host runtime           | Enforce access before a tool runs                                                           | External input |
| atrib producer         | Sign the action and optionally capture selected evidence                                    | Native         |
| atrib verifier         | Verify record signatures, graph structure, evidence blocks, and capability-envelope signals | Native         |
| Consumer policy        | Decide whether the evidence is enough                                                       | External input |

## Native support

atrib should offer native support for delegation and capability systems at the verifier and evidence boundary:

- `verifyRecord()` accepts generic `evidence[]` blocks for authorization and delegation evidence.
- Evidence blocks expose `valid`, `protocol`, `issuer`, `subject`, `scope`, `attenuation_ok`, `delegation_ok`, `constraints`, `errors`, and `warnings`.
- `@atrib/mcp` can capture MCP/OAuth evidence from already-validated host `authInfo` into local sidecar material.
- `@atrib/verify` can check OAuth / MCP claims, MCP protected-resource binding, scope attenuation, authorization details, DPoP proof material, and caller-supplied introspection results.
- Directory identity claims may declare capability envelopes. Verifiers flag out-of-envelope records as signals, not as record-validity failures.

This is native support for assessing external authority. It is not native issuance or enforcement of authority.

## What atrib should not do now

atrib should not become a delegation protocol by default.

- It should not mint OAuth tokens, ZCAP chains, Vouch credentials, AP2 mandates, or Verifiable Intent credentials.
- Runtime tool access belongs to the host runtime.
- `verifyRecord()` should not call introspection endpoints. The caller owns network policy, secrets, trust roots, and timeouts.
- Authorization evidence should stay outside base record validity. A record can be cryptographically valid while its authorization evidence is missing, weak, stale, or failed.
- A universal grant language should wait for concrete implementation demand.

The base record says, "this signer made this signed claim at this time." Evidence blocks say, "these external authorization facts were checked this way." Consumer policy decides whether to accept the combination.

## Delegation depth

The delegation-depth critique applies to protocols that issue or enforce delegation chains. If a protocol imposes a hard maximum depth, the agent at the limit cannot attenuate its authority for a sub-agent. It may instead proxy broad credentials, which can be less usable and less safe.

Current atrib avoids that trap by staying out of issuance and enforcement. It does not cap delegation depth. It records agent handoffs as signed actions, preserves different `creator_key` values in the same `context_id`, and can verify external evidence that describes attenuation or delegation.

If atrib ever adds native capability issuance, it should start from two rules:

- No arbitrary delegation-depth cap.
- Attenuation must be first-class: a delegate should be able to pass a narrower grant than the grant it received.

Until then, the correct product move is adapters and evidence projection, not a new atrib-native capability chain.

## Comparison map

| System                  | What it contributes                                                           | How atrib composes                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| OAuth / MCP             | Tokens, scopes, protected-resource metadata, DPoP, introspection              | Verify as `mcp_oauth` evidence, capture selected host facts, keep raw tokens local                                               |
| AP2 / Verifiable Intent | Mandates, receipts, intent credentials, payment authorization evidence        | Verify as AP2 / VI evidence off the transaction detector path                                                                    |
| ZCAP-LD                 | Capability delegation and attenuation                                         | Candidate evidence adapter when an integrator brings real artifacts                                                              |
| Vouch                   | Agent identity, intent attestation, heartbeat, and delegation-chain claims    | Candidate evidence adapter if implementation usage appears                                                                       |
| AINS                    | Agent discovery, endpoints, capability metadata, and registry trust opinions  | Candidate resolver input for directory claims, `resolvedFacts`, or optional evidence blocks; trust scores stay external opinions |
| UPIP                    | Process-state fork tokens, capability requirements, and continuation evidence | Candidate evidence inside continuation packets or archive bodies; does not replace `informed_by` handoff                         |
| Host policy engine      | Runtime enforcement before tools execute                                      | Produces local facts and evidence; atrib records and verifies after the fact                                                     |

## Follow-up

A hosted Cloudflare Worker / Durable Object reference for shared DPoP replay-cache checks and host-owned OAuth introspection would make [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) more concrete. It remains an example track, not missing protocol scope. [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) intentionally keeps replay-cache deployment and introspection endpoints host-owned.

## See also

- Spec: [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks), [§6.7](../../atrib-spec.md#67-capability-declarations), [§8.7](../../atrib-spec.md#87-adversarial-threat-model)
- Decisions: [D051 Capability-scoped records](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes), [D109 MCP/OAuth evidence](../../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110 producer capture](../../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111 host-owned OAuth evidence infrastructure](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)
- Concepts: [The trust model](06-trust-model.md), [Identity & the directory](03-identity-and-directory.md), [Payments integration](08-payments-integration.md), [TIBET and Humotica crosswalk](14-tibet-humotica-crosswalk.md)
