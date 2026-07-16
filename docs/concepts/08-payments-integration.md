# Payments integration

> atrib is not a payment rail. It is a verifiable action layer and protocol substrate that records cryptographically signed evidence of payments on top of whatever rail (x402, ACP, UCP, AP2, MPP, a2a-x402) actually moved the money. The transaction record is the multi-party-signed receipt that any third party can verify.

**Status**: DRAFT (v1, 2026-05-22; not promoted to REVIEW)
**Spec anchors**: [§1.7 Transaction Event Hooks](../../atrib-spec.md#17-transaction-event-hooks) · [§1.7.6 Cross-attestation requirement](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) · [D052](../../DECISIONS.md)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md), [Identity & the directory](03-identity-and-directory.md), [The Merkle log](02-the-merkle-log.md)
**Enables**: [The calculation algorithm](09-calculation-algorithm.md), settlement adjudication

## The Protocol Distinction

atrib is **not** a payment rail. It does not move money, hold funds, or execute transfers. atrib is a verifiable action substrate that records cryptographically signed evidence of what happened on top of whatever rail did the actual settlement.

Three layers:

| Layer                       | What it does                                  | Examples                           |
| --------------------------- | --------------------------------------------- | ---------------------------------- |
| Identity (above atrib)      | Who is this agent                             | W3C DIDs, agent identity standards |
| **atrib**                   | **Verifiable action + transaction substrate** | The signed Merkle-log records      |
| Payment rail (below atrib)  | Move the money                                | x402, ACP, UCP, AP2, MPP           |
| Settlement (below the rail) | Land the funds                                | Banks, on-chain rails              |

## What atrib does NOT do

atrib intentionally stays out of four adjacent concerns that the layers above and below handle:

- **Authorization** of the actual transaction. Inherits from agent authorization standards (OAuth, capability tokens, signed delegation envelopes).
- **Identity** of the entity executing the transaction. Inherits from agent identity standards (the [§6](../../atrib-spec.md#6-key-directory) directory, W3C DIDs, identity-claim envelopes).
- **Custody** of funds. Banks, custodial wallets, on-chain accounts; atrib never touches money.
- **Settlement** itself. The rail's job, then off-rail (banks, on-chain transfers, treasury payouts).

These are bordering layers atrib composes with but does not subsume. Previous attempts at "agent commerce" that tried to be receipts plus payments plus identity plus authorization all at once ended up doing none of them well. atrib's scope is the signed action and transaction evidence surface: records, proofs, graph structure, verifier results, and host-owned policy decisions attached to the action trail.

## When the transaction record gets triggered

Per [§1.7](../../atrib-spec.md#17-transaction-event-hooks), the trigger is a commerce protocol firing its completion signal. Each rail has a specific on-wire event atrib watches for:

| Rail           | Trigger event                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------- |
| ACP            | `POST /checkout_sessions/{id}/complete` returns `status: "completed"` with embedded `order` object |
| UCP            | Same shape as ACP, distinguished by the `ucp.version` envelope (since UCP `2026-01-11`)            |
| x402           | HTTP 200 response carrying a `PAYMENT-RESPONSE` header (v2) or legacy `X-PAYMENT-RESPONSE` (v1)    |
| AP2            | `PaymentMandate` finalization                                                                      |
| MPP / a2a-x402 | Each with its own completion signal                                                                |

Why this particular event: it's the moment the commerce loop closes. Before completion, the agent has taken tool_calls (look up product, compare prices, etc.). The transaction record ties those prior actions to the spend they justified, with a cryptographic chain back through `informed_by` / `provenance_token` edges.

## Cloudflare x402 and paid agent access

Cloudflare x402 support and Monetization Gateway fit this model as a runtime
and payment-access layer, not as a new atrib rail. Today, Workers and Agents can
model the paid path with a 402 challenge, paid retry, `PAYMENT-RESPONSE`,
settlement reference, and origin response. The public
[`cloudflare-x402-paid-agent`](../../proof-packets/cloudflare-x402-paid-agent/)
packet signs the host policy decision and outcome with `@atrib/action-gate`,
then binds hash-only x402 lifecycle facts to those record hashes.

When Gateway exposes lifecycle ids, logs, webhooks, or signed exports, those
facts should become the producer source for the same lifecycle shape. atrib's
role remains the proof layer around the paid action: policy before the spend,
outcome after the call, and independently verifiable records that carry forward.

## The Linker: `context_id`

Per [§1.7](../../atrib-spec.md#17-transaction-event-hooks): _"the `context_id` of the agent session must be embedded in the transaction metadata when the checkout is initiated, so that the transaction event webhook can be matched back to the attribution chain."_

Before the agent calls the rail, the atrib SDK injects the session's `context_id` into the commerce protocol's metadata channel:

- HTTP rails: `X-atrib-Context` header (per [§1.5.3.1](../../atrib-spec.md#1531-context-id-header-x-atrib-context))
- MCP-transport integrations: `params._meta.atrib`
- W3C trace context: the `tracestate` `atrib=` entry (per [§1.5.2](../../atrib-spec.md#152-http-transport-tracestate))

The merchant's settlement webhook receives the completion event, reads `context_id` back out, and now has the link from the payment to the agent's prior action graph.

## The governance: cross-attestation MUST ([§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records))

Transaction records MUST carry signatures from at least two independent parties. The agent and the counterparty (typically the merchant) both sign over **identical canonical bytes**: the JCS serialization of the record with `signers: []` and top-level `signature` omitted. This is the only event_type in the spec that breaks from single-signer signing.

```jsonc
"signers": [
  { "creator_key": "agent-key-base64url",        "signature": "Ed25519-sig" },
  { "creator_key": "counterparty-key-base64url", "signature": "Ed25519-sig" }
]
```

A compromised single key cannot fabricate arbitrary transactions on someone else's behalf. The merchant cryptographically agreed to the same bytes the agent signed; the agent cryptographically agreed to the same bytes the merchant signed. Disputes resolve on signatures, not on operator-self-report.

**Violations are flagged, not blocked.** Per [§5.8](../../atrib-spec.md#58-degradation-contract)'s degradation contract, atrib never breaks the underlying flow. Verifiers flag any transaction record with fewer than 2 distinct verified signer keys as `cross_attestation_missing: true`. Strict settlement systems might refuse to act on flagged records; permissive ones might accept with a downgrade. The protocol provides the signal; policy decides the response.

**Counterparty key discovery**: out-of-band. Either through the [§6 directory](../../atrib-spec.md#6-key-directory), through payment-protocol-specific channels (x402 facilitator metadata, ACP order envelope, AP2 receipt issuer or verifier key material), or via consumer-arranged key exchange. The spec deliberately doesn't pin a discovery mechanism.

## The full end-to-end flow

| Step | What happens                                                                                                                          | Who does it                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1    | Agent starts session, gets `context_id`                                                                                               | Agent / agent SDK                                 |
| 2    | Agent takes signed `tool_call` actions, each `informed_by` prior records                                                              | Agent / `@atrib/agent` or `@atrib/mcp` middleware |
| 3    | Agent decides to purchase, calls commerce protocol with `context_id` in metadata                                                      | Agent + atrib SDK                                 |
| 4    | Rail executes the actual payment                                                                                                      | Payment rail                                      |
| 5    | Rail returns per-protocol completion signal                                                                                           | Rail                                              |
| 6    | atrib SDK constructs transaction record, agent signs it                                                                               | Agent / atrib SDK                                 |
| 7    | Counterparty signs the same canonical bytes                                                                                           | Merchant / counterparty                           |
| 8    | Record submitted to public Merkle log; chain is closed                                                                                | Producer → log                                    |
| 9    | Anyone can use `@atrib/verify` to verify signatures + cross-attestation + walk `informed_by`                                          | Verifier (any party)                              |
| 10   | `@atrib/verify`'s `calculate()` runs on (graph, policy) → distribution map                                                            | Anyone with the inputs                            |
| 11   | Settlement Recommendation Document ([§4.7](../../atrib-spec.md#47-settlement-recommendation-document)) constructed; optionally signed | Computing party (typically merchant)              |
| 12   | Merchant pays out creators per the distribution, using their own rails/treasury                                                       | Off-atrib                                         |

Steps 1, 2, 8, 9 apply to every event_type. Steps 3-7 + 10-12 are payment-specific.

## Verification and calculation are two separate steps

Steps 9 and 10 in the flow above answer different questions, even though they run on the same signed bytes. Keeping them distinct is what makes settlement auditable.

| Question                                                 | Step             | What it answers                                                                                   |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| "Is this real?"                                          | 9 (verification) | Signatures valid? Cross-attestation present? Graph self-consistent? Records committed to the log? |
| "Given that it's real, how should value be apportioned?" | 10 (calculation) | What fraction of the transaction belongs to which creator, per the agreed policy?                 |

You can run #9 without #10 (just want to verify what happened). You can't run #10 without #9: calculating on unverified records means calculating on potentially-forged data. The [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross-attestation gate is the bouncer for #10; see the next section.

## Calculation gating

The [payments profile §8](../../docs/payments-profile.md#8-the-calculation-algorithm) calculation algorithm (relocated from [§4.6](../../atrib-spec.md#46-the-calculation-algorithm) per [D147](../../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core)) only runs when the graph contains a transaction node. And the transaction MUST carry ≥2 distinct verified signer keys. Strict consumers MAY reject the calculation entirely when `cross_attestation_missing: true`. The default is to compute, return, and surface the flag.

## See also

- Spec: [§1.7](../../atrib-spec.md#17-transaction-event-hooks), [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [payments profile §8](../../docs/payments-profile.md#8-the-calculation-algorithm), [§5.8](../../atrib-spec.md#58-degradation-contract)
- Decisions: [D052 Cross-attestation requirement](../../DECISIONS.md)
- Concepts: [The calculation algorithm](09-calculation-algorithm.md) (what runs in step 10)
