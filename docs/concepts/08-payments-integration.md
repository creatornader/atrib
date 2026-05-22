# Payments integration

> atrib is not a payment rail. It is a verification substrate that records cryptographically signed evidence of payments on top of whatever rail (x402, ACP, UCP, AP2, MPP, a2a-x402) actually moved the money. The transaction record is the multi-party-signed receipt that any third party can verify.

**Status**: DRAFT (v1, 2026-05-22 — produced in conversation; needs operator hand-review before promotion to REVIEW)
**Spec anchors**: [§1.7 Transaction Event Hooks](../../atrib-spec.md#17-transaction-event-hooks) · [§1.7.6 Cross-attestation requirement](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) · [D052](../../DECISIONS.md)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md), [Identity & the directory](03-identity-and-directory.md), [The Merkle log](02-the-merkle-log.md)
**Enables**: [The calculation algorithm](09-calculation-algorithm.md), settlement adjudication

## The load-bearing distinction

atrib is **not** a payment rail. It does not move money, hold funds, or execute transfers. atrib is a verification substrate that records cryptographically signed evidence of what happened on top of whatever rail did the actual settlement.

Three layers:

| Layer | What it does | Examples |
|---|---|---|
| Identity (above atrib) | Who is this agent | W3C DIDs, agent identity standards |
| **atrib** | **Verifiable action + transaction substrate** | The signed Merkle-log records |
| Payment rail (below atrib) | Move the money | x402, ACP, UCP, AP2, MPP |
| Settlement (below the rail) | Land the funds | Banks, on-chain rails |

## When the transaction record gets triggered

Per [§1.7](../../atrib-spec.md#17-transaction-event-hooks), the trigger is a commerce protocol firing its completion signal. Each rail has a specific on-wire event atrib watches for:

| Rail | Trigger event |
|---|---|
| ACP | `POST /checkout_sessions/{id}/complete` returns `status: "completed"` with embedded `order` object |
| UCP | Same shape as ACP, distinguished by the `ucp.version` envelope (since UCP `2026-01-11`) |
| x402 | HTTP 200 response carrying a `PAYMENT-RESPONSE` header (v2) or legacy `X-PAYMENT-RESPONSE` (v1) |
| AP2 | `PaymentMandate` finalization |
| MPP / a2a-x402 | Each with its own completion signal |

Why this particular event: it's the moment the commerce loop closes. Before completion, the agent has taken tool_calls (look up product, compare prices, etc.). The transaction record ties those prior actions to the spend they justified, with a cryptographic chain back through `informed_by` / `provenance_token` edges.

## The load-bearing linker: `context_id`

Per [§1.7](../../atrib-spec.md#17-transaction-event-hooks): *"the `context_id` of the agent session must be embedded in the transaction metadata when the checkout is initiated, so that the transaction event webhook can be matched back to the attribution chain."*

Before the agent calls the rail, the atrib SDK injects the session's `context_id` into the commerce protocol's metadata channel:
- HTTP rails: `X-atrib-Context` header (per [§1.5.3.1](../../atrib-spec.md#1531-context-id-header-x-atrib-context))
- MCP-transport integrations: `params._meta.atrib`
- W3C trace context: the `tracestate` `atrib=` entry (per [§1.5.2](../../atrib-spec.md#152-http-transport-tracestate))

The merchant's settlement webhook receives the completion event, reads `context_id` back out, and now has the link from the payment to the agent's prior action graph.

## The governance: cross-attestation MUST ([§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records))

Transaction records MUST carry signatures from at least two independent parties. The agent and the counterparty (typically the merchant) both sign over **identical canonical bytes** — the JCS serialization of the record with `signers: []` and top-level `signature` omitted. This is the only event_type in the spec that breaks from single-signer signing.

```jsonc
"signers": [
  { "creator_key": "agent-key-base64url",        "signature": "Ed25519-sig" },
  { "creator_key": "counterparty-key-base64url", "signature": "Ed25519-sig" }
]
```

A compromised single key cannot fabricate arbitrary transactions on someone else's behalf. The merchant cryptographically agreed to the same bytes the agent signed; the agent cryptographically agreed to the same bytes the merchant signed. Disputes resolve on signatures, not on operator-self-report.

**Violations are flagged, not blocked.** Per [§5.8](../../atrib-spec.md#58-degradation-contract)'s degradation contract, atrib never breaks the underlying flow. Verifiers flag any transaction record with fewer than 2 verified signers as `cross_attestation_missing: true`. Strict settlement systems might refuse to act on flagged records; permissive ones might accept with a downgrade. The protocol provides the signal; policy decides the response.

**Counterparty key discovery**: out-of-band — either through the [§6 directory](../../atrib-spec.md#6-public-key-directory), through payment-protocol-specific channels (x402 facilitator metadata, ACP order envelope, AP2 PaymentMandate signer field), or via consumer-arranged key exchange. The spec deliberately doesn't pin a discovery mechanism.

## The full end-to-end flow

| Step | What happens | Who does it |
|---|---|---|
| 1 | Agent starts session, gets `context_id` | Agent / agent SDK |
| 2 | Agent takes signed `tool_call` actions, each `informed_by` prior records | Agent / `@atrib/agent` or `@atrib/mcp` middleware |
| 3 | Agent decides to purchase, calls commerce protocol with `context_id` in metadata | Agent + atrib SDK |
| 4 | Rail executes the actual payment | Payment rail |
| 5 | Rail returns per-protocol completion signal | Rail |
| 6 | atrib SDK constructs transaction record, agent signs it | Agent / atrib SDK |
| 7 | Counterparty signs the same canonical bytes | Merchant / counterparty |
| 8 | Record submitted to public Merkle log; chain is closed | Producer → log |
| 9 | Anyone can use `@atrib/verify` to verify signatures + cross-attestation + walk `informed_by` | Verifier (any party) |
| 10 | `@atrib/verify`'s `calculate()` runs on (graph, policy) → distribution map | Anyone with the inputs |
| 11 | Settlement Recommendation Document ([§4.7](../../atrib-spec.md#47-settlement-recommendation-document)) constructed; optionally signed | Computing party (typically merchant) |
| 12 | Merchant pays out creators per the distribution, using their own rails/treasury | Off-atrib |

Steps 1, 2, 8, 9 apply to every event_type. Steps 3-7 + 10-12 are payment-specific.

## §4.6 gating

[§4.6](../../atrib-spec.md#46-the-calculation-algorithm)'s calculation algorithm only runs when the graph contains a transaction node. And the transaction MUST carry ≥2 verified signatures — strict consumers MAY reject the calculation entirely when `cross_attestation_missing: true`. The default is to compute, return, and surface the flag.

## See also

- Spec: [§1.7](../../atrib-spec.md#17-transaction-event-hooks), [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [§4.6](../../atrib-spec.md#46-the-calculation-algorithm), [§5.8](../../atrib-spec.md#58-degradation-contract)
- Decisions: [D052 Cross-attestation requirement](../../DECISIONS.md)
- Concepts: [The calculation algorithm](09-calculation-algorithm.md) (what runs in step 10)
