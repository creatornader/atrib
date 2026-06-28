# OpenETR crosswalk

> OpenETR is adjacent transferable-record prior art. atrib should treat it as an evidence source and integration target, while keeping action proof, verifier policy, and title recognition in separate layers.

**Status**: DRAFT (v1, 2026-06-28; strategic comparison)
**Spec anchors**: [§1.7.6 Cross-attestation requirement](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [§2.12 Record Body Archive Layer](../../atrib-spec.md#212-record-body-archive-layer), [§5.5.6 Generic authorization evidence blocks](../../atrib-spec.md#556-generic-authorization-evidence-blocks), [§6.7 Capability declarations](../../atrib-spec.md#67-capability-declarations), [§8.7 Adversarial threat model](../../atrib-spec.md#87-adversarial-threat-model), [§9 Runtime integration patterns](../../atrib-spec.md#9-runtime-integration-patterns)
**Builds on**: [The trust model](06-trust-model.md), [Payments integration](08-payments-integration.md), [Delegation and capabilities](12-delegation-and-capabilities.md), [TIBET and Humotica crosswalk](14-tibet-humotica-crosswalk.md)
**Enables**: stable comparison with OpenETR, electronic transferable record flows, title-transfer authority evidence, and future OpenETR proof demos

## Bottom line

OpenETR and atrib meet at the boundary between signed evidence and recognized effect.

OpenETR asks: who controls this transferable record, under which signed event chain, and which attestor or title-transfer authority recognizes that chain?

atrib asks: which agent performed the action, what context or evidence informed it, which counterparty or verifier corroborated it, and can a third party check the signed trail without trusting the operator?

The fit is strong, but the layers should stay separate. An OpenETR event can be evidence inside an atrib record or proof packet. It is not an atrib record. A Nostr relay can distribute OpenETR events. It is not atrib's public Merkle log. An OpenETR attestation can help a verifier decide whether a transfer should be recognized. It does not count as atrib transaction cross-attestation unless the attestor signs the atrib record bytes.

## What OpenETR does

OpenETR is a draft electronic transferable record protocol and implementation. It starts from the MLETR problem: paper negotiable documents and instruments have legal concepts like uniqueness, integrity, and control, but digital files are easy to copy.

The OpenETR model has three main parts:

- An object or record, identified by a digest of the document or artifact.
- A controller key, usually a Nostr public key.
- Signed Nostr events declaring origin, transfer initiation, acceptance, termination, and attestations.

The current event family is small:

| OpenETR surface              | Meaning                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `31415` origin event         | Creates the initial record context for a digest-addressed object.                                                        |
| `31416` control event family | Carries transfer initiation, acceptance, and termination actions.                                                        |
| `action` tag                 | Subtypes control events as `initiate`, `accept`, or `terminate`.                                                         |
| `o` tag                      | Points at the object digest.                                                                                             |
| `e` tag                      | Points at the prior event in the control chain.                                                                          |
| `p` tag                      | Names a party in the transfer flow. The implementation should keep this semantics unambiguous before production interop. |

The important design stance is not the event numbers. It is the recognition boundary. OpenETR treats publication as evidence, not as final legal effect. Relays store and distribute events. Recognition comes from policy, counterparties, attestors, and title-transfer authorities.

## Crosswalk

| OpenETR concept          | atrib analogue                                                       | Integration posture                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object digest            | `content_id`, `_local.content.object_digest`, archive body reference | Keep the digest in signed or hash-committed material so later verifiers can bind the agent action to the same object.                                     |
| Origin event             | External evidence attached to an issue action                        | The agent action that creates or publishes the origin event should be signed by atrib. The OpenETR event id can be archived or referenced.                |
| Transfer initiate event  | High-impact tool call or extension record                            | Wrap the OpenETR CLI or API call. Use action-gate policy when transfer has financial, legal, or custody impact.                                           |
| Transfer accept event    | Counterparty acknowledgement evidence                                | Treat acceptance as external evidence unless the accepting party also signs an atrib record or signer entry.                                              |
| Termination event        | High-impact state-change action                                      | Sign the agent action separately and keep the OpenETR event as supplied evidence.                                                                         |
| Attestation event        | `evidence[]`, archive evidence, verifier resolved fact               | Attestation can make a verifier policy pass. It does not mutate base signature validity.                                                                  |
| Title-transfer authority | Directory identity claim, capability envelope, external trust anchor | A TTA key can become recognized identity or authorization evidence, not a mandatory root of trust for atrib.                                              |
| Nostr relay              | External evidence source                                             | Relay availability is useful, but atrib still needs its own log inclusion proof for atrib records.                                                        |
| Nostr event signature    | Evidence signature                                                   | Validates the OpenETR event author. It does not validate the atrib record creator.                                                                        |
| Local recognition policy | Consumer verifier policy                                             | atrib should surface facts and warnings. The consumer decides whether the transfer is recognized.                                                         |
| Nostr Silent Payments    | Payment destination or receipt-detection evidence                    | Useful for agent-commerce experiments, but it is separate from transaction detection unless a payment protocol receipt closes the atrib transaction path. |

## What not to conflate

OpenETR has a clean philosophical match with atrib because both avoid the trap of claiming too much.

These boundaries matter:

- A signed OpenETR event proves a Nostr key signed that event. It does not prove the agent was authorized to make the call.
- A relay proving an event exists is not the same as an append-only transparency-log commitment for the agent action.
- A title-transfer authority recognizing a transfer is a policy and trust fact. It is not a graph edge in atrib's fact layer.
- A counterparty accepting an OpenETR transfer is useful evidence. It is not [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross-attestation unless that party signs the atrib transaction or control record bytes.
- MLETR compatibility is a legal and operational claim. atrib should record who made that claim and which evidence was supplied, not certify the legal conclusion itself.

This matches atrib's existing AP2 stance: AP2 receipt signatures and Verifiable Intent credentials stay verifier-side evidence unless an AP2 participant signs atrib's canonical transaction bytes.

## Integration pattern

A future OpenETR proof should start as an integration example, not a normative protocol feature.

The shape:

1. The agent calls an OpenETR CLI, HTTP API, or MCP wrapper to issue, transfer, accept, query, or terminate a record.
2. atrib signs the agent-visible action with the object digest, OpenETR action, prior event id, target party, and relay set committed through `args_hash`, `result_hash`, or archive body material.
3. The proof packet stores OpenETR event ids and, when disclosure allows it, the event JSON and relay query result in the archive layer.
4. `@atrib/action-gate` signs an allow, block, or escalate decision before issue, transfer, accept, or terminate operations that affect money, title, custody, compliance, or access.
5. `@atrib/verify` attaches an `evidence[]` block for OpenETR chain checks: event signatures, object digest match, prior-event linkage, controller transition, attestor recognition, and termination status.
6. If an OpenETR counterparty or title-transfer authority wants to strengthen the atrib layer, it signs the atrib record bytes. Until then, its OpenETR signature remains external evidence.

That gives the user a clean answer: OpenETR proves the transferable-record control story. atrib proves the agent-action story around that control story.

## Worked example

An agent manages a warehouse receipt represented as an OpenETR object.

First, the agent receives a task: transfer the receipt from Seller A to Buyer B after payment clears. Before acting, the agent runs an action gate. The gate checks the agent's capability envelope, the payment receipt, the object digest, and the current OpenETR controller. It signs an allow decision.

Second, the agent calls OpenETR to publish a `31416` transfer-initiate event. atrib signs the tool call and commits the object digest, prior event id, Buyer B's public key, relays, and the action-gate decision hash.

Third, Buyer B accepts the transfer through OpenETR. atrib records the query or callback that observed the acceptance. The OpenETR accept event is attached as evidence.

Fourth, a verifier reviews the packet. It checks atrib signatures and log inclusion first. Then it checks the OpenETR evidence: object digest, event signatures, prior-event links, controller transition, and recognized attestor policy. If the OpenETR title-transfer authority also signed the atrib record bytes, cross-attestation can pass at the atrib layer too. If it only signed the OpenETR event, the verifier should say exactly that.

The result is not "atrib says title transferred." The result is narrower and stronger: "this agent made these signed calls, under this signed policy decision, against this OpenETR control chain, and these external parties supplied this evidence."

The current proof packet follows that rule in two modes. The default fixture
signs the OpenETR-shaped action chain, then signs a control-record policy
decision that stops before title recognition until public relay evidence,
title-transfer authority evidence, and legal/MLETR evidence are supplied. The
source-backed public proof runs the pinned OpenETR implementation, publishes
exact events to a configured public relay, verifies those events are available,
signs fixture title-authority and legal/MLETR attestations, resolves controller
semantics through that authority evidence, executes title recognition, and
submits the accepted atrib records plus control records to the public log.

That full path proves the technical possibility of the evidence bundle. It does
not prove a real title registry decision, legal advice, or a jurisdictional
legal conclusion.

## Implementation caution

The OpenETR implementation snapshot reviewed for this note was `trbouma/openetr` at commit `c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9` from 2026-06-01.

One current detail needs inspection before atrib treats OpenETR as a proof target. Transfer initiation appears to write `p=<transferee_pubkey_hex>`, while query logic treats the latest control event's first `p` tag as the current controller. Transfer acceptance appears to write `p=<initiator_pubkey>`. If the accept event is the latest event, a naive query may report the initiator as current controller again.

That may be a deliberate party-reference convention, or it may be implementation drift. Either way, an atrib integration should not infer control from `p` until OpenETR's transfer-state semantics are pinned by tests or spec text.

## Future OpenETR adapter

A future `protocol: "openetr"` verifier evidence adapter is plausible after the state-machine semantics settle.

The adapter should report:

- object digest match
- origin event signature status
- control event signature status
- prior-event linkage status
- declared controller or party transition
- acceptance status
- termination status
- attestor or title-transfer authority status
- relay query sources and timestamps
- warnings for replacement-event, missing-attestation, or ambiguous-party semantics

It should not change `valid`, `signatureOk`, graph derivation, calculation, or cross-attestation by itself. It should behave like AP2, VI, MCP/OAuth, and AAuth evidence: supplied by the caller, checked by the verifier, surfaced for policy.

## Strategic position

OpenETR is strongest where it makes transferable-record control explicit without hiding the legal recognition problem. That is exactly the kind of external state an agent should not freehand.

atrib is strongest where it proves the agent's path around that external state: which action was attempted, which evidence was read, which policy allowed it, which counterparty corroborated it, and which later record depended on it.

The positioning sentence:

> OpenETR can prove a record-control chain. atrib can prove the agent-action chain around it.

## Sources reviewed

- OpenETR site: <https://trbouma.github.io/openetr/>
- OpenETR repository: <https://github.com/trbouma/openetr>
- Canonical ETR Transaction Spec: <https://github.com/trbouma/openetr/blob/main/docs/specs/CANONICAL_ETR_TRANSACTION_SPEC.md>
- Event Kind Registry: <https://github.com/trbouma/openetr/blob/main/docs/specs/EVENT_KIND_REGISTRY.md>
- State Transition note: <https://github.com/trbouma/openetr/blob/main/docs/specs/STATE-TRANSITION.md>
- Title Transfer Authority spec: <https://github.com/trbouma/openetr/blob/main/docs/specs/TITLE_TRANSFER_AUTHORITY_REPLACEABLE_EVENT_SPEC.md>
- Transfer Validation Guards note: <https://github.com/trbouma/openetr/blob/main/docs/specs/TRANSFER_VALIDATION_GUARDS_DESIGN_NOTE.md>
- Nostr Silent Payments Spec: <https://github.com/trbouma/openetr/blob/main/docs/specs/NOSTR_SILENT_PAYMENTS_SPEC.md>
- UNCITRAL MLETR page: <https://uncitral.un.org/en/texts/ecommerce/modellaw/electronic_transferable_records>
- Nostr NIP-01: <https://github.com/nostr-protocol/nips/blob/master/01.md>
- Nostr NIP-33: <https://github.com/nostr-protocol/nips/blob/master/33.md>
