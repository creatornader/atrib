# Atrib, Handoff Brief for Implementation

## What this is

Atrib is a value provenance protocol for the agent economy. It makes the economic relationships between AI agents, tools, content creators, and merchants verifiable without surveillance, the missing infrastructure layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP).

The core thesis: advertising exists because there is no native provenance infrastructure on the internet. When agents do the majority of commerce, advertising has no surface to attach to, but the attribution problem (who gets credit when value is created) becomes more urgent, not less. Atrib solves it.

## How this spec was built

This spec was developed in a multi-hour design session with the founder (Nader). Every technical decision traces back to that conversation. The most important design decisions:

1. **Automated, not configured.** Nader's core requirement: "it has to be literally automated." Zero ongoing developer surface area. One `atrib()` wrap at init, everything else fires automatically.

2. **Structure, not causality.** Attribution records capture observable structure, chain_root linkage, shared context_id, timestamps. They never assert that one thing *caused* another. Causality is an inference the policy layer makes. The protocol records facts.

3. **Fact/policy separation.** The graph (§3) is a pure fact layer. The policy (§4) is where weights and distribution decisions live. These must never be mixed. Graph endpoints must never return weighted data.

4. **Protocol is public good; product is not.** The spec, signing libraries, and log infrastructure are open. The queryable attribution graph and settlement services are commercial. This is the only model that earns trust at scale.

5. **No thumb on the scale.** Atrib does not decide what contributions are worth. Merchants and creators publish machine-readable policy documents. Agents negotiate them. The protocol provides the schema; the parties provide the values.

## The transcript

The original design conversation is in the Claude conversation history. For implementation, the most important sections are:

- The initial architecture decision (agent-first, not browser-first)
- The attribution vs payment separation ("Atrib is not competing with Stripe")
- The Merkle log decision (Certificate Transparency pattern, not blockchain)
- The middleware model ("TCP/IP, you don't tell TCP when to emit a packet")
- The gap audit (21 numbered gaps, resolved to v1/v2 split)

## Spec files

- `atrib-foundation.html`, §0: Why Atrib exists. Philosophical foundation, five principles.
- `atrib-section-1.html`, §1: Attribution Record Format. The atomic unit. Signed, canonical, chained.
- `atrib-section-2.html`, §2: Merkle Log Protocol. Commitment, not content. C2SP tlog-tiles.
- `atrib-section-3.html`, §3: Graph Query Interface. Five edge types. Fact layer only.
- `atrib-section-4.html`, §4: Attribution Policy Format. Machine-readable weights. Negotiation. Calculation algorithm.
- `atrib-section-5.html`, §5: SDK Specification. @atrib/mcp, @atrib/agent, @atrib/verify. Normative trigger table. Degradation contract.
- `atrib-current-art-map.html`, Prior art map. What exists, what Atrib adds.

## The implementation task

Build three npm packages in TypeScript:

### @atrib/mcp
Wraps an MCP server. One function: `atrib(server, { creatorKey })`. Everything else automatic.

Key behaviors (from §5.3):
- Reads inbound `params._meta.atrib`, `tracestate: atrib=`, `X-Atrib-Chain`, baggage
- Constructs + signs attribution record after successful tool call
- Writes token to response headers and `params._meta`
- Submits to log asynchronously (non-blocking, always)
- Serves policy at `/.well-known/atrib-policy.json`
- `transactionTools: string[]` option → emits `event_type: "transaction"` for checkout tools

### @atrib/agent
Wraps an agent/MCP client. One function: `atrib(agent, { creatorKey, merchantDomain? })`.

Key behaviors (from §5.4):
- Session init: context_id from OTel trace, generate session_token, concurrent policy fetches (1s timeout, no retry, 3s total budget), negotiate policies, create session policy record
- Outbound: attach `record_hash.creator_key` token to every tools/call request + session_token in baggage
- Inbound: read token from response, update `latestContext.record_hash`
- Transaction detection: check response shape for ACP/UCP/x402/MPP/heuristic signals
- Path selection: if response has attribution token → Path 1 (skip emission); if not → Path 2 (emit transaction record)
- `agent.getSessionPolicyRecord(context_id)` accessor

### @atrib/verify
Merchant verification library. `new AtribVerifier({ merchantKey? })`.

Key behaviors (from §5.5):
- `verify(recommendationDoc)` → independent recalculation + signature check
- `calculate({ context_id, policy, signWith })` → post-hoc calculation under default policy

## Critical invariants (never violate these)

1. **Atrib failures must never affect the primary tool call or agent response.** All exceptions caught. All network failures silent with retry. Pass-through mode if no key.

2. **The graph records structure, not causality.** Never add edge types based on semantic interpretation of tool names or response content.

3. **The calculation algorithm is a pure function.** Graph + policy → distribution. No network calls, no timestamps beyond record data, no randomness.

4. **Transaction records are non-blocking.** Never `await` log submission before returning a response. Priority queue yes, synchronous no.

5. **session_token is optional and omitted (not null) when absent.** Its presence/absence changes the JCS canonical form and therefore the signature.

## Key technical decisions to preserve

- **Ed25519, 32-byte seed.** Not 64-byte NaCl format. Not DIDs. Simple, fast, no PKI.
- **JCS canonicalization (RFC 8785).** Lexicographic key ordering. No whitespace. session_token slots between event_type and spec_version alphabetically.
- **Token format:** `base64url(sha256(jcs(signed_record))) + "." + base64url(creator_key_bytes)`, 87 chars max, fits W3C tracestate limit.
- **Genesis chain_root:** `sha256(context_id_utf8_bytes)` with `"sha256:"` prefix, not null, not random.
- **Log entry:** 90 bytes fixed, version(1) + record_hash(32) + creator_key(32) + context_id(16) + timestamp_ms(8) + event_type(1).
- **Proof bundle caching:** keyed by `record_hash`, not `context_id`.

## V2 deferrals (do not implement in v1)

- Key rotation mechanism
- Policy versioning (immutable snapshots)
- Cross-session attribution via recommendation_token
- Log federation across operators
- Settlement webhook format
- Dispute mechanism
- Multi-transaction session handling
- Agent-published policies (empirical weighting models derived from outcome data)
- DIF/C2PA interoperability profiles (see §1.8 Interoperability Roadmap)

---

*This spec was written April 2026. Claude Sonnet 4.6.*
