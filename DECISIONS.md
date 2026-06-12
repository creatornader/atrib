# atrib: Decision Log

Architectural and design decisions made during the atrib protocol development. Each entry records what was decided, why, and what alternatives were considered.

---

## D001: Agent-first sequencing, not browser-first

**Date:** 2026-04-05
**Context:** The protocol needed a go-to-market wedge. Browser/OS adoption requires convincing Google/Apple. Prior attempts (Brave, Coil, Flattr) failed by targeting human browsing.
**Decision:** Build for agent-to-agent transactions first. Agents don't have UX preferences, the volume is growing exponentially, and the protocol can be API-native from day one. Extend to human-facing content later.
**Alternatives considered:** Browser extension, browser fork, OS-level integration.

## D002: Attribution layer, not payment layer

**Date:** 2026-04-05
**Context:** Agent-to-agent payments are a crowded space (Stripe, PayPal, Visa, x402, MPP, ACP, UCP). Competing on payment rails is a losing position.
**Decision:** atrib is payment-rail agnostic. It sits above all payment protocols and answers "who should get paid and why," not "how does money move." Settlement uses whatever rail the merchant already has.
**Alternatives considered:** Building a payment rail, integrating with a single rail (Stripe), issuing a token.

## D003: Ed25519, not DIDs or PKI

**Date:** 2026-04-05
**Context:** Creator identity needs to be cryptographically verifiable. DIDs add complexity and dependency on DID resolution infrastructure. PKI requires certificate authorities.
**Decision:** Raw Ed25519 keypairs. Simple, fast, no external dependencies. 32-byte seed, deterministic public key derivation. Key rotation deferred to v2.
**Alternatives considered:** DIDs (too complex for v1), X.509 certificates (requires PKI), starting unsigned and adding signing later (insufficient trust).

## D004: OTel trace-id as context_id, not a custom identifier

**Date:** 2026-04-05
**Context:** Attribution records need a session identifier to form chains. Could generate a custom ID or reuse existing infrastructure.
**Decision:** context_id IS the W3C Trace Context trace-id from OTel. Not derived from it; the same value. This means atrib chains are automatically correlated with existing observability traces.
**Alternatives considered:** Custom atrib session ID (duplicates existing infrastructure), hash of trace-id (prevents correlation).

## D005: Structure not causality in the graph

**Date:** 2026-04-05
**Context:** The natural instinct is to encode causal relationships ("tool A influenced tool B which caused purchase"). But causality is an inference, not a verifiable fact.
**Decision:** The graph records observable structure only: chain linkage, shared session, timestamps. Causal interpretation belongs to the policy layer. Five edge types, all derived deterministically from record structure. No edge encodes a causal claim.
**Alternatives considered:** Explicit influence/transact action types (early design, rejected because it smuggled causal claims into the record), semantic analysis of tool names (rejected; not verifiable).

## D006: Merkle log (C2SP tlog-tiles), not blockchain

**Date:** 2026-04-05
**Context:** Attribution records need global verifiability. Blockchain provides this but carries cultural and economic baggage (tokens, gas costs, crypto association).
**Decision:** Certificate Transparency-style append-only Merkle log using the C2SP tlog-tiles ecosystem. Same cryptographic guarantees as a blockchain for append-only verification, without tokens, gas, or crypto association. Tessera-based implementation.
**Alternatives considered:** Ethereum/Base (gas costs, crypto baggage), Sigstore Rekor (repurposing a software supply chain tool), blockchain with anchoring (complexity).

## D007: Log stores commitments, not content

**Date:** 2026-04-05
**Context:** The log needs to prove records exist without revealing what they contain. This is the "observability without surveillance" principle.
**Decision:** Log entries are 90-byte fixed structs containing: record_hash, creator_key, context_id, timestamp, event_type. No tool call content, no response data, no user identity, no transaction amounts.
**Alternatives considered:** Storing full records (privacy-hostile), storing encrypted records (key management complexity), storing nothing (no verifiability).

## D008: Middleware pattern, not method calls

**Date:** 2026-04-05
**Context:** Nader's core requirement: "it has to be literally automated." Developer adoption fails the moment someone has to decide when to call an attribution method.
**Decision:** The SDK is a middleware wrapper with one init call and zero ongoing surface area. `atrib(server, { creatorKey })`; everything else is automatic. No methods to call after init. No configuration for when to emit.
**Alternatives considered:** Explicit API methods (requires developer judgment), event hooks (requires configuration), decorator pattern (framework-specific).

## D009: Fact/policy separation as an architectural boundary

**Date:** 2026-04-05
**Context:** For attribution to be trusted by both creators and merchants, each must be able to independently verify: (1) the graph accurately reflects what happened, and (2) the settlement was correctly calculated. Mixing fact and policy into one layer makes independent verification intractable.
**Decision:** The graph ([§3](atrib-spec.md#3-graph-query-interface)) is a strict fact layer. The policy ([§4](atrib-spec.md#4-attribution-policy-format)) is a separate evaluation layer. Graph endpoints never return weighted data. The calculation algorithm is a pure function of graph + policy. Any party can verify independently.
**Alternatives considered:** Combined graph+policy API (simpler but unverifiable), policy enforcement in the protocol (makes atrib an arbiter).

## D010: Default policy: equal weight, zero for unsigned

**Date:** 2026-04-05
**Context:** The protocol needs a sensible default when no policies are published. The default must be uncontroversial and make no value judgments.
**Decision:** Equal weight (1.0) for all five edge types on signed nodes. Zero weight for unsigned gap nodes. No modifiers, no floors, no caps. The least opinionated possible baseline.
**Alternatives considered:** Weighted by edge type (already a value judgment), equal including unsigned (rewards non-participation), no default (cold-start problem).

## D011: Dual transaction emission paths with anti-double-emission

**Date:** 2026-04-05
**Context:** Transaction records can be emitted by the merchant (if they have @atrib/mcp) or by the agent (if the merchant doesn't). Both paths must exist for cold-start adoption, but only one can fire per transaction.
**Decision:** Path 1 (merchant) is preferred. Path 2 (agent) is fallback. The agent detects Path 1 by checking if the checkout response contains an attribution token. If present, Path 2 is suppressed. This prevents duplicate transaction nodes.
**Alternatives considered:** Merchant-only (blocks adoption before merchant integration), agent-only (merchant key not on transaction), deduplication in the log (adds state to a stateless append-only system).

## D012: Open spec, commercial product (Stripe model)

**Date:** 2026-04-05
**Context:** For the protocol to be trusted as infrastructure, it must be open. For the company to be sustainable, something must be commercial.
**Decision:** The spec, signing libraries, and log infrastructure are open and free. The queryable attribution graph (`graph.atrib.dev`), analytics dashboard, and settlement resolution API (`resolve.atrib.dev`) are commercial products. This follows the Stripe model: open standards, best implementation.
**Alternatives considered:** Fully open with donations (Wikipedia model, chronically underfunded), fully closed (no trust, no adoption), token-funded (crypto baggage).

## D013: "Observability without surveillance" is delivered across three layers, not one

**Date:** 2026-04-05
**Context:** The spec's central privacy claim ("observability without surveillance," [§0](atrib-spec.md#0-foundations)) is not delivered by any single primitive in isolation. The claim requires three layers working together, and the spec needs to be explicit about which layer enforces what.
**Decision:** The privacy architecture is:

- **Layer 1 (record format):** The `AtribRecord` type captures structural metadata only: no tool call arguments, no response content, no user queries, no transaction amounts. Content never enters the hashing pipeline.
- **Layer 2 (log commitments):** The Merkle log stores 90-byte entries (record_hash, creator_key, context_id, timestamp, event_type): commitments, not records. Full records stay with the parties.
- **Layer 3 (middleware discipline):** The degradation contract ([§5.8](atrib-spec.md#58-degradation-contract)) ensures errors, retries, and failure modes don't leak content through logs or error messages. Proof bundles serve inclusion proofs, not records.

All three layers are necessary. Layer 1 alone is necessary but not sufficient.

**Known tension:** `content_id = sha256(serverUrl + ":" + toolName)` reveals _which tool at which server_ was called. The spec treats this as acceptable structural metadata (tool existence is public via MCP `tools/list`, same information exists in OTel spans), but it is the closest the protocol gets to the surveillance line. A future revision could explore blinded content_ids if this proves problematic.
**Alternatives considered:** Salting/blinding content_ids (would break independent reproducibility required by [§4.6](atrib-spec.md#46-the-calculation-algorithm)), encrypting log entries (adds key management complexity, deferred).

## D014: Cross-package integration tests live in a private workspace package and re-derive primitives

**Date:** 2026-04-06
**Context:** An end-to-end test exercising the full attribution flow across all three SDK packages needs a home. The question was where this test should live and what it should import. Two options: (a) put it inside an existing package (e.g., `@atrib/verify/test/integration.test.ts`), reusing existing imports; (b) create a separate private workspace package that depends on all three SDK packages and re-derives shared primitives independently.
**Decision:** Created `@atrib/integration` as a private workspace package (`"private": true`, no `dist/`, only test runner). It depends on `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` as peers. Critically, its `graph-builder.ts` re-implements `recordHash()` from primitives (`sha256(canonicalRecord(...))`) rather than importing a hash function from `@atrib/mcp`. This mirrors what a real graph indexing service (`graph.atrib.dev`) would do: index records arriving from arbitrary creators across the open log, without depending on the SDK that produced them.
**Why this matters:** The [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation algorithm's correctness rests on the claim that "any party with the same inputs gets the same result." If integration tests reused the SDK's hash function, two implementations could silently agree because they share code. By re-deriving in the test, we validate that JCS canonicalization + SHA-256 produce identical output across two independent code paths. The end-to-end test passing demonstrates that the chain reconstructs (`A → B → tx`) precisely because `chain_root` references match record hashes derived independently.
**Alternatives considered:** Test inside `@atrib/verify` (would hide the boundary), test at the repo root (no package isolation), publish `@atrib/integration` as a public package (no value to consumers, only to the project).

## D015: ACP and UCP detect on a unified completion shape, distinguished by the `ucp` envelope

**Date:** 2026-04-06
**Context:** The initial SDK shipped with synthetic ACP/UCP detection rules (`response.data.object.object === 'checkout_session'`, `type === 'order.created'`, `event_type === 'ORDER_CREATED'`) that came from imagined Stripe-event-envelope shapes, a guess at the protocol surface, never cross-checked against the real ACP and UCP specs. When the rules were verified against the actual specs (via the `/agentic-commerce-protocol/agentic-commerce-protocol` and `/universal-commerce-protocol/ucp` repos), it turned out that (a) neither protocol uses any of those shapes, (b) ACP and UCP have converged on essentially the same checkout completion response, and (c) the `TransactionDetection.protocol` literal `'ACP/UCP'` was hiding a distinction that consumers actually care about.
**Decision:**

- Detection signal for both protocols is `status === 'completed'` AND `order.id` is a string. Webhook events `order_create` / `order_update` (snake_case, NOT `order.created`) are also accepted as ACP transaction events.
- UCP is distinguished from ACP by the presence of a top-level `ucp.version` envelope on the completion response.
- Split the protocol literal type into `'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'heuristic'` so consumers can switch on the actual protocol. The middleware's `emitTransactionRecord` switch was updated correspondingly.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/{acp,ucp}/`, with provenance README files citing the source URL and verification date.
- Spec [§1.7.1](atrib-spec.md#171-acp-agentic-commerce-protocol) and [§1.7.2](atrib-spec.md#172-ucp-universal-commerce-protocol) were rewritten to match real ACP/UCP shapes. The [§5.4.5](atrib-spec.md#545-transaction-detection) detection pseudocode was updated to match.
- Because neither ACP nor UCP currently exposes a documented free-form metadata field on `POST /checkout_sessions/...` requests, the spec now requires `context_id` to travel via the `X-atrib-Context` HTTP header (consistent with x402/MPP) and via `params._meta.atrib` for MCP-transport integrations. The earlier spec language describing `metadata.atrib_context_id` and `extensions["io.atrib/context_id"]` was speculative and has been removed.
  **Alternatives considered:** Keeping the joint `'ACP/UCP'` literal (loses information consumers want), making detection lenient with multiple synonymous keys (false positives), waiting for ACP/UCP to add metadata fields before fixing the spec (blocks the SDK indefinitely on upstream protocol decisions).
  **Followup work:** [§2](atrib-spec.md#2-merkle-log-protocol) (x402/MPP) and [§3](atrib-spec.md#3-graph-query-interface) (AP2) cross-spec verification, pending. The MPP-vs-x402 distinction in the new code uses an optional `Payment-Protocol` response header marker; this is an atrib convention because both protocols share the same `Payment-Receipt` header on the response side and we need a way to distinguish them when both might be in use. If a future revision of x402 or MPP standardizes a different distinguisher, update this rule.

**Update (2026-04-06, same day):** [D016](#d016-x402-and-mpp-detect-on-different-headers-not-a-shared-one) supersedes the "shared `Payment-Receipt` header" assumption above. Verification against the actual specs revealed that x402 and MPP use **different** response headers and there is no need for an atrib-invented `Payment-Protocol` marker.

## D016: x402 and MPP detect on different headers, not a shared one

**Date:** 2026-04-06
**Context:** Cross-spec verification for x402 and MPP. The original SDK and the original [§1.7.3](atrib-spec.md#173-x402)/[§1.7.4](atrib-spec.md#174-mpp-machine-payments-protocol) spec text both claimed x402 and MPP use a shared `Payment-Receipt` response header. [D015](#d015-acp-and-ucp-detect-on-a-unified-completion-shape-distinguished-by-the-ucp-envelope) even introduced an atrib-invented `Payment-Protocol` distinguisher to tell them apart. When the claims were checked against the published specs, both turned out to be wrong.
**What the real specs say:**

- **x402** (`github.com/coinbase/x402`): the success-path response header is `PAYMENT-RESPONSE` in v2, renamed from v1's `X-PAYMENT-RESPONSE` per RFC 6648 (deprecation of the `X-` prefix). The value is base64-encoded JSON containing a `SettlementResponse` with `success`, `transaction`, `network`, `payer`, `requirements` fields.
- **MPP** (IETF `draft-ryan-httpauth-payment-01`, "The 'Payment' HTTP Authentication Scheme", co-authored by Tempo Labs and Stripe, launched March 2026): the success-path response header is `Payment-Receipt`, value is base64url-nopad JSON with required fields `{ status: "success", method, timestamp, reference }`. The draft explicitly states _"Servers MUST NOT return a Payment-Receipt header on error responses"_, which makes header presence a reliable detection signal.
- The two protocols are different. They both build on HTTP 402 Payment Required, but their on-wire mechanisms diverge: x402 uses custom `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, while MPP uses standard HTTP authentication (`WWW-Authenticate: Payment` / `Authorization: Payment`) plus the new `Payment-Receipt` response header.

**Decision:**

- Detection now checks `PAYMENT-RESPONSE` (or v1 legacy `X-PAYMENT-RESPONSE`) for x402 and `Payment-Receipt` for MPP, all matched case-insensitively per RFC 7230.
- The fictional `Payment-Protocol` marker introduced in [D015](#d015-acp-and-ucp-detect-on-a-unified-completion-shape-distinguished-by-the-ucp-envelope)'s footnote was removed.
- Precedence rule when both headers are somehow present: x402 wins. This is documented in tests.
- Spec [§1.7.3](atrib-spec.md#173-x402) and [§1.7.4](atrib-spec.md#174-mpp-machine-payments-protocol) rewritten to cite the real headers and source documents. The [§5.4.5](atrib-spec.md#545-transaction-detection) detection pseudocode was updated to match. A note was added flagging the prior conflation as an error so future readers don't reintroduce it.
- Real captured payload shapes (decoded JSON for both `PAYMENT-RESPONSE` and `Payment-Receipt`) live under `packages/agent/test/fixtures/{x402,mpp}/` with provenance README files citing the canonical sources.
- Detection uses **header presence** as the on-wire signal. Decoding the base64 body to validate `success: true` (x402) or `status: "success"` (MPP) is not done in v1. The spec language for both protocols treats the header as the authoritative signal, and the degradation contract ([§5.8](atrib-spec.md#58-degradation-contract)) means false positives from a misconfigured server are preferable to false negatives caused by overly strict shape matching. Higher-fidelity downstream tooling that needs to extract the transaction hash for content_id derivation can decode the body itself.

**Alternatives considered:**

- Decoding the header value and validating `success: true` / `status: "success"` (rejected; tightens detection at the cost of robustness; the degradation contract favors silent passes over silent fails)
- Treating `Payment-Receipt` as a synonym for `PAYMENT-RESPONSE` (rejected; they are different protocols with different wire formats and tooling, and the SDK consumer needs to know which one fired)
- Adding a single combined `'x402-or-mpp'` literal back to the protocol type (rejected for the same reason as the joint `'ACP/UCP'` literal in [D015](#d015-acp-and-ucp-detect-on-a-unified-completion-shape-distinguished-by-the-ucp-envelope); it hides information consumers care about)

**Followup:** AP2 / W3C VC verification next, then W3C Trace Context conformance and MCP SDK extension API.

## D017: AP2 v0.1 uses A2A DataParts, not W3C Verifiable Credentials

**Date:** 2026-04-06
**Context:** Cross-spec verification for AP2 (Google Agent Payments Protocol). The original SDK and the original spec [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402) both assumed AP2 would use W3C Verifiable Credentials with `type === 'VerifiableCredential'` and `credentialSubject.type === 'PaymentMandate'` to express a Payment Mandate. When verified against the actual AP2 v0.1 specification at `github.com/google-agentic-commerce/ap2`, this turned out to be wrong. AP2 v0.1 does not use W3C VCs at all.

**Update (2026-05-27):** [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) supersedes this ADR for current AP2 v0.2 integrations. This ADR remains the compatibility rationale for older AP2 v0.1 DataPart deployments.

**What the real AP2 spec says:**

- AP2 is built on top of A2A (Agent2Agent). The wire format for a Payment Mandate is an A2A `Message` containing one or more `parts`, where the `kind: "data"` part has a `data` object with the key `ap2.mandates.PaymentMandate` and the AP2 PaymentMandate schema as its value.
- The PaymentMandate schema includes `payment_details.payment_request_id`, `payment_details.merchant_agent_card.name`, `payment_details.amount`, etc.: all plain JSON, no JSON-LD `@context`, no `proof` field, no W3C VC machinery.
- AP2 also defines `IntentMandate` (intent capture, upstream of cart) and `CartMandate` (cart commitment, upstream of payment). These appear in the same A2A DataPart shape under `ap2.mandates.IntentMandate` and `ap2.mandates.CartMandate`. They are NOT transaction events and MUST NOT be detected as such.
- The extension URI is `https://github.com/google-agentic-commerce/ap2/tree/v0.1`.

**What a2a-x402 is:**

- a2a-x402 (`github.com/google-agentic-commerce/a2a-x402`) is the AP2 extension for crypto payments via x402, co-developed by Google with Coinbase, Ethereum Foundation, and MetaMask. It is NOT a separate protocol; it is the AP2 crypto payment path.
- The success-path message is an A2A task with `status.message.metadata["x402.payment.status"] === "payment-completed"` AND `status.message.metadata["x402.payment.receipts"]` containing at least one entry where `success: true`. A `payment-completed` status with only `success: false` receipts represents a failed settlement and is NOT a transaction event.
- atrib reports a2a-x402 transactions as `protocol: 'AP2'` (not as a separate literal) because the on-wire mechanism is part of AP2.

**Decision:**

- Detection now checks two real AP2 paths: (1) `parts[].data["ap2.mandates.PaymentMandate"]` for the standard AP2 v0.1 shape, (2) the a2a-x402 task metadata shape requiring BOTH `payment-completed` status AND a successful receipt.
- Both paths report `protocol: 'AP2'`. We do not introduce a separate `'a2a-x402'` literal for the same reason [D015](#d015-acp-and-ucp-detect-on-a-unified-completion-shape-distinguished-by-the-ucp-envelope) split joint literals: extra distinctions only when consumers care, and a2a-x402 IS AP2.
- The legacy W3C VC envelope check is kept as a fallback for research forks that may have implemented Payment Mandates as VCs (matching the obsolete spec language), but the canonical detection path is the A2A DataPart shape. The fallback accepts both VC v2 array form and v1 string form.
- IntentMandate and CartMandate are explicitly tested as non-transaction events to lock in the correct funnel semantics.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/ap2/` with a provenance README citing both the AP2 v0.1 spec and the a2a-x402 v0.1 spec.
- Spec [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402) was rewritten to match real AP2 / a2a-x402 shapes with a clear note that the prior W3C VC assumption was wrong. The [§5.4.5](atrib-spec.md#545-transaction-detection) detection pseudocode was updated correspondingly.

**Alternatives considered:**

- Detecting all three mandate types (Intent, Cart, Payment) as transaction events (rejected; would falsely close attribution chains on intent-capture or cart-commit events, violating [§3.1](atrib-spec.md#31-design-principles-and-rationale)'s structure-not-causality rule)
- Treating a2a-x402 as a separate `'a2a-x402'` protocol literal (rejected; it is the AP2 crypto payment path; consumers care about AP2-vs-not-AP2, not AP2-card-vs-AP2-crypto)
- Decoding and validating the cart_mandate hash chain in the PaymentMandate (rejected; that's verification work belonging in `@atrib/verify`, not on the agent middleware critical path)
- Removing the legacy W3C VC fallback entirely (rejected; costs nothing to keep, costs developer trust to silently break a research-fork integration)

**Followup update (2026-05-28):** [D095](#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) now extends this compatibility path. AP2 Path 2 uses stable receipt or mandate identity when present and falls back to the MCP server URL plus `"checkout"` only when no stable AP2 identity is visible.

## D018: W3C Trace Context and Baggage conformance: leftmost atrib, lenient parse, evict-from-end on overflow

**Date:** 2026-04-06
**Context:** W3C Trace Context + Baggage conformance verification. The initial SDK emitted W3C tracestate and baggage but had three classes of bugs against the W3C specs (`https://www.w3.org/TR/trace-context/` and `https://www.w3.org/TR/baggage/`).

**What the real specs say:**

- **Tracestate** (W3C trace-context):
  - List-member grammar is `key OWS "=" OWS value`, comma-separated. OWS around the `=` is allowed and receivers must accept it.
  - Maximum **32 list-members**. Vendors SHOULD propagate at least 512 characters total.
  - "One entry per key is allowed"; vendors MUST overwrite duplicate keys.
  - When size-limited, "entries larger than 128 characters long SHOULD be removed first. Then entries SHOULD be removed starting from the end of `tracestate`."
  - The convention is that the most recent vendor's entry appears leftmost.
- **Baggage** (W3C baggage):
  - List-member grammar is `key OWS "=" OWS value *( OWS ";" OWS property )`. The optional `;property` segments are NOT part of the value and MUST be stripped on parse.
  - Maximum **64 list-members**, maximum **8192 bytes total**.
  - Duplicate keys SHOULD be deduped; entries with invalid format MAY be removed.
- **Traceparent** (W3C trace-context):
  - trace-id is exactly 32 lowercase hex characters and **MUST NOT be all zeros** (receivers MUST ignore the entire traceparent if the trace-id is invalid).
  - parent-id is exactly 16 lowercase hex characters and MUST NOT be all zeros.
  - Version and trace-flags are 2 lowercase hex characters each.

**Three real bugs found and fixed:**

1. **`parseBaggageAtribSession` returned `value;property` instead of stripping the property suffix.** A baggage entry like `atrib-session=tok;ttl=300` decoded to `tok;ttl=300` instead of `tok`. Fixed: parser now matches up to the first `;` (or end of entry).
2. **OWS around `=` was not handled** in either tracestate or baggage parsing. Both `parseTracestateAtrib` and `parseBaggageAtribSession` used `startsWith('atrib=')` which fails for `atrib = TOKEN`. The agent's `accumulateInboundContext` had the same bug in its inline tracestate regex. Fixed: all three call sites now use a regex that allows OWS around `=`.
3. **atrib tracestate entry was being appended (rightmost) by the agent's `buildOutboundMeta`, not prepended (leftmost).** The MCP middleware's `writeOutboundContext` was already prepending correctly, but the agent was inconsistent. Per W3C convention, the most recent vendor appears leftmost; the agent IS the most recent vendor when forwarding an outbound request. Fixed: both code paths now prepend.

**Robustness additions:**

- New `extractTraceId` rejects all-zero trace-id and parent-id, malformed version/traceflags, uppercase hex, and wrong-length fields. Previously it only checked the trace-id length and lowercase pattern.
- New `mergeTracestate(entry, existing)` and `mergeBaggageAtribSession(token, existing)` helpers in `@atrib/mcp/context` enforce the W3C list-member maximums (32 for tracestate, 64 for baggage) and the 8192-byte baggage cap. Both helpers dedupe prior atrib entries and place the new atrib entry leftmost. Eviction is from the rightmost end per W3C truncation guidance.
- These helpers are exported from `@atrib/mcp` and used by both `@atrib/mcp` (`writeOutboundContext`) and `@atrib/agent` (`buildOutboundMeta`) so the discipline is symmetric across producer and consumer code paths.

**Tests added (25 new):**

- `parseTracestateAtrib`: OWS around `=`, atrib not in leftmost position, duplicate atrib entries.
- `mergeTracestate`: leftmost placement, dedupe, OWS-tolerant dedupe, empty existing, **32-list-member overflow with rightmost eviction**, single-vendor case.
- `extractTraceId`: all-zero trace-id rejection, all-zero parent-id rejection, uppercase hex rejection, malformed traceflags rejection, malformed version rejection, too-few-parts rejection, valid case.
- `parseBaggageAtribSession`: single `;property` strip, multiple `;property` strips, OWS around `=`, OWS + property combination, atrib-session after entries with their own properties.
- `mergeBaggageAtribSession`: leftmost placement, dedupe (including with property suffix), empty existing, **64-list-member overflow with rightmost eviction**, **8192-byte total cap with rightmost eviction**.

**Decision:**

- Lenient parsing (accept OWS, accept atrib in any position) but strict emission (always emit the canonical W3C-conformant form: atrib leftmost, no OWS, deduped).
- The merge helpers are exported from `@atrib/mcp` so consumers can integrate atrib into their own header-handling code without re-deriving the discipline. This becomes the canonical W3C-conformant API surface.

**Alternatives considered:**

- Validating tracestate/baggage on the way IN as well as on the way OUT (rejected; receivers should be lenient per Postel's principle, and rejecting malformed inbound state would break the degradation contract by silently dropping legitimate but slightly-off inputs from upstream vendors)
- Using a separate W3C trace-context library (rejected; adds a dependency for a small amount of straightforward parsing; we own the discipline and can keep it pinned to spec)
- Adding a runtime warning when truncation occurs (deferred; would require a logger plumbed through to the merge helpers; future-work item if observed in practice)

**Followup:** MCP SDK extension API and framework adapters next.

## D019: MCP SDK monkey-patch is documented and shape-tested against the real SDK

**Date:** 2026-04-06
**Context:** MCP SDK extension API durability check. The middleware monkey-patches `McpServer.server.setRequestHandler` and detects the tools/call request via Zod schema introspection (`schema.shape.method.value === 'tools/call'`). Both are internal implementation details of `@modelcontextprotocol/sdk` that could change between versions. The question was whether to (a) refactor to a documented extension API, or (b) document the dependency and ship a regression test that catches SDK upgrade breakage.

**What the SDK actually exposes** (verified against `@modelcontextprotocol/sdk@^1.29.0` with `context7` and direct inspection of `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/.../server/index.d.ts` and `server/mcp.d.ts`):

- `McpServer.registerTool(name, config, callback)`: current high-level API for registering tools (replaces deprecated `.tool()` overloads).
- `McpServer.tool(...)`: deprecated variadic API, still supported.
- `Server.setRequestHandler<T extends AnyObjectSchema>(requestSchema: T, handler)`: low-level API. Currently takes a Zod schema (e.g., `CallToolRequestSchema`) as the first argument. The v2 migration docs hint at a future string-based form (`setRequestHandler('tools/call', handler)`), but that has not landed in 1.x.
- **No documented middleware, interceptor, or `use(...)` extension API exists** in any current version of the SDK.
- McpServer internally accumulates tool callbacks from `registerTool` / `tool` and lazily registers a single dispatching `tools/call` handler on the underlying low-level Server. This is why our patch works: both the high-level `registerTool` path and direct low-level `setRequestHandler` use funnel through the same underlying call.

**Decision:** Take option (b): keep the monkey-patch, but make it survivable across SDK changes:

1. **Robust schema detection**: a new `isToolsCallSchema(schema)` helper accepts FOUR known forms: `schema === 'tools/call'` (v2 string form), `schema.shape.method.value === 'tools/call'` (1.x Zod literal), `schema.shape.method._def.value === 'tools/call'` (deeper Zod traversal), and `schema.method === 'tools/call'` (pre-parsed). The patch survives both the v2 migration AND any of several common Zod-version variations without code change.
2. **Runtime sanity check at init time**: the middleware now checks that `server.server` exists and `server.server.setRequestHandler` is a function. If not, it logs a loud warning identifying the SDK shape change and degrades to pass-through mode (per [§5.8](atrib-spec.md#58-degradation-contract)) instead of throwing or silently doing nothing.
3. **Real-SDK regression test** in `packages/mcp/test/middleware-sdk-shape.test.ts` that imports the actual `@modelcontextprotocol/sdk` package and asserts:
   - `McpServer.server` exists
   - `McpServer.server.setRequestHandler` is a function
   - `CallToolRequestSchema` matches at least one of the paths `isToolsCallSchema` checks
   - `CallToolRequestSchema.safeParse({ method: 'tools/call', params: { name: 'test_tool', arguments: {...} } })` succeeds
   - End-to-end: registering a tool via the SDK's high-level API, calling it through the dispatcher with a real `tools/call` request, and observing both the tool's own response and an attribution record submission via mocked fetch
   - The graceful-degradation path: a fake McpServer with no `.server` triggers the loud warning and pass-through mode
4. **Source documentation**: a 30-line block comment in `src/middleware.ts` explains the patch, lists the two specific fragility points, points future maintainers at the regression test, and notes that if a documented extension API ever ships (`Server.use(middleware)` or `Server.fallbackRequestHandler`), the body of the patch can be replaced with that API without touching the surrounding wrap function.

**Why this is the right tradeoff:**

- The ideal fix (refactor to a documented API) is impossible because no such API exists in any version of the SDK. Filing an upstream issue is the long-term play but doesn't help today.
- Refactoring to wrap `McpServer.registerTool` / `tool` directly was considered. It's slightly cleaner but requires more wrap surface area (two methods, two signatures each in 1.x), it doesn't cover users who use the low-level Server directly, and the regression risk is the same; both APIs are internal to McpServer and can change. The monkey-patch on `setRequestHandler` is the single chokepoint.
- A regression test that imports the real SDK is the strongest possible mitigation: any SDK upgrade that breaks our assumptions fails CI immediately, with a precise error message naming what changed.

**Tests added (6):**

- `McpServer.server` exists
- `McpServer.server.setRequestHandler` is a function
- `CallToolRequestSchema` matches at least one detection path
- `CallToolRequestSchema.safeParse` accepts a real tools/call request
- End-to-end: real SDK + atrib() + tool registration + dispatch + attribution record submission
- Graceful degradation: fake McpServer with missing `.server` triggers warning + pass-through

**Followup:** framework adapters next, then developer integration documentation and TypeDoc API reference.

## D020: Framework adapter targets: Claude Agent SDK, Cloudflare Agents, Vercel AI SDK (re-ranked from an incomplete prior decision)

**Date:** 2026-04-06
**Context:** An earlier ranking of framework adapter targets had listed **Vercel AI SDK → Mastra → LangChain JS** with OpenAI Agents and Claude Agent SDK as tier-2 and Cloudflare Agents deferred. That ranking was based on npm download counts alone; authenticated GitHub code search results that arrived shortly after were not folded back into the conclusion. When those searches were re-run with the full data set (including OpenAI Agents, which had been blocked by missing auth in the earlier pass), the right answer changed materially.

**Methodology corrections to the prior ranking:**

- The earlier ranking weighted purely on **npm package downloads of MCP-specific subpackages** (`@ai-sdk/mcp` 509K/wk, `@langchain/mcp-adapters` 261K/wk, `@mastra/mcp` 169K/wk). Authenticated GitHub code search counts were unavailable when the ranking was made.
- Authenticated GitHub code search subsequently filled in framework-specific import patterns. The earlier ranking was never revisited against that data.
- Two additional methodological bugs in the earlier search batches: quoted-string queries in `gh search code` were returning `0` due to encoding issues (e.g. Cloudflare `from "agents/mcp"` returned 0 quoted, **892** unquoted), and the OpenAI Agents queries had never run at all (auth-blocked in the original pass).
- The complete query set was re-run authenticated against `gh api search/code` (which returns total counts directly via `total_count`), filling the OpenAI Agents gap and confirming all alternate-name queries.

**Complete GitHub real-usage data (TypeScript files, fetched 2026-04-06):**

| Framework         | Primary signal                                | Files      | Alternate-name signals                                                                                                                |
| ----------------- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Agent SDK  | `"@anthropic-ai/claude-agent-sdk" McpServer`  | **1,680**  | `mcpServers` + `claude-agent-sdk` 1,376; pkg import 3,160; `ClaudeSDKClient` 98                                                       |
| Cloudflare Agents | `agents/mcp` (client) + `MCPClientConnection` | **~1,050** | unquoted `agents/mcp` 892; `MCPClientConnection` 158; server `extends McpAgent` 868                                                   |
| Vercel AI SDK     | `experimental_createMCPClient`                | **908**    | bare `createMCPClient` 1,936 (overcounts non-Vercel); `@ai-sdk/mcp` 704                                                               |
| OpenAI Agents     | `MCPServerSSE`                                | **616**    | `MCPServerStdio` 266; `MCPServerStreamableHttp` 171; `getAllMcpTools` 235; `connectMcpServers` 176; pkg import `@openai/agents` 2,768 |
| Mastra            | `"@mastra/mcp" MCPClient`                     | **494**    | pkg import `@mastra/mcp` 506; legacy `MastraMCPClient` 98                                                                             |
| LangChain         | `MultiServerMCPClient`                        | **442**    | `loadMcpTools` 408; pkg `@langchain/mcp-adapters` 374                                                                                 |
| (substrate)       | `@modelcontextprotocol/sdk/client`            | 2,224      | already covered by `wrapMcpClient` in commit `c450672`                                                                                |

**Decision:** Replace the prior tier list. The new [§6](atrib-spec.md#6-key-directory) build order is:

1. **Claude Agent SDK**: highest GitHub footprint (1,680 files), bundles `@modelcontextprotocol/sdk` directly (an earlier dependency analysis confirmed dependency analysis), and the architecturally cleanest interception path. Because the SDK fully encapsulates MCP server setup from the consumer (users pass `mcpServers: {...}` config, never touch the Client themselves), the right interception point is **not** an agent-side wrapper; it is an **in-process proxy MCP server** that lives in `packages/mcp/` and re-uses the existing `atrib()` middleware. The user configures their Claude Agent SDK to point at the proxy, the proxy forwards to the real upstream MCP servers, and attribution records are emitted at the proxy layer. Zero changes to `packages/agent/` for this adapter.
2. **Cloudflare Agents**: second highest (~1,050 client-side files), also bundles `@modelcontextprotocol/sdk` directly. Same proxy architecture as Claude Agent SDK applies. The 892 figure was hidden from the prior decision by a quoted-query encoding bug; without that bug, Cloudflare would have ranked second from the start instead of being deferred.
3. **Vercel AI SDK**: third by GitHub footprint (908 `experimental_createMCPClient` files), strongest pure-npm signal (509K/wk for `@ai-sdk/mcp`). Different interception strategy: wrap the `tools()` record returned by `createMCPClient` rather than `callTool()` directly. Lives in `packages/agent/` as a thin export.
4. **(Deferred to a follow-up)** OpenAI Agents: has the largest _parent_ framework footprint (2,768 import sites) but its MCP transport is custom and does not depend on `@modelcontextprotocol/sdk`. Adapter requires subclassing `MCPServerStdio`/`MCPServerSSE`/`MCPServerStreamableHttp` rather than wrapping a Client. This is the highest implementation cost per unit of coverage and should ship after the top three are validated against real users.
5. **(Deferred)** Mastra and LangChain JS: both have lower GitHub footprints than the top four. LangChain is technically the easiest adapter (`loadMcpTools(name, wrappedRawClient)` accepts an injected raw `@modelcontextprotocol/sdk` Client, so `wrapMcpClient` already covers it transparently), so it can be ticked off with a documentation page rather than new code. Mastra's API was 404 in earlier docs research and needs source verification before adapter work.

**Why the prior decision (#28586) reached a different answer:**

- It weighted only on **MCP-specific npm package downloads**, which favored frameworks that ship MCP support in a _separate_ installable package (`@ai-sdk/mcp`, `@langchain/mcp-adapters`, `@mastra/mcp`) and disadvantaged frameworks that **bundle** MCP into the parent package (Claude Agent SDK, Cloudflare Agents). Bundling makes the per-package metric invisible but is architecturally a stronger signal; a bundled dependency is non-optional, while a separate package is opt-in.
- The 892-file Cloudflare client signal was missing entirely (quoted query bug returned 0).
- The OpenAI Agents data was missing entirely (auth-blocked and never re-run).
- The Mastra "highest attach ratio" claim (~29% of `@mastra/core` users install `@mastra/mcp`) was true but applied to a smaller absolute base (Mastra core has ~583K/wk vs. Claude Agent SDK at 3.6M/wk and Vercel AI SDK at 10.1M/wk).

**Alternatives considered:**

- **Stay with #28586 (Vercel/Mastra/LangChain).** Rejected: pure-npm-MCP weighting double-penalizes bundlers, and the GitHub data shows ~3x more developers configuring MCP via Claude Agent SDK than via Vercel's separate package. Following the npm ranking would mean shipping adapters for the smaller addressable populations first.
- **Hybrid (Claude SDK + Vercel AI SDK + one more).** Considered. The chosen plan is essentially this hybrid extended to three: it picks the highest GitHub-signal target (Claude SDK), the highest pure-npm target (Vercel AI SDK), and the second-highest GitHub-signal target (Cloudflare Agents) which the prior decision wrongly deferred.
- **Ship OpenAI Agents in the top three.** Rejected for the first cut: 2,768 parent imports is impressive but the custom-transport path means the adapter is structurally different from every other one we'd ship and produces no reusable patterns. Better to validate the proxy-server pattern (Claude + Cloudflare) and the tools-record-wrap pattern (Vercel) first.
- **Defer the re-ranking and ship #28586 anyway because it's already documented.** Rejected per the radical-honesty rule: shipping the wrong adapter set first because it was decided first is exactly the kind of avoidable mistake the rule exists to prevent. The cost of correcting this here is one DECISIONS.md entry; the cost of not correcting it is shipping examples for the wrong frameworks and potentially having to rip them out later.

**What this means architecturally:**

- The [§6](atrib-spec.md#6-key-directory) work is **not** purely a `packages/agent/` problem. Two of the three top adapters (Claude Agent SDK and Cloudflare Agents) are _server-side proxy_ plays that live in `packages/mcp/`. The [§6](atrib-spec.md#6-key-directory) success criteria need to be expanded accordingly; "framework adapters" was a misleading shorthand.
- The proxy server pattern requires new code: a thin wrapper in `packages/mcp/` that constructs an `McpServer`, calls `atrib()` on it, registers handlers that fan out to one or more upstream MCP servers (via `Client` from `@modelcontextprotocol/sdk`), and propagates results back. This is reusable across both the Claude SDK and Cloudflare adapters and possibly more in the future.
- The Vercel AI SDK adapter is the smallest change: a single function in `packages/agent/` that takes the result of `createMCPClient` and wraps the `tools()` record's `execute` callbacks with the existing interceptor lifecycle.

**Followup:** Build the proxy server primitive, then the Claude Agent SDK adapter on top of it, then the Cloudflare Agents adapter on the same primitive, then the Vercel AI SDK `tools()` wrap.

## D021: Claude Agent SDK Case A is zero-new-code; Case B uses createAtribProxy() in-process forwarder

**Date:** 2026-04-06
**Context:** [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) set the framework-adapter build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Claude Agent SDK adapter as "an in-process proxy MCP server living in `packages/mcp/`". Before writing code, the actual `@anthropic-ai/claude-agent-sdk` source was inspected (npm pack of v0.2.92) to verify how the SDK accepts and invokes user-provided MCP servers. The finding materially refines [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s plan: the Claude Agent SDK adapter splits cleanly into two cases, and the first case requires zero new code in `@atrib/mcp`.

**What the SDK actually does (verified against `@anthropic-ai/claude-agent-sdk@0.2.92`):**

1. The SDK accepts five MCP server config types in its `mcpServers` option: `stdio`, `sse`, `http`, `claudeai-proxy`, and `sdk`. The first three spawn a child or open a network connection externally to the SDK; `claudeai-proxy` is for Claude.ai-hosted servers.
2. The `sdk` type is structurally `{ type: 'sdk', name: string, instance: McpServer }` where `McpServer` is **the exact class from `@modelcontextprotocol/sdk/server/mcp.js`** (verified at `package/sdk.d.ts:7,357,716–720`):
   ```ts
   import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
   export declare function createSdkMcpServer(
     _options: CreateSdkMcpServerOptions,
   ): McpSdkServerConfigWithInstance
   export declare type McpSdkServerConfigWithInstance = McpSdkServerConfig & { instance: McpServer }
   ```
   `createSdkMcpServer()` is the user-facing helper that wraps a list of `tool()`-defined functions and returns this config object. The `instance` is a real, standard `McpServer`.
3. The SDK invokes the in-process server via the standard `McpServer.connect(transport)` API. From `package/sdk.mjs` line 62 (de-minified):
   ```js
   connectSdkMcpServer($, X) {
     let J = new fz((Q) => this.sendMcpServerMessageToCli($, Q));
     this.sdkMcpTransports.set($, J);
     this.sdkMcpServerInstances.set($, X);
     X.connect(J).catch(...)
   }
   ```
   `fz` is a custom in-process `Transport` that bridges to the Claude Code CLI. Crucially, `X.connect(J)` is the **same** `McpServer.connect(Transport)` method any other host would call. When the host sends a `tools/call` request through `fz`, it lands at the standard `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)` dispatch.

**Decision:** The Claude Agent SDK adapter has two cases, treated separately:

### Case A: User-built in-process tools (the common case for `createSdkMcpServer`)

**Zero new code in `@atrib/mcp`.** The user already has a real `McpServer` (returned as `sdkServer.instance` from `createSdkMcpServer`). They call `atrib(sdkServer.instance, { creatorKey })` exactly as they would for any other `McpServer`. Our existing `setRequestHandler` monkey-patch fires on every `tools/call` because the Claude Agent SDK invokes the standard dispatch path. The "adapter" is a documentation page and a runnable example; no library changes.

```ts
import { createSdkMcpServer, tool, query } from '@anthropic-ai/claude-agent-sdk'
import { atrib } from '@atrib/mcp'

const myTool = tool('my_tool', 'desc', schema, async (args) => {
  /* … */
})
const sdkServer = createSdkMcpServer({ name: 'my-tools', tools: [myTool] })

atrib(sdkServer.instance, { creatorKey, serverUrl: 'https://my.tools/' })

for await (const msg of query({
  prompt: '…',
  options: { mcpServers: { tools: sdkServer } },
})) {
  /* … */
}
```

### Case B: Third-party MCP servers (filesystem, fetch, custom stdio servers, etc.)

**New code: `createAtribProxy()`** in `packages/mcp/src/proxy.ts`. The user has an existing upstream MCP server (stdio child process or HTTP endpoint) and wants its tool calls attributed. The proxy is a thin in-process `McpServer` that:

1. Connects to the upstream via `Client` + the appropriate transport (`StdioClientTransport`, `StreamableHTTPClientTransport`).
2. Snapshots the upstream's tool catalog at construction time via `listTools()`.
3. Uses **low-level `setRequestHandler`** registration on its underlying `Server` for both `tools/list` (returns the snapshot) and `tools/call` (forwards to the upstream client). It deliberately bypasses `McpServer.registerTool()` because that API expects Zod-shape input schemas while the upstream returns JSON Schema; converting JSON Schema → Zod is lossy and fragile.
4. Has `atrib()` middleware applied **before** the `tools/call` handler is registered, so the existing `setRequestHandler` patch wraps the forwarding handler with the standard attribution lifecycle.
5. Returns `{ server: AtribServer, upstreamClient: Client, close(): Promise<void> }`. The host owns connecting `proxy.server` to its own transport (the host calls `proxy.server.connect(hostTransport)`); the proxy only owns the upstream client lifecycle.

The user passes the proxy to Claude Agent SDK as `{ type: 'sdk', name, instance: proxy.server }`, same shape as Case A.

**Why the architecture splits this way:**

- For Case A, the user already constructs the `McpServer`, so middleware can be applied directly. Adding a Claude-SDK-specific adapter would be a strict downgrade; more API surface for no benefit.
- For Case B, the upstream `McpServer` lives in another process or network endpoint and the host can't see it. We need an in-process surrogate. The proxy is that surrogate; it exists specifically to pull the call dispatch into a process where our middleware can sit on it.
- The proxy primitive is **reusable for Cloudflare Agents**, which has the same architectural shape (host accepts in-process MCP servers, third-party upstreams need a surrogate). This is why the new code lives in `@atrib/mcp` rather than in a Claude-SDK-specific package.

**Alternatives considered:**

- **A Claude-SDK-specific wrapper helper** like `wrapClaudeAgentSdkMcpServer(sdkConfig)`. Rejected: it would only repackage the one-line `atrib(sdkServer.instance, opts)` call into a less explicit form, hiding the fact that the user already owns a real `McpServer`. Worse, it would create the false impression that atrib needs Claude-Agent-SDK-aware code, discouraging users from understanding that the same `atrib()` function works against any MCP host.
- **A JSON-Schema → Zod converter** so `createAtribProxy` could use `McpServer.registerTool()`. Rejected: `registerTool` is not the only path to register a `tools/call` handler (the low-level `setRequestHandler` is supported and more honest about what we're doing), the conversion is lossy for JSON Schema features Zod doesn't model cleanly (e.g., `oneOf`, `not`), and it adds a new failure mode for v1 with no real upside.
- **Forwarding upstream tool definitions through `registerTool` with a permissive `z.any()` schema.** Rejected: `z.any()` schemas defeat the entire purpose of the schema validation that the SDK does at registration time; tool inputs would be passed through unchecked. The low-level approach is structurally identical without misleading about validation.
- **Multi-upstream fan-out per proxy.** Rejected for v1 ([D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) already locked this in). Each proxy maps 1:1 to an upstream; users with N upstreams create N proxies. Simpler reasoning, no namespace-collision logic, easier failure isolation per upstream.
- **Dynamic tool list refresh.** Deferred to V2. The proxy snapshots `listTools()` once at construction. Restart the proxy if the upstream catalog changes. The upstream-driven `tools/list_changed` notification path can be added later without breaking the public API.

**Files added:**

- `packages/mcp/src/proxy.ts` (~250 lines)
- `packages/mcp/test/proxy.test.ts`: 5 unit tests using `InMemoryTransport.createLinkedPair()` against a real upstream `McpServer`:
  1. `tools/list` is forwarded from the upstream snapshot
  2. `tools/call` forwards arguments and returns the response unchanged
  3. Attribution records are emitted on the proxy side (verified via mocked submission `fetch` and outbound `_meta.atrib` token)
  4. [§5.8](atrib-spec.md#58-degradation-contract) degradation: upstream `isError: true` results propagate without record emission (per [§5.3.3](atrib-spec.md#533-record-construction-and-signing))
  5. `close()` disconnects the upstream client cleanly

**Files modified:**

- `packages/mcp/src/index.ts`: exports `createAtribProxy`, `AtribProxy`, `AtribProxyOptions`, `UpstreamTransport`

**Public API surface added:**

```ts
export interface UpstreamTransport
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'inMemory'; transport: Transport }   // escape hatch for tests/legacy SSE

export interface AtribProxyOptions {
  name: string
  version?: string
  upstream: UpstreamTransport
  atrib: AtribOptions
}

export interface AtribProxy {
  server: AtribServer
  upstreamClient: Client
  close(): Promise<void>
}

export function createAtribProxy(options: AtribProxyOptions): Promise<AtribProxy>
```

**Notes on transports:**

- The MCP SDK's `SSEClientTransport` is marked `@deprecated` as of `@modelcontextprotocol/sdk@1.29.0` in favor of Streamable HTTP. We do **not** add a `type: 'sse'` upstream option to avoid baking a deprecated transport into our public API. Users with a legacy SSE upstream construct their own `SSEClientTransport` and pass it via `{ type: 'inMemory', transport: theirSseTransport }`; that path works and isolates the deprecation concern in user code rather than our package API.
- The `StreamableHTTPClientTransport` returned by `createUpstreamTransport` requires a structural cast through `unknown` because its `sessionId?: string` getter is structurally incompatible with the `Transport` interface's `sessionId?: string` declaration under `exactOptionalPropertyTypes: true` (the getter returns `string | undefined`, the interface expects `string` when present). Runtime conformance is guaranteed by `implements Transport` on the SDK's class declaration.

**Followup:** Build the runnable Claude Agent SDK example (Case A and Case B side-by-side), update `README.md` with a "Use with Claude Agent SDK" section pointing at the example, then start the Cloudflare Agents adapter on the same `createAtribProxy` primitive.

## D022: Cloudflare Agents adapter: McpAgent server-side is zero-code; Agent client-side uses attributeCloudflareAgentMcp() (NOT createAtribProxy)

**Date:** 2026-04-06
**Context:** [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) set the framework-adapter build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Cloudflare adapter as "the same proxy server pattern as Claude Agent SDK", i.e. expected to reuse the `createAtribProxy()` primitive shipped in [D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder). Before writing code, the actual `agents@0.9.0` source was inspected (npm pack + grep on `dist/index-BtHngIIG.d.ts` and `dist/client-BwgM3cRz.js`). The findings make the right architecture noticeably different from [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s prediction in two ways: the proxy isn't needed for either of Cloudflare's two MCP surfaces, and the client-side surface is even smaller than expected.

**What Cloudflare Agents actually exposes (verified against `agents@0.9.0`):**

There are **two distinct MCP integration surfaces** in the `agents` package, and they're orthogonal; a single Worker may use one, the other, or both:

### Surface 1: `McpAgent` (server-side, you're building an MCP server on Cloudflare)

`McpAgent` is an abstract base class (`dist/index-BtHngIIG.d.ts:264`) that you extend to build an MCP server hosted as a Cloudflare Durable Object. Its key shape:

```ts
declare abstract class McpAgent<Env, State, Props> extends Agent<Env, State, Props> {
  abstract server: MaybePromise<McpServer | Server$1>;
  abstract init(): Promise<void>;
  // ...
  static serve(path: string, options?: ServeOptions): { fetch: ... };
}
```

The user defines `server = new McpServer({ name, version })` as a class field and registers tools in `init()`. `McpServer` here is the **exact same class** from `@modelcontextprotocol/sdk/server/mcp.js` that `@atrib/mcp` already wraps. The McpAgent base class wires up a Cloudflare-specific transport that bridges Worker requests to `McpServer.connect(transport)`, which goes through the standard SDK dispatch path.

**This means the atrib integration for McpAgent is one line, with zero new code in `@atrib/mcp`:**

```ts
export class WeatherMcp extends McpAgent<Env> {
  server = new McpServer({ name: 'weather', version: '1.0.0' })
  async init() {
    this.server.registerTool('get_temperature', {...}, async (args) => {...})
    atrib(this.server, { creatorKey: this.env.ATRIB_PRIVATE_KEY, serverUrl: '...' })
  }
}
```

This is the same Case A pattern as Claude Agent SDK in [D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder). The retroactive wrapping shipped in commit `c450672` lets `atrib()` be called before OR after `registerTool()`.

### Surface 2: `Agent.addMcpServer` (client-side, your Agent connects out to upstream MCP servers)

The base `Agent` class (`dist/index-BtHngIIG.d.ts:1648`) exposes `readonly mcp: MCPClientManager`. `MCPClientManager.mcpConnections` is `Record<string, MCPClientConnection>` where each connection has a publicly typed `client: Client` field, a real `@modelcontextprotocol/sdk` Client.

`MCPClientManager.callTool({ serverId, name, arguments })` delegates **straight to** `mcpConnections[serverId].client.callTool(...)`. Verified at `dist/client-BwgM3cRz.js:1444`:

```js
async callTool(params, resultSchema, options) {
  const { serverId, ...mcpParams } = params;
  const unqualifiedName = mcpParams.name.replace(`${serverId}.`, "");
  return this.mcpConnections[serverId].client.callTool({
    ...mcpParams,
    name: unqualifiedName
  }, resultSchema, options);
}
```

Tool invocations through `getAITools()` (the AI SDK ToolSet returned by Cloudflare's MCPClientManager, `dist/client-BwgM3cRz.js:1319`) all flow through this `callTool` path. Tools-list discovery is cached on the connection at `addMcpServer` time but tool _invocations_ re-read `mcpConnections[serverId].client` on each call.

**This means we can wrap each connection's `client` field in place after `addMcpServer` runs**: no proxy server, no Worker route, no separate deployment, and no monkey-patching of `addMcpServer` itself. The user calls one helper:

```ts
import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'

class WeatherChatAgent extends Agent<Env> {
  interceptor = atrib({ creatorKey: this.env.ATRIB_PRIVATE_KEY, ... })
  async onStart() {
    await this.addMcpServer('weather', 'https://weather-mcp.example.com/mcp', {...})
    attributeCloudflareAgentMcp(this, { interceptor: this.interceptor })
  }
}
```

`attributeCloudflareAgentMcp` walks `agent.mcp.mcpConnections` and replaces each connection's `client` with one wrapped by `wrapMcpClient` (the existing primitive from commit `c450672`). Subsequent `MCPClientManager.callTool` invocations re-read the field and pick up the wrapped client.

**Decision:** Ship Cloudflare Agents adapter as **two separate non-conflicting integrations**:

1. **McpAgent server-side:** documentation + runnable example only. **Zero new code.** Users call `atrib(this.server, opts)` in `init()` exactly as they would for any other `McpServer`.

2. **Agent client-side:** new helper `attributeCloudflareAgentMcp(agent, { interceptor })` in `@atrib/agent` (NOT in `@atrib/mcp`; the wrap happens on the agent/consumer side, and it builds on the existing `wrapMcpClient` adapter). Plus a runnable example.

**Why this is different from [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s prediction:**

[D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) said the Cloudflare adapter would "use the same proxy server pattern as Claude Agent SDK". That prediction was based on the dependency-graph signal that `agents` bundles `@modelcontextprotocol/sdk`, and assumed the integration shape would mirror Claude SDK's. It was right that the McpAgent server-side surface exists, but the Cloudflare-specific architecture also exposes the client field publicly on `MCPClientConnection`, which is a more direct integration point than building a full proxy MCP server. The proxy approach would have worked but would have required deploying a separate Worker as the proxy URL, operationally heavier than necessary. Reading the source revealed the simpler path.

**`createAtribProxy` is NOT part of the Cloudflare adapter.** The proxy primitive shipped in [D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder) is still useful: for hosts that DON'T expose the underlying Client field publicly, or for upstream MCP servers that the user wants to attribute from outside any host (e.g. exposing a stdio MCP server as an attributed HTTP endpoint that any consumer can connect to). But for Cloudflare specifically, the client-wrap path is strictly simpler and more direct.

**Workers runtime constraint:** Cloudflare Workers don't support child processes, so the MCP SDK's `StdioClientTransport` doesn't work in the Worker runtime. Cloudflare Agents can only connect to upstream MCP servers via HTTP transports (`streamable-http` or the deprecated `sse`). If a user needs to attribute a stdio upstream from a Cloudflare Agent, they have to either run the stdio server elsewhere with an HTTP front-end, or use `createAtribProxy()` on a non-Worker runtime that proxies stdio out as Streamable HTTP and have the Cloudflare Agent connect to that proxy URL. The README in `packages/integration/examples/cloudflare-agents/` documents this.

**Alternatives considered:**

- **Proxy-Worker pattern**: deploy a separate Worker that uses `createAtribProxy() + McpAgent.serve('/')` to expose an attributed MCP server, then have the consuming Agent connect to it via `addMcpServer(name, 'https://my-proxy.workers.dev/mcp')`. Architecturally clean and validates that `createAtribProxy()` composes with `McpAgent.serve()`. **Rejected for v1 as the primary path** because it adds operational complexity (a second Worker deployment, a second URL, potentially a second Durable Object class) for a use case that the in-place client wrap solves more directly. Still documented as an option for stdio upstream cases where it's the only viable path.
- **Subclass `Agent` with an `AtribAgent` class** that overrides `addMcpServer` to wrap automatically. **Rejected** because users already extend `Agent`/`AIChatAgent` (or other framework classes), and forcing them to also extend `AtribAgent` creates a multiple-inheritance problem TypeScript can't solve. The helper-function approach lets users keep their existing inheritance hierarchy.
- **Monkey-patch `Agent.addMcpServer`** to auto-wrap on every call. **Considered for a future version** as a `installAttributionHook(agent, options)` helper that the user calls once at startup instead of after every `addMcpServer`. Deferred from v1: the explicit one-line helper at the call site is more honest and easier to debug than a hidden monkey-patch.
- **Wrap every method on `MCPClientManager`** instead of swapping the `client` field on each connection. **Rejected** because `MCPClientManager` has many methods (`callTool`, `readResource`, `getPrompt`, `listTools`, etc.) and only `callTool` needs attribution. Wrapping at the per-connection `client` level is narrower and requires no knowledge of `MCPClientManager`'s evolving API.

**Files added:**

- `packages/agent/src/adapters/cloudflare-agent.ts` (~170 lines): `attributeCloudflareAgentMcp(agent, options)` helper. Walks `agent.mcp.mcpConnections`, wraps each `client` with `wrapMcpClient`, marks wrapped clients with a `Symbol.for('atrib.cloudflare.wrapped')` for idempotency. Per-connection failures are caught and skipped per spec [§5.8](atrib-spec.md#58-degradation-contract) degradation.
- `packages/agent/test/cloudflare-agent.test.ts`: 5 unit tests using a structural mock of `agents`'s `Agent.mcp` interface (we can't import the real `agents` package because it requires the WorkerD runtime). Tests cover: tool calls flow through the interceptor with W3C trace context in outbound `_meta`, idempotency on second helper call, malformed connection skip-without-throwing, missing `mcp.mcpConnections` returns 0 with warning, and `serverUrls` override.
- `packages/integration/examples/cloudflare-agents/README.md`: Surface 1 + Surface 2 walkthrough, runtime-constraint notes, environment variables, and expected behavior.
- `packages/integration/examples/cloudflare-agents/surface-1-mcp-agent.ts`: runnable McpAgent server example.
- `packages/integration/examples/cloudflare-agents/surface-2-agent-client.ts`: runnable Agent client example.

**Files modified:**

- `packages/agent/src/index.ts`: exports `attributeCloudflareAgentMcp` + types (`CloudflareAgentLike`, `AttributeCloudflareAgentMcpOptions`). Also exports `MinimalMcpClient` and `WrapMcpClientOptions` from the existing `mcp-client` adapter (these were previously private to the package).

**Public API surface added (`@atrib/agent`):**

```ts
export interface CloudflareAgentLike {
  mcp: {
    mcpConnections: Record<string, { client: unknown; url?: URL | string }>
  }
}

export interface AttributeCloudflareAgentMcpOptions {
  interceptor: ToolCallInterceptor
  /** Optional override map of server name → canonical serverUrl */
  serverUrls?: Record<string, string>
}

export function attributeCloudflareAgentMcp(
  agent: CloudflareAgentLike,
  options: AttributeCloudflareAgentMcpOptions,
): number // returns number of newly-wrapped connections
```

The `CloudflareAgentLike.mcp.mcpConnections[*].client` field is typed as `unknown` (not `MinimalMcpClient`) so the real Cloudflare `MCPClientConnection.client: Client` is structurally assignable without forcing users to cast at the call site. The helper performs a runtime structural check (`isMinimalMcpClient`) on each connection's client before wrapping.

**Notes on test coverage:**

The cloudflare-agent unit tests can't import the real `agents` package because it depends on the WorkerD runtime (Durable Object bindings, Cloudflare-specific globals, etc.). Instead, the tests construct a structural mock that mirrors the public shape we depend on: `{ mcp: { mcpConnections: { [name]: { client: MinimalMcpClient, url } } } }`. This validates the helper's behavior against the same field shapes the real Cloudflare classes expose. If `agents` ever changes the public shape, the integration would break in production silently; a future improvement is to add a daily/weekly CI job that npm-installs the latest `agents` and runs a regression test against the real types (similar to the SDK shape regression test added in [D019](#d019-mcp-sdk-monkey-patch-is-documented-and-shape-tested-against-the-real-sdk)).

The runnable examples (`surface-1-mcp-agent.ts`, `surface-2-agent-client.ts`) are the secondary line of defense: they typecheck against user-installed `agents` in a real Worker project, and any breaking change in the Cloudflare API would surface there at deploy time.

**Test results:** 360 tests passing across all 4 packages (was 355; +5 cloudflare-agent unit tests). No regressions in mcp (166), verify (82), or integration (5).

**Followup:** Vercel AI SDK adapter is the next [§6](atrib-spec.md#6-key-directory) chunk. Different shape entirely: wrap the `tools()` record returned by `createMCPClient`, not `callTool()`. Lives in `@atrib/agent`, similar surface to `attributeCloudflareAgentMcp` but different mechanism. After Vercel AI SDK, [§7](atrib-spec.md#7-harness-integration-patterns) (developer integration documentation) and [§8](atrib-spec.md#8-privacy-postures) (TypeDoc API reference) remain.

---

## D023: Vercel AI SDK MCP adapter: monkey-patch `MCPClient.request`, NOT `wrapMcpClient` and NOT the `tools()` execute callbacks

**Date:** 2026-04-06
**Context:** Third framework adapter in the build order, after Claude Agent SDK ([D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder)) and Cloudflare Agents ([D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy)). The Vercel AI SDK exposes MCP integration through `createMCPClient()` in `@ai-sdk/mcp` (and the legacy `experimental_createMCPClient()` re-exported from `ai`). The initial assumption (anchored to the followup note in [D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy)) was that this would be a `tools()`-record-wrapping job: replace each tool's `execute()` callback with one that runs through atrib's interceptor. Source-reading `@ai-sdk/mcp@1.0.35`'s `dist/index.mjs` invalidated that plan and surfaced two structural facts that ruled out both `wrapMcpClient` and the `tools()`-wrap approach.

**Decision:** Ship a third adapter shape, `attributeVercelAiSdkMcp(client, { interceptor, serverUrl? })`, which **monkey-patches the client's `request()` method in place**. The patch intercepts only `tools/call` JSON-RPC methods, injects atrib's outbound `_meta` (atrib token, traceparent, tracestate, baggage, X-atrib-Chain) into `request.params._meta`, forwards to the original `request()`, then flows the raw response (with its own `_meta` intact) through `interceptor.onAfterToolResponse`. Idempotent via `Symbol.for('atrib.vercel-ai-sdk.patched')`. Lives at `packages/agent/src/adapters/vercel-ai-sdk-mcp.ts`. Six unit tests cover the contract (passthrough, injection, no caller mutation, response flow, idempotency, [§5.8](atrib-spec.md#58-degradation-contract) degradation).

**Two structural facts that forced this approach:**

1. **`@ai-sdk/mcp` MCPClient is NOT a `@modelcontextprotocol/sdk` Client.** It has its own JSON-RPC implementation. Different `callTool` shape (`{name, args, options}` vs `{name, arguments, _meta}`), and crucially the `_meta` field is **not accepted** by AI SDK's `callTool`; it builds the request as `{ method: 'tools/call', params: { name, arguments: args } }` at `dist/index.mjs:1819` with no `_meta` field at all. So `wrapMcpClient` (which depends on `client.callTool({ name, arguments, _meta })` shape) cannot patch this client. Verified by structural source read, not by importing the package as a dependency.

2. **`tools()` builds AI-SDK-shaped tool definitions whose execute() callbacks pass through `extractStructuredContent`** when an outputSchema is set, and that helper **drops the `_meta` field from the result envelope** at `dist/index.mjs:1989-1991`. Wrapping at the AI SDK execute layer would lose the response-side `_meta` (which carries the server's `atrib` chain token from the @atrib/mcp middleware) for any tool with structured output. This rules out the `tools()`-record-wrapping approach the [D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy) followup had initially proposed.

**Why `request()` is the right integration point:** It's the JSON-RPC bottleneck through which every `tools/call` flows on its way to the transport (`dist/index.mjs:1750`). Patching here lets us inject `_meta` into the outbound request **before** it hits the transport and read raw `_meta` from the response **before** any AI-SDK-specific transformation strips it. This is structurally symmetric to how `@atrib/mcp` patches `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)` on the server side ([D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)): same pattern, opposite end of the wire.

**Alternatives considered:**

- **Wrap `tools()` execute callbacks**: fails because `extractStructuredContent` strips `_meta` before reaching the callback (point 2 above). Also requires re-wrapping every time the user calls `tools()`, since each call returns fresh function references.
- **Use `wrapMcpClient`**: fails because `@ai-sdk/mcp`'s callTool shape doesn't accept `_meta` (point 1 above). The Proxy-based wrapper would inject `_meta` into a field that's structurally discarded by the AI SDK before the JSON-RPC request is built.
- **`createAtribProxy`**: overkill. The Vercel AI SDK already accepts a real working MCPClient connected to the upstream; we don't need to interpose a fake server. The proxy pattern is for cases (like Claude Agent SDK Case B) where the host accepts a `McpServer` instance but not an MCPClient.
- **Subclass `MCPClient`**: would require importing `@ai-sdk/mcp` as a hard dependency, which we explicitly avoid (the AI SDK has a heavy transport dependency tree we don't want in `@atrib/agent`).

**Idempotency:** The marker symbol pattern from [D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy)'s `attributeCloudflareAgentMcp` is reused: `Symbol.for('atrib.vercel-ai-sdk.patched')` set on the client after first patch, checked on entry. Calling the helper twice on the same client is a no-op the second time. Verified by a unit test that asserts the `request` method reference is unchanged after a second call.

**Order independence:** The helper can be called BEFORE or AFTER `mcpClient.tools()` because the AI SDK builds tool execute() callbacks that read `client.request` at **invocation time**, not at build time. This means users don't need to remember to patch before calling `tools()`; the patch fires correctly regardless of order. This is documented in both the source comment and the example README.

**Caller-arg immutability:** The patched `request()` constructs a new args object (`{ ...args, request: { ...args.request, params: { ...params, _meta: outboundMeta } } }`) rather than mutating the caller's params. Verified by a unit test that captures the caller's params reference and asserts `_meta` was never added to it. This matters because AI SDK tool execute callbacks may share/cache the args object.

**[§5.8](atrib-spec.md#58-degradation-contract) degradation:** Both `onBeforeToolCall` and `onAfterToolResponse` are wrapped in try/catch. On `onBeforeToolCall` failure, the request is forwarded with the **original** params (no `_meta` injection), never mutated, never broken. On `onAfterToolResponse` failure, the result is still returned to the caller. Both failure paths log to `console.warn` with the `atrib:` prefix per spec [§5.8](atrib-spec.md#58-degradation-contract).

**Example:** `packages/integration/examples/vercel-ai-sdk/` ships a runnable `integration.ts` showing the four-step wiring (interceptor → createMCPClient → attributeVercelAiSdkMcp → tools), plus a README that recommends routing model calls through the Vercel AI Gateway via the `'provider/model'` string form (e.g. `'openai/gpt-5.4'`) for OIDC auth, automatic failover, and unified observability. The README shows both the implicit string form and the explicit `gateway('openai/gpt-5.4')` helper from `@ai-sdk/gateway`; both route through the Gateway with no provider API keys required. The `examples/` directory is excluded from `@atrib/integration`'s tsconfig so it typechecks against the user's installed AI SDK, not our test build (consistent with [D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder)/[D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy) example handling).

**Test results:** 366 tests passing across all 4 packages (was 360; +6 vercel-ai-sdk-mcp unit tests). No regressions in mcp, verify, or integration.

**Followup:** With three framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK), the framework-adapter rollout is substantially complete. Remaining work: decide whether to add OpenAI Agents SDK and/or Mastra adapters based on the GitHub usage data from earlier research, then developer integration documentation and TypeDoc API reference. A pattern is emerging across [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)/[D021](#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder)/[D022](#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy)/[D023](#d023-vercel-ai-sdk-mcp-adapter-monkey-patch-mcpclientrequest-not-wrapmcpclient-and-not-the-tools-execute-callbacks): each adapter required source-reading the host framework before deciding the integration shape, and in every case the initial guess from [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) was wrong in the specifics. The general approach (interceptor lifecycle + structural-shape adapters) holds, but the integration point varies per framework: server-side `setRequestHandler` patch (@atrib/mcp), in-process `McpServer` proxy (Claude Agent SDK Case B), in-place `client` field replacement (Cloudflare Agent), and `request()` monkey-patch (Vercel AI SDK).

---

## D024: LangChain JS MCP adapter: NOT docs-only. `MultiServerMCPClient` needs a proper helper because its internal Client references are `#private`

**Date:** 2026-04-06
**Context:** [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision) asserted that LangChain would ship as a docs-only adapter because `loadMcpTools(name, rawClient)` accepts an injected `@modelcontextprotocol/sdk` Client, so `wrapMcpClient` from `@atrib/agent` would cover it transparently. After review concluded that docs-only was insufficient for the common usage path, `@langchain/mcp-adapters@1.1.3` was unpacked and source-read for its actual API. The docs-only claim was half right and half wrong.

**What the SDK actually exposes (verified against `@langchain/mcp-adapters@1.1.3`):**

LangChain has **two** MCP APIs, not one:

1. **Low-level: `loadMcpTools(serverName, client, options?)`**: second parameter is typed `Client | Client_from_mcp_sdk` at `dist/tools.d.ts:28`. Users construct their own Client, call `.connect(transport)`, then pass it in. For this path, `wrapMcpClient` works transparently because the user owns the Client and can substitute a wrapped version. [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s "docs-only" claim is correct for this path.

2. **High-level: `new MultiServerMCPClient({ mcpServers: {...} })`**: config-driven, used by the vast majority of LangChain agents because it handles multi-server setup, reconnection, and auth plumbing internally. The multi-client constructs `@modelcontextprotocol/sdk` Client instances behind `#private` fields (`dist/client.d.ts:12`). Users NEVER see the Client reference directly. There is a `getClient(serverName)` getter that returns the internal Client, but NO corresponding setter; `wrapMcpClient` (which returns a NEW Proxy-wrapped object) cannot be substituted because there is nowhere to put the new reference. [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s "docs-only" claim is WRONG for this path.

**Fork propagation, the second structural finding that makes this a non-trivial adapter:**

LangChain's `_callTool` function (`dist/tools.js:340-420`) supports per-call HTTP header changes via a `beforeToolCall` hook and an internal `client.fork(headers)` call that creates a fresh Client with the requested headers, then invokes `callTool` on the forked instance (line 384: `const finalClient = hasHeaderChanges && typeof client.fork === "function" ? await client.fork(headers) : client`). This is the idiomatic pattern for per-user authentication in LangChain MCP tools.

A naive monkey-patch on the original Client's `callTool` would silently drop attribution for every per-call-header tool invocation. The forked client is a fresh instance with its own unpatched `callTool`. This is exactly the kind of invisible bug that would only surface months later when an auditor asked "why are our per-user tool calls not in the attribution log?"

**Decision:** Ship `attributeLangchainMcp(multiClient, { interceptor, serverUrls?, servers? })` as a fourth adapter shape, living at `packages/agent/src/adapters/langchain-mcp.ts`. The helper:

1. Reads `multiClient.config.mcpServers` to enumerate configured server names (default; overridable via `options.servers`).
2. For each server, calls `multiClient.getClient(serverName)` to reach the internal Client.
3. Monkey-patches `callTool` on each Client in place (Vercel AI SDK adapter pattern, not `wrapMcpClient` Proxy pattern, because there's nowhere to put a Proxy replacement).
4. **Also monkey-patches `fork()` when present**, so forked clients are recursively patched via the same `patchClient` helper before being returned to LangChain's `_callTool`. Every forked instance goes through atrib just like the original. This closes the per-call-header attribution gap.
5. Idempotent via `Symbol.for('atrib.langchain-mcp.patched')` on each patched Client.
6. Order-independent: can be called before or after `multiClient.getTools()` because LangChain dereferences `client.callTool` at invocation time (`dist/tools.js:391`), not at tool construction time.
7. Async: returns `Promise<number>` (count of newly patched clients) because `getClient()` is async; it lazy-initializes connections if they haven't been started yet.

The low-level `loadMcpTools(name, rawClient)` path still works with the existing `wrapMcpClient` helper and is documented in the example README rather than having a dedicated helper; that path genuinely is a docs-only surface because the user owns the Client.

**Why not `wrapMcpClient` for the high-level path:**

Because `MultiServerMCPClient.getClient(name)` is a getter, not a setter. The multi-client's internal client references are private (`#private` in TypeScript, enforced at the class level). Even if we construct a Proxy via `wrapMcpClient(originalClient, { interceptor })`, there is no public API to inject it back into the multi-client. The only mechanism that works is in-place mutation of the Client the getter returned, i.e., monkey-patch.

**Why not subclass `MultiServerMCPClient`:**

Would require importing `@langchain/mcp-adapters` as a hard dependency, which we explicitly avoid. The LangChain ecosystem has a heavy transitive dependency tree (langgraph, core messages, zod) that would inflate `@atrib/agent`'s build. Structural typing + runtime patching keeps the integration zero-dependency on LangChain.

**Why not the Vercel-AI-SDK-style `request()` monkey-patch:**

LangChain's extended `Client` (from `@langchain/mcp-adapters`'s `connection.ts`) IS a `@modelcontextprotocol/sdk` Client subclass, so it exposes `callTool` directly; no custom JSON-RPC layer between tool dispatch and the transport. Patching at `callTool` is the natural integration point; patching `request()` would be two layers deeper than necessary.

**Idempotency and fork recursion (interaction):**

A fork of an already-patched client: when the patched `fork()` is invoked, it calls the original `fork`, then passes the returned forked client through `patchClient` which checks the idempotency marker. The returned forked client is a fresh object with no marker, so it gets patched fresh. A subsequent `fork()` on an already-patched-by-recursion forked client returns a new client that also needs patching. Each fork is independently patched. The idempotency marker prevents double-patching of the SAME client instance, not of its fork descendants.

**Alternatives considered:**

- **Docs-only for both paths ([D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision)'s original plan).** Rejected because it leaves `MultiServerMCPClient`, the idiomatic LangChain API, unsupported. Users following our docs would have to rewrite their agent to use `loadMcpTools` directly, which is a non-starter for existing LangChain apps.
- **Subclass `MultiServerMCPClient` and publish as `@atrib/langchain-mcp`.** Rejected for the dependency-tree reason above.
- **Proxy-wrap `getClient` itself** so every call returns a wrapped client. Would work for direct `getClient` users, but LangChain's internal `_initializeConnection` doesn't go through `getClient`; it uses the `#private` field directly, so the proxy would not catch the Client that tool construction binds to. Fragile.
- **Skip fork propagation** and document the per-call-header limitation. Rejected per the radical-honesty rule: a silent attribution drop for an idiomatic LangChain pattern would be exactly the kind of bug that undermines trust in the protocol.

**Test coverage:** 9 unit tests against a structural mock (`makeFakeClient` + `makeFakeMultiClient` in `test/langchain-mcp.test.ts`):

1. Patches every configured server by default, returns count
2. Idempotent; second call returns 0, callTool reference unchanged
3. Injects `_meta` from interceptor on tools/call, with `traceparent` assertion
4. Does not mutate caller-supplied params object
5. Flows responses through `onAfterToolResponse` with raw `_meta`
6. **Fork propagation: forked clients are recursively patched**
7. [§5.8](atrib-spec.md#58-degradation-contract) degradation: `onBeforeToolCall` failure does not break the call
8. Skips servers whose `getClient` returns undefined (not initialized)
9. Selective patching via `options.servers`

**Test results:** 375 tests passing across all 4 packages (was 366; +9 langchain-mcp). No regressions.

**Followup:** Four framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS). The unified `packages/agent/README.md` documents all adapters side-by-side under two coverage matrices (framework adapters + payment protocols), making the "one interceptor, any framework" story concrete and demonstrable. Remaining adapter work: OpenAI Agents SDK (deferred per [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision); meaningfully different architecture, custom transports) and Mastra (deferred; smaller footprint, needs source verification). Next priority is developer integration docs, including the local log stub and end-to-end demo.

---

## D025: `@atrib/log-dev` + spec/code drift fix in submission wire format + `priority` wired to two real consumers

**Date:** 2026-04-06
**Context:** A runnable end-to-end demo for developer onboarding required a local Merkle log stub. While preparing to build that stub against spec [§2.6](atrib-spec.md#26-submission-api-write-interface), source-reading `@atrib/mcp/src/submission.ts` surfaced two real wire-format bugs that would have caused every submission from the existing client to be rejected by any spec-compliant log:

**Discrepancy 1: Request body shape was wrong.** Spec [§2.6.1](atrib-spec.md#261-submit-entry) specifies the POST body as a bare attribution record. The existing `submitWithRetry` was wrapping it as `{record, priority}`. The wrapping pattern was even codified in `packages/mcp/test/submission.test.ts` ("sends record and priority in request body"), meaning the test was written against the buggy code rather than against the spec.

**Discrepancy 2: Proof bundle field naming was wrong.** Spec [§2.6.2](atrib-spec.md#262-inclusion-proof-response) returns `{log_index, checkpoint, inclusion_proof, leaf_hash}` (snake_case). The existing `ProofBundle` interface used camelCase (`logIndex`, `inclusionProof`). This was less consequential because the cast to `ProofBundle` in the submission queue is opaque; nothing read the fields after caching, but `@atrib/verify`'s `GraphNode.log_index` already used snake_case correctly, so the two packages were inconsistent with each other and only one matched the spec.

**Decision:** Fix both discrepancies as part of this chunk and ship `@atrib/log-dev` as a faithful spec [§2.6](atrib-spec.md#26-submission-api-write-interface) reference implementation. Specifically:

1. **Wire format fix in `submission.ts`:** POST body is now a bare signed record per [§2.6.1](atrib-spec.md#261-submit-entry). The `ProofBundle` interface uses snake_case to match [§2.6.2](atrib-spec.md#262-inclusion-proof-response) exactly. Updated all consuming tests across `@atrib/mcp`, `@atrib/agent`, and `@atrib/integration` (test-harness mocked the wrong shape too; fixed there as well).

2. **`@atrib/log-dev`**: new private workspace package at `packages/log-dev/`. Implements `POST /v1/entries` with full [§2.6.1](atrib-spec.md#261-submit-entry) validation (Steps 2-6, skipping Step 1 cryptographic signature verification to avoid a circular dep on `@atrib/verify`), returns spec [§2.6.2](atrib-spec.md#262-inclusion-proof-response)-shaped proof bundles with deterministic placeholder hashes, and exposes an inspection API (`entries`, `onSubmit`, `clear`) for tests and demos. Marked `private: true` so it cannot be `pnpm publish`'d to npm. README has a prominent ⚠️ NOT FOR PRODUCTION warning at the top.

3. **`priority` wired to two real consumers**: an early sketch dropped `priority` from the wire entirely after recognizing that the in-memory dev log cannot meaningfully consume it. That sketch was wrong: the field has two real consumers that justify keeping it on the wire:

   **Consumer #1: `flush()` retry ordering in `@atrib/mcp/src/submission.ts`.** When the process is shutting down and `pendingRecords` contains records whose initial submission failed, `flush()` now drains them in priority order: high (transactions) before normal (tool calls). If the process is killed mid-flush (container restart, OOM, deploy rollover), high-priority records have already had their final retry and are more likely to make it to the log. Losing a transaction record (the receipt of money moving) is meaningfully worse than losing a tool-call record, so this ordering is a real safety property. `pendingRecords` was changed from `Map<string, AtribRecord>` to `Map<string, {record, priority}>` to track priority across the failure→flush boundary. Verified by a new test in `submission.test.ts` ("flush() drains pendingRecords in priority order").

   **Consumer #2: `@atrib/log-dev`'s admission control under capacity.** The dev log accepts a `maxConcurrent` option (default `Infinity`). When capacity is finite and the in-flight submission count is at the cap, new submissions go into a priority queue inside `storage.ts` and high-priority records are admitted first when capacity frees up. This faithfully models the admission-control behavior a real Tessera-backed log would expose under load. Verified by a new test in `log-dev/test/server.test.ts` ("high-priority submissions are admitted before normal under capacity pressure") that uses `maxConcurrent: 1` and `processingDelayMs: 30` to deterministically demonstrate the priority ordering.

   The wire format is `X-atrib-Priority: high|normal` HTTP header, a non-conflicting extension to spec [§2.6.1](atrib-spec.md#261-submit-entry) that does not require a spec change because HTTP headers are a standard extension mechanism.

4. **End-to-end demo** at `packages/integration/examples/end-to-end/demo.ts`, runnable in a single command (`pnpm --filter @atrib/integration demo`), wires together the dev log + a fake merchant tool server (wrapped with `@atrib/mcp`'s `atrib()`) + a fake agent client (wrapped with `@atrib/agent`'s `wrapMcpClient`) + a stubbed x402 payment receipt that triggers the production transaction-detection logic in `transaction.ts`. CLI visualizer subscribes to the dev log via `onSubmit()` and pretty-prints each record with colored chain hashes as it lands. Verified end-to-end: one run produces 2 tool_call records + 1 transaction record, all chained, all visible in the CLI output.

**Why this matters strategically:**

The end-to-end demo answers "what can a developer hand a customer in 15 minutes?" Before this work, the protocol was implemented but a customer couldn't watch it work without standing up Tessera first (which doesn't exist). With the demo, `pnpm demo` produces a complete attribution chain visible in real time, with real signatures and real transaction detection, against a real (but in-memory) spec-compliant log. The fakery is in the surrounding environment: the merchant returns hardcoded search results, the agent issues hardcoded tool calls, the x402 payment is a stubbed header, but the protocol layer is real.

The spec/code drift fix is the kind of thing that only gets caught when you build a real reference implementation. Mocking `globalThis.fetch` in unit tests doesn't catch wire-format bugs because the mocks don't validate the request shape against the spec. The dev log is a real server that validates per [§2.6.1](atrib-spec.md#261-submit-entry); it caught the wrong wire format on the first integration attempt. This is a strong argument for keeping `@atrib/log-dev` in the test infrastructure permanently rather than treating it as a one-off demo helper.

**Alternatives considered:**

- **Drop `priority` from the wire entirely (option (a) from the priority discussion).** Initially leaned toward this on the grounds that no consumer existed. Rejected after a closer review surfaced two real consumers that DO exist, they just hadn't been wired yet.
- **Keep the broken wire format and note the spec drift in TODO.md.** Rejected per the radical-honesty rule. Shipping a known wire-format bug to customers because "we'll fix it later" is exactly the kind of avoidable failure the rule exists to prevent.
- **Build the dev log as a separate `services/log/dev-server/` directory rather than a workspace package.** Rejected after weighing trade-offs: option A (workspace package) wins because the demo can `import { startDevLog } from '@atrib/log-dev'` directly without spawning a child process, the inspection API is type-safe and ergonomic, and the existing `@atrib/mcp` and `@atrib/agent` test suites can reuse the dev log as a real fixture in the future instead of mocking `fetch`.
- **Build the dev log in Go (matching the future Tessera service).** Rejected for this chunk. The Go Tessera-backed log will live in `services/log/` when it ships; the dev log is a TypeScript fixture for in-process integration tests and demos. They have different operational profiles and can coexist; the dev log is not a stepping stone to the real one.
- **Implement signature verification ([§2.6.1](atrib-spec.md#261-submit-entry) Step 1) in the dev log.** Rejected because it would create a circular workspace dep: `@atrib/log-dev` would have to import from `@atrib/verify`, which already imports from `@atrib/mcp`. The dev log skips signature verification and is honest about it in the file header. Anyone using the dev log for end-to-end correctness testing should run `@atrib/verify` against the captured records separately.

**Test results:** 391 tests passing across all 5 packages (was 375 + 16 new):

- `@atrib/mcp`: 169 (was 166, +3 wire-format conformance tests + 1 priority ordering test, -1 deleted "wraps record/priority in body" test that asserted the wrong shape)
- `@atrib/agent`: 122 (unchanged)
- `@atrib/verify`: 82 (unchanged)
- `@atrib/log-dev`: **13 (new)**: wire-format conformance + priority queue ordering + inspection API
- `@atrib/integration`: 5 (unchanged; test harness updated to match new wire format)

Plus the demo runs end-to-end and produces the expected output (verified manually before commit).

**Followup:** With the spec/code drift fixed and the dev log in place, the next layer of customer-readiness work is (a) the `services/log/` Tessera-backed Go service for production deployments, and (b) publishing `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` to npm so customers can actually `pnpm add` them. The unified `packages/agent/README.md` is ready to be the customer-facing entry point once packages are published.

---

## D026: Spec [§2.6.1](atrib-spec.md#261-submit-entry) conformance corpus at `spec/conformance/2.6.1/` (shared between TS dev log and future Go log)

**Date:** 2026-04-06

**Context:** After [D025](#d025-atriblog-dev-speccode-drift-fix-in-submission-wire-format-priority-wired-to-two-real-consumers) landed, a remaining gap surfaced: `@atrib/log-dev` and the future `services/log/` Tessera-backed Go service had no shared agreement on [§2.6.1](atrib-spec.md#261-submit-entry) behavior beyond the prose in the spec. Two implementations of "what does [§2.6.1](atrib-spec.md#261-submit-entry) reject" derived independently from the spec text would inevitably drift in subtle ways. The right move was to ship a conformance corpus immediately, even though the Go consumer doesn't yet exist, so when it arrives it has a fixed reference set to validate against.

**Decision:** Build a static, shared, language-neutral conformance corpus at `spec/conformance/2.6.1/` consisting of one JSON file per test case plus a manifest. Each case is a fully self-contained `{request, expected}` pair: the `request.body` is the bare signed `AtribRecord` ready to JSON.stringify, and `expected.status` is the canonical accept/reject outcome. A reference TypeScript consumer ships in `@atrib/log-dev`'s test suite today; the future Go service will consume the same files when it ships.

**Implementation details:**

1. **Corpus structure** (8 cases + 1 sequence at this writing, growable):
   - `cases/accept-tool-call.json` and `accept-transaction.json`: well-formed signed records
   - `cases/reject-bad-signature.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 1 (Ed25519 verify fails)
   - `cases/reject-wrong-spec-version.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 2
   - `cases/reject-unknown-event-type.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 3
   - `cases/reject-future-timestamp.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 4 (timestamp 20 minutes ahead of `reference_time_ms`)
   - `cases/reject-malformed-context-id.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 5
   - `cases/reject-non-json-body.json`: pre-Step-1 sanity (raw string body, not parseable)
   - `sequences/idempotent-resubmission.json`: [§2.6.1](atrib-spec.md#261-submit-entry) Step 6 (same record twice, same proof, log_size stays at 1)

2. **Time handling.** The corpus stores fully-signed records with frozen timestamps, so the bytes are byte-deterministic across regenerations. Step 4 (the future-timestamp case) only produces stable validation outcomes if the consumer pretends "now" is the manifest's `reference_time_ms` (`2026-01-01T00:00:00Z`). The TS consumer uses `vi.useFakeTimers()` + `vi.setSystemTime()`. A Go consumer would inject a `clock.Clock` interface into its validator. The mock-clock requirement is documented in the corpus README and in the consumer code.

3. **Hardcoded signing seed.** The seed is `0x07` repeated 32 times, committed in `manifest.json` as `signing.seed_b64url`. This is so the corpus is regeneration-deterministic; successive runs of the generator produce byte-identical files unless the inputs change. The seed is loudly marked NEVER-FOR-PRODUCTION in both the README and the manifest.

4. **Per-implementation skip lists in the consumer, not in the corpus.** `@atrib/log-dev` cannot honor `reject-bad-signature` because it skips [§2.6.1](atrib-spec.md#261-submit-entry) Step 1 to avoid a circular workspace dep on `@atrib/verify`. The TS consumer maintains a `DEV_LOG_SKIPS` map keyed by case name, with a justification string. The corpus itself stays canonical; the Go service is expected to honor every case (its `DEV_LOG_SKIPS` equivalent will be empty). This keeps the corpus clean of implementation-specific notes.

5. **Generator at `packages/log-dev/scripts/generate-conformance-corpus.ts`** (run via `pnpm --filter @atrib/log-dev corpus`). It uses `signRecord` from `@atrib/mcp` (the canonical signer) so the test signatures are byte-identical to what a real `@atrib/mcp`-using merchant would produce. The generator imports nothing implementation-specific to the dev log; it only writes JSON.

6. **Consumer at `packages/log-dev/test/conformance.test.ts`** (9 tests, 1 skipped). Reads the manifest, iterates over `cases/` and `sequences/`, freezes the clock per test, and asserts the expected outcome.

**Why a separate corpus directory rather than a fixture directory inside `@atrib/log-dev`:**

The corpus is shared infrastructure between TypeScript and Go implementations of the same protocol. Putting it inside `packages/log-dev/test/fixtures/` would either force the future Go service to copy it (drift risk) or to reach across language boundaries (awkward). Sitting at `spec/conformance/2.6.1/` next to `atrib-spec.md` makes it discoverable from the spec itself and accessible to any subtree of the repo. The generator stays inside `@atrib/log-dev` because that's where the canonical signer is reachable as a workspace dep, but the output is implementation-neutral.

**What this DOESN'T solve:**

- Verification that the corpus is truly implementation-independent. We catch this only when the Go consumer ships and runs the same files. Until then, there's a small risk that I've encoded a TS-specific assumption into the JSON (e.g., header name casing, JSON field ordering). I've kept the consumer trivial enough that this risk is small but it exists.
- [§2.6.2](atrib-spec.md#262-inclusion-proof-response) proof bundle shape conformance beyond "is the type of each field correct?"; the dev log returns placeholder hashes, so the corpus can't assert specific bytes. A real Tessera service will produce real Merkle proofs that the corpus consumer would need to verify with `@atrib/verify`'s strict path, which is a different test layer.
- [§2.5.1](atrib-spec.md#251-checkpoint-endpoint) (checkpoint endpoint), [§2.5.2](atrib-spec.md#252-tile-endpoints) (tile endpoints), and [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) (witnessing). These are deferred until the Go service ships; there's no point conformance-testing endpoints that no implementation has yet.

**Test results:** 8 conformance cases + 1 sequence = 9 new tests in `@atrib/log-dev`, of which 8 pass and 1 is skipped (the bad-signature case, with documented reason). Total package tests: 22 (was 13). Total workspace tests: 400 (399 passing, 1 documented skip), up from 391.

**Followup:** When `services/log/` ships, the Go service's test suite reads the same `spec/conformance/2.6.1/` directory. Any drift between the two implementations surfaces immediately as a test failure. If the spec grows new validation rules (e.g., a Step 7), regenerate the corpus with `pnpm --filter @atrib/log-dev corpus` and add a new case file in the same PR. The sync trigger for this is now in `CLAUDE.md`.

## D027: Protocol adapters as a parallel integration surface to framework adapters

**Date:** 2026-04-21

**Context:** The SDK ships framework adapters for each MCP host (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS, plus the raw `@modelcontextprotocol/sdk` client). These hook atrib INTO a host agent framework at runtime. They answer the question "how does atrib observe this agent's tool calls?"

A second, orthogonal question has come up in practice: "what does atrib observe about a specific payment protocol's ecosystem, independent of any single agent session?" For x402 specifically, there is rich public on-chain data that no existing dashboard analyzes contract-first, and attribution gaps no one has worked through. The same question applies to ACP, UCP, AP2, MPP: each has its own ecosystem-level observability problem distinct from runtime detection.

Runtime detection (already shipped in `@atrib/agent`, [D008](#d008-middleware-pattern-not-method-calls)–[D009](#d009-factpolicy-separation-as-an-architectural-boundary)) handles the "session used x402" case during runtime. It does not answer "what is the x402 ecosystem's volume, who are the facilitators, and where does the attribution gap live?" Those questions require a retrospective ecosystem scanner, a canonical facilitator registry, and protocol-specific attribution machinery (e.g., decoding Permit2 witness calldata, sender-pattern clustering against on-chain recipient graphs).

**Decision:** Establish **protocol adapters** as a first-class architectural pattern in atrib, parallel to framework adapters. Each adapter provides observability FOR a specific payment protocol's ecosystem and has three canonical layers:

1. **Registry**: a versioned source of truth for which on-chain identifiers (wallets, signers, merchant accounts) belong to which protocol actor. Combines the protocol's canonical registry (when it exists), facilitator self-declaration endpoints (`/supported` for x402), and an overlay for entries absent or undisclosed in canonical sources.
2. **Scanner**: on-chain (or off-chain) aggregators that measure ecosystem-level activity. For x402 that means Dune SQL contract-first queries today and HyperSync-backed bulk scans next. Methodology is protocol-specific (wallet-first vs contract-first vs event-pattern), but every adapter outputs the same shape: `sender → {tx_count, transfer_count, value}` or equivalent.
3. **Attribution**: maps scanned observations to the registry's known actors, with an unattributed residual bucket. Attribution techniques are protocol-specific (witness decoding, sender-pattern clustering, payTo correlation) but every adapter emits `{attributed, unknown}` cleanly splittable output.

Two observation surfaces exist per protocol: **runtime** (via `@atrib/agent` framework adapters at an agent session) and **retrospective** (via protocol adapters across the entire ecosystem). They compose. A Cloudflare Agent using `@atrib/agent` to capture x402 payments at runtime participates in the same observability graph as the retrospective scan.

**Implementation details:**

1. **Pattern template**. Each protocol adapter has the same directory shape: `registry/`, `scanner/`, `attribution/`, `queries/`, `results/`, `README.md`. The top-level README frames the adapter as "atrib × `<protocol>`" and catalogs its layers against atrib's spec sections ([§3](atrib-spec.md#3-graph-query-interface) graph, [§4](atrib-spec.md#4-attribution-policy-format) attribution calculation, [§2](atrib-spec.md#2-merkle-log-protocol) log as tamper-evidence for the dataset).

2. **Naming**. Protocol adapters are named by the protocol: `x402/`, `acp/`, `ucp/`, `ap2/`, `mpp/`. Standard layout is `atrib/packages/<protocol>/` for SDK code and `atrib/services/<protocol>-scanner/` for ecosystem scanner services.

3. **Scope of adapter vs spec**. A protocol adapter does NOT modify atrib's spec. The spec remains protocol-agnostic. Adapters are implementations of the spec's primitives against protocol-specific data. This preserves [§3.6](atrib-spec.md#36-implementation-notes)'s fact/policy separation: protocol-specific attribution lives in the `attribution/` layer, never in the `registry/` or `scanner/`.

4. **Two demonstration paths.** For a protocol adapter to demonstrate the full spec end-to-end, it needs both:
   - **Path A (retrospective):** scanner + registry + attribution. Demonstrates [§3](atrib-spec.md#3-graph-query-interface) (graph) and [§4](atrib-spec.md#4-attribution-policy-format) (attribution calculation) applied to ecosystem-level data. Does NOT demonstrate [§1](atrib-spec.md#1-attribution-record-format) (signed records) or [§5](atrib-spec.md#5-sdk-specification) (SDK contract) because it observes, it doesn't transact.
   - **Path B (runtime reference agent):** a reference agent that makes real payments with `@atrib/agent` instrumented, signing records into a running atrib log, with merchant-side verification via `@atrib/verify`. Demonstrates [§1](atrib-spec.md#1-attribution-record-format), [§2.6.1](atrib-spec.md#261-submit-entry) submission, [§5](atrib-spec.md#5-sdk-specification) SDK contract, and the verify flow.

   A complete protocol adapter artifact includes both paths. Path A alone is a dataset; Path B alone is a demo; together they prove the spec works end-to-end for that protocol.

**Rejected alternatives:**

1. _Bake protocol-specific scanning into `@atrib/agent`._ Rejected because runtime detection and retrospective scanning have different access patterns (hot path vs bulk analytical), different dependencies (host framework vs blockchain indexer), and different failure modes (pass-through on error vs partial-result on error). Coupling them would blur [D008](#d008-middleware-pattern-not-method-calls) (middleware pattern: zero ongoing surface area) and mix the detection-latency budget with ecosystem-scan latency.

2. _One universal scanner with protocol plugins._ Rejected because each protocol has a different settlement surface (EIP-3009 + Permit2 for x402, mandate-passing for AP2, payment-token flows for Stripe ACP) and different on-chain/off-chain observability properties. A universal scanner abstraction would either compromise to the lowest common denominator or become a pass-through with nothing shared, per [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)'s source-read-first principle.

3. _Move scanner data into the spec as a new section._ Rejected because the spec stays protocol-agnostic ([§3.6](atrib-spec.md#36-implementation-notes), [§4.1](atrib-spec.md#41-purpose-and-position-in-the-protocol)). The protocol-specific attribution rationale lives in the adapter's documentation, not the spec body. The spec only says "graph + policy → distribution"; how the graph is populated for a specific protocol is an adapter concern.

**What this DOESN'T solve:**

- Integration of scanned observations back into atrib's Merkle log. Today the log is fed by runtime-signed records. A scan could optionally emit observer-signed records into the log for tamper-evidence of the dataset, but that's a separate decision (future ADR if/when we implement it).
- A formal conformance corpus for adapter outputs (analogous to the [§2.6.1](atrib-spec.md#261-submit-entry) corpus in [D026](#d026-spec-261-conformance-corpus-at-specconformance261-shared-between-ts-dev-log-and-future-go-log)). Premature until the second protocol adapter ships and we have two data points to shape the corpus against.
- Unified cross-adapter attribution calculation. Each adapter computes its own distribution against its own policy. A multi-protocol attribution (e.g., a session that spans x402 + ACP) is future work, tied to [§3](atrib-spec.md#3-graph-query-interface)'s graph derivation extending across adapters.

**First implementation:** the x402 adapter (2026-04-21). Registry (45 facilitators resolved, 92 attributed addresses, `/supported` enrichment), scanner (Dune contract-first query producing $5.4M Base 30d), attribution (baseline mapping + unknown-sender residual). Path A (retrospective surface) exercises [§3](atrib-spec.md#3-graph-query-interface) + [§4](atrib-spec.md#4-attribution-policy-format); Path B (runtime reference agent using `@atrib/agent`) provides the second observation surface, exercising [§1](atrib-spec.md#1-attribution-record-format), [§2.6.1](atrib-spec.md#261-submit-entry), [§5](atrib-spec.md#5-sdk-specification).

---

## D028: Log exposes its signing pubkey at `GET /v1/pubkey` for self-contained verification

**Date:** 2026-04-27
**Status:** Accepted; deployed to `log.atrib.dev` (image `01KQ6KWYDAC4ZNA6A6BY3BC0ZK`)

**Context.** A C2SP signed-note checkpoint commits the log to a (size, root) pair under an Ed25519 signature. To verify the signature, a third party needs the log's public key. Before this decision the only way to acquire that key was out-of-band, the operator had to publish it via a website, a known directory, or person-to-person. The signed-note signature line carries a 4-byte key_id (SHA-256(origin‖0x0A‖0x01‖pubkey)[:4]) but that's a one-way commitment, not a key.

This was discovered while building a reproducible end-to-end verifier (the `verify-loop.mjs` script that ships in this repo): the verifier could prove tree integrity (locally re-derived root == checkpoint root) but had to SKIP the checkpoint-signature gate because no key was reachable.

**Decision.** Add a single endpoint to log-node:

```
GET /v1/pubkey
→ 200 application/json
{
  "origin": "log.atrib.dev/v1",
  "public_key": "<base64url 32B>",
  "key_id": "<hex 4B>",
  "algorithm": "Ed25519"
}
```

The endpoint reads from the `CheckpointSigner` interface at runtime (no separate config); the seed never leaves the process. The `CheckpointSigner` interface gained an `origin` accessor so the handler doesn't need to import a constant from another file.

A test verifies that the published `key_id` exactly matches the prefix in the live checkpoint signature line, AND that running `ed.verifyAsync(sig, body, public_key)` against the published pubkey succeeds, meaning the endpoint is cryptographically active and not just a status surface.

**Alternatives considered.**

1. _Publish the pubkey to a static `.well-known` file._ Rejected because it requires a second hosting surface and decouples the published key from the running signer. With `/v1/pubkey` reading from the live signer, the pubkey can never drift out of sync with the actual signature being produced.

2. _Embed the pubkey in every checkpoint body_ (e.g. as a 4th line). Rejected because it changes the wire format of `/v1/checkpoint`, a breaking change to a published spec section ([§2.4.1](atrib-spec.md#241-body-structure)) for a problem that's solved cleanly with an additive endpoint.

3. _Require verifiers to derive the pubkey from the seed via a separate "trust root" service._ Rejected because it introduces a second trust dependency for what is fundamentally one log's accountability surface.

**Consequences.**

- Verifiers (third parties + dogfood scripts) can now run `Ed25519.verify(sig, body, pubkey)` against the checkpoint without out-of-band key acquisition. This closes the previously-named "GAP 1" in the dogfood verification loop.
- The endpoint adds zero attack surface: the public key is by design exposable; exposing it is what makes the checkpoint signature meaningful to anyone other than the operator.
- A future witnessing protocol (multiple signatures on one checkpoint) gets a per-witness `/v1/pubkey` analog for free, since the shape generalizes (each signer publishes its own).

**What this DOESN'T solve.** Key rotation. If the log's signing key changes, `/v1/pubkey` returns the new key, and historical checkpoints signed under the old key become unverifiable from this endpoint alone. A future ADR will specify either (a) a rotation log of `(key_id, public_key)` pairs returned by `/v1/pubkey`, or (b) a separate `/v1/keys` endpoint listing all keys ever used. Out of scope for V1.

---

## D029: `AtribOptions.onRecord(record)` observer hook on the middleware

**Date:** 2026-04-27
**Status:** Accepted; shipped in `@atrib/mcp` middleware

**Context.** The atrib log stores commitments only, `record_hash`, `creator_key`, `context_id`, `timestamp`, `event_type`, not the original signed record JSON. This is intentional ([§3.6](atrib-spec.md#36-implementation-notes) fact/policy separation; the log is observability, not storage). But it leaves a verification gap: third parties have no way to prove "this record_hash is the hash of a record signed by that creator_key" without the original record bytes. The bytes exist transiently inside the middleware between sign and submit; once the submit returns, they're gone.

A reproducible end-to-end verifier hits this gap directly: the gate that replays the record's Ed25519 signature against `creator_key` cannot run without access to the original signed record bytes. Without retention, that verification path is unreachable.

**Decision.** Add an optional observer to `AtribOptions`:

```ts
interface AtribOptions {
  // ... existing fields ...
  /**
   * Observer invoked once per signed record AFTER signing and BEFORE log
   * submission. Lets the host persist or audit the record locally.
   * Errors thrown from the observer are caught and logged; they do not
   * block submission or affect the tool response ([§5.8](atrib-spec.md#58-degradation-contract)).
   */
  onRecord?: (record: AtribRecord) => void | Promise<void>
}
```

The hook is fired post-sign (so the `signature` field is present), pre-submit (so persistence happens before any network attempt), and wrapped in try/catch with promise-rejection capture. The [§5.8](atrib-spec.md#58-degradation-contract) degradation contract is preserved: a `onRecord` observer that throws or rejects does not block the tool call, the attribution token in `_meta`, or the log submission.

The first consumer is an MCP wrapper service that uses `onRecord` to append records as one JSON per line at a local jsonl mirror under `~/.atrib/records/`.

**Alternatives considered.**

1. _Return signed records from a side-channel API like `getRecord(hash)`._ Rejected because it requires the middleware to retain records in memory indefinitely (memory leak in long-running processes) or expose a query endpoint (new attack surface, new failure mode).

2. _Make the wrapper sign records itself instead of going through the middleware._ Rejected because it duplicates [§1.4](atrib-spec.md#14-signing-and-verification) signing logic outside `@atrib/mcp` (drift risk: future signing-format changes would have to land in N places). Keep one signer, expose one observer.

3. _Add a "tee" mode where the middleware writes records to a file path passed via `AtribOptions`._ Rejected because file paths are a host concern (sandboxing, permissions, log rotation, format) and embedding them in `@atrib/mcp` couples the protocol middleware to filesystem semantics. The hook lets each host decide how to persist.

4. _Make persistence on-by-default with a sensible path._ Rejected because most consumers of `@atrib/mcp` are server-side or browser-side and have no business writing to a default filesystem location. Opt-in via callback is the right default.

**Consequences.**

- The dogfood verifier's GATE F (`record.sig` Ed25519 replay) becomes runnable once any consumer wires `onRecord` to disk. This closes the previously-named "GAP 2".
- Other consumers (e.g. `@atrib/agent` framework adapters) can use the same hook for their own observability needs, auditing, metrics, replay debugging, without anything specific to the dogfood case being baked in.
- Two new tests in `packages/mcp/test/middleware.test.ts`: (a) records are observed post-sign with the right shape, (b) observer throws don't break tool calls (the [§5.8](atrib-spec.md#58-degradation-contract) invariant). All 328 mcp tests continue to pass.

**What this DOESN'T solve.**

- A canonical persistence format. The wrapper writes JSON-per-line; an SDK consumer might write protobuf, ndjson with extra metadata, etc. There's no spec section for "the local audit log format" because that's a host concern.
- Replay protection. If a consumer's `onRecord` is slow or async-unbounded, records can pile up faster than they're persisted. The wrapper today writes synchronously per call, which is fine for a per-tool-call cadence but would need rethinking for high-throughput agent stacks. Out of scope for this ADR.

---

## D030: Log key publication serves both C2SP vkey and JSON, at distinct endpoints

**Date:** 2026-04-27
**Status:** Accepted; deployed alongside [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification)

**Context.** [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) shipped `GET /v1/pubkey` returning JSON `{origin, public_key, key_id, algorithm}` to close the dogfood verifier's checkpoint-signature gap. During the post-[D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) spec sync (atrib-spec.md [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id)), an existing spec line surfaced that the [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) ADR had not acknowledged:

> "The verifier key string published at `log.atrib.dev/v1/log-pubkey` encodes the key name, key ID, and public key in the C2SP vkey format"

So the spec already committed the log to publishing its key, but at a different path (`/v1/log-pubkey`) and in a different format (a single C2SP vkey string, `<origin>+<hex(keyid)>+<base64(0x01||pubkey)>`, served as `text/plain`). The [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) implementation diverged from this without amending the spec. The two formats serve different audiences:

- The C2SP vkey form is parsed directly by `golang.org/x/mod/sumdb/note.NewVerifier`, sigsum, tlog-witness, and other tlog ecosystem tooling. These tools expect a key string they can read from a file or URL and pass to a verifier constructor.
- The JSON form is friendlier for hand-rolled verifiers (browser-based verify scripts, end-to-end verification harnesses, future graph-side audit code) that benefit from structured access.

**Decision.** Keep both endpoints, both serving the same key:

- `GET /v1/log-pubkey` returns the C2SP vkey string as `text/plain; charset=utf-8`, per the existing spec line.
- `GET /v1/pubkey` returns JSON as defined by [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification).

Both MUST be backed by the same `CheckpointSigner` (same key bytes, same `key_id`, same `origin`). A new test verifies that the vkey-extracted public key bytes equal the bytes returned by the JSON endpoint, and that the vkey-extracted key actually verifies a real `/v1/checkpoint` signature. A new helper `formatVkey(origin, keyId, publicKey)` lives next to `formatCheckpointBody` in `services/log-node/src/checkpoint.ts`; both produce C2SP-formatted artifacts so they cohabit.

The spec was updated in [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id) to document both endpoints, with normative MUSTs that they agree on `origin`, `key_id`, and the underlying public key, and that the published `key_id` equal the 4-byte hex prefix on every `/v1/checkpoint` signature line.

**Alternatives considered.**

1. _Rename `/v1/pubkey` to `/v1/log-pubkey` and switch its response to vkey text format (impl follows spec)._ Rejected because the deployed JSON endpoint already has at least one consumer (the dogfood verifier) and changing both path and content type is observable. More importantly, the JSON form is genuinely useful for consumers that don't speak C2SP, converting it to vkey-only would force every such consumer to write a custom parser.

2. _Update [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id) to drop the C2SP vkey reference and document JSON-only at `/v1/pubkey` (spec follows impl)._ Rejected because dropping vkey breaks compatibility with existing C2SP-conformant tooling. Witness software, sumdb/note verifiers, and any future cosignature work expect to point at a URL and parse the response as a vkey string. JSON-only forces adapters everywhere.

3. _Single hybrid endpoint at `/v1/pubkey` returning JSON that includes the vkey as a string field._ Rejected because tools like `note.NewVerifier` expect to fetch a vkey directly, not extract one from JSON. Even if such a tool's plumbing could be wrapped to do the extraction, the friction is exactly the kind of "everyone has to write a custom adapter" that C2SP was designed to avoid. The two endpoints cost ~30 lines of code and each serves a real consumer, so the duplication is cheap.

**Consequences.**

- Adds a `formatVkey` helper and a `handleLogPubkey` handler. ~30 lines of code, four new tests covering format correctness and end-to-end signature verification under the vkey-extracted key.
- The dogfood verifier ([D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) / [D029](#d029-atriboptionsonrecordrecord-observer-hook-on-the-middleware) motivation) will exercise both endpoints to confirm they agree on the key bytes, a small additional gate that catches any future drift between the two surfaces.
- Future witness/cosignature work (planned for V2) gets the canonical vkey URL it needs without any new spec writing; the path was already committed in [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id).

**What this DOESN'T solve.**

- Key rotation, still. [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) explicitly punted that to a future ADR; this resolution doesn't change that. When rotation is implemented, both endpoints will need to grow a versioned representation (likely an array of `{key_id, public_key, valid_from, valid_to}` for `/v1/pubkey` and a multi-line vkey list for `/v1/log-pubkey`). Out of scope.
- Witness key publication. If/when third parties cosign checkpoints, each witness will publish its own vkey from its own service. The atrib spec describes the format the log uses; witness operators apply the same shape to their own infrastructure.

**Acknowledged process failure.** [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) was drafted and shipped without grepping the spec for an existing key-publication contract. The [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id) line was always there. A spec-sync pass should be part of "the ADR is done" rather than an after-the-fact cleanup. Documented here so the lesson is preserved for future ADR work.

---

## D031: Reconcile [§2.4.3](atrib-spec.md#243-signed-note-format) signed-note divergence from C2SP

**Date:** 2026-04-27
**Status:** Accepted; implemented in commit `096c8a5`

**Context.**

atrib spec [§2.4.3](atrib-spec.md#243-signed-note-format) opens with:

> "The complete checkpoint (body plus signatures) is a signed note per the C2SP signed-note specification (c2sp.org/signed-note)."

The paragraph that followed then documented the signature line format as:

```
— log.atrib.dev/v1 a3b2c1d0+base64(Ed25519-signature-over-body)
```

where `a3b2c1d0` is the lowercase hex-encoded 4-byte key ID and the base64 token is the 64-byte Ed25519 signature alone, separated from the key ID by a literal `+`. The spec body, in other words, documented a format that differs from C2SP while the spec preamble claimed C2SP conformance. These two statements could not both be true.

The C2SP signed-note specification and its Go reference implementation (`golang.org/x/mod/sumdb/note`) define the signature token as a single base64-encoded 68-byte blob: the 4-byte key hash concatenated with the 64-byte signature. No delimiter. Passing atrib's `hexKeyId+base64Sig` token to `note.NewVerifier` failed; the parser expects one undelimited base64 token, not two fields joined by `+`.

The live log at `log.atrib.dev` produced atrib's format. An example from the dogfood log:

```
— log.atrib.dev/v1 e5ac1d6d+KK3JiYceLG6YOjyt7DiDGopQ7Kqwes+lAKZztX2OzhC3oeIsSZP2XHjMRjFqtoE8/UUeTV9DZ34nnj4LgUMZBA==
```

The divergence was discovered while dogfooding `services/log-node/scripts/verify-loop.mjs`. The verifier's original parser assumed C2SP and got the keyId wrong because it was treating hex chars as base64.

**Options.**

**Option A, Align implementation with C2SP (proposed and adopted).**

Change `createCheckpointSigner.sign` in `checkpoint.ts` to produce the C2SP encoding: concatenate the 4-byte key ID and 64-byte signature, base64-encode the resulting 68-byte blob, omit the `+` delimiter. Update spec [§2.4.3](atrib-spec.md#243-signed-note-format) to replace the hex+base64 description with the correct C2SP encoding. Update the `parseCheckpoint` function in `verify-loop.mjs` to decode the token as one base64 string and split at byte offset 4.

Consequences:

- `note.NewVerifier` and every C2SP-conformant tool (tlog-witness, sigsum, cosign tooling) parses atrib checkpoints without adapters.
- The witness/cosignature work in [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) uses standard C2SP tooling with no custom parsers. C2SP conformance for signed notes is a prerequisite for [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) implementation; this resolves that blocker.
- The production log requires a redeploy. Any consumer that parses the current signature format must update its parser.
- Existing tests that assert the old format string require one-time updates.

**Option B, Amend spec to own the divergence.**

Remove the "per the C2SP signed-note specification" claim from [§2.4.3](atrib-spec.md#243-signed-note-format). Replace it with an explicit definition of atrib's hex+base64 form as the protocol's own checkpoint signature format. No code change.

Consequences:

- No operational risk.
- atrib checkpoint signatures cannot be parsed by `note.NewVerifier` or any C2SP-conformant tool without a custom adapter. Every integrator who expected C2SP tooling to work needs that adapter explained.
- Witness/cosignature work ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures)) requires custom parsers in every participant's toolchain. Ongoing cost, not one-time transition.
- The C2SP tlog-tiles ecosystem claim in CLAUDE.md becomes inaccurate for the "signed notes" and "witnessing" clauses.

**Option C, Serve both formats.**

Keep the current hex+base64 line and add a second, C2SP-encoded line on the same checkpoint, or serve a parallel `/v1/checkpoint.c2sp` endpoint.

Consequences:

- Two signature lines from the same signer on the same checkpoint body is unusual in the tlog ecosystem. Witnesses and cosigners add additional lines; the primary signer does not normally sign twice. Verifiers that enforce "exactly one log signature" would reject the checkpoint.
- Unlike [D030](#d030-log-key-publication-serves-both-c2sp-vkey-and-json-at-distinct-endpoints)'s dual key publication (two read-only representations of the same 32 bytes, each around 15 lines of code), two checkpoint signature formats require separate parse paths in every verifier indefinitely.
- The `+` delimiter in the current format is a parsing ambiguity: base64 standard uses `+` as a base-64 alphabet character. Option C preserves that fragility.

**Decision.**

Option A: align the implementation with C2SP.

The dogfood log at `log.atrib.dev` is in an early phase. The only documented consumer of the checkpoint signature line is `verify-loop.mjs`, and its parser was written to match what the implementation produced rather than what C2SP specifies. Updating that parser was a one-line regex change. No outside tooling is known to have parsed the current format.

The benefit is concrete and durable: every C2SP-conformant verifier, witness client, and cosignature tool works against atrib checkpoints without an adapter. [D030](#d030-log-key-publication-serves-both-c2sp-vkey-and-json-at-distinct-endpoints) kept both key-publication endpoints because two audiences genuinely needed two formats. There is no analogous argument here: C2SP is the right one for ecosystem reasons, and the current format existed only because the implementation was written before the spec claim was checked against the reference implementation.

**Implementation (commit `096c8a5`).**

Three files changed:

1. `services/log-node/src/checkpoint.ts` `sign()`: concatenate `keyId[4B] || sigBytes[64B]`, base64-encode the 68-byte blob, remove the `+` delimiter. A new `parseSignatureLine` helper was added in the same file and exported from `services/log-node/src/index.ts` for use by tests and verifiers.

2. `atrib-spec.md` [§2.4.3](atrib-spec.md#243-signed-note-format) replaced the hex+base64 description with the canonical C2SP encoding. [§2.4.2](atrib-spec.md#242-log-signing-key-and-key-id) cross-reference updated from "4-byte hex prefix" to "4 leading bytes of the base64-decoded signature token."

3. `services/log-node/scripts/verify-loop.mjs` `parseCheckpoint` updated to use the C2SP encoding. Six test files (`checkpoint.test.ts`, `checkpoint-format.test.ts`, `verification.test.ts`, `proof-verification.test.ts`, `server.test.ts`, plus the existing tree tests) migrated to `parseSignatureLine`. 83/83 log-node tests pass under the new format.

The deployed log at `log.atrib.dev` was redeployed at 2026-04-27 ~04:00 UTC with the new format. Verified live: `cp.sig.vkey PASS` and 13/13 dogfood verifier gates pass against the persisted tree.

**What this DOESN'T solve.**

- The 4-byte key hash is a truncated SHA-256 prefix. Collision resistance at 4 bytes is weak; atrib follows the C2SP convention rather than widening it. The tlog ecosystem has not moved to longer key identifiers; a future ADR can address this if it does.
- Key rotation. Unresolved since [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification).
- Witnessing implementation ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures)). C2SP conformance here is a prerequisite. [D032](#d032-witnessing-posture-for-v1-spec-defined-no-implementation) captures the [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) design decisions but does not ship code.

**Acknowledged process failure.**

The divergence was present from the initial commit of `checkpoint.ts`. A round-trip interop test that signs a checkpoint body with the local key and then verifies it with `golang.org/x/mod/sumdb/note.NewVerifier` would have caught the format mismatch before the first deployment. The `verify-loop.mjs` parser was written to match what the implementation produced, so it did not surface the issue during [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) or [D029](#d029-atriboptionsonrecordrecord-observer-hook-on-the-middleware) development. Adding such an interop test to `services/log-node/test/` is a follow-on; it would catch any future regression.

---

## D032: Witnessing posture for V1, spec defined, no implementation

**Date:** 2026-04-27
**Status:** Accepted; spec [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) rewritten, no code work for V1

**Context.** Spec [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) was a stub with conflicting prose: it gestured at C2SP tlog-witness, mentioned a SHOULD-require threshold, and described an operator-pushes-to-witnesses delivery model. Three of those choices contradicted invariants stated elsewhere in the spec or in CLAUDE.md. With the C2SP signed-note alignment in [D031](#d031-reconcile-243-signed-note-divergence-from-c2sp) finally landed (commit `096c8a5`), witnessing became approachable rather than aspirational, but it also became the next thing where contradictions would compound. Resolving [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) needed concrete answers on five questions before any code could land.

**Decision.** Five concrete choices, captured normatively where format interop demands it and informationally where verifier policy varies:

1. **Threat model:** four threats, witnesses partially mitigate each. Operator dishonesty (split-view), operator key compromise, infrastructure compromise (DNS/TLS/host hijacking), and compelled removal. Threat 3 is mitigated only when witnesses run on infrastructure independent from the operator's; the spec calls this out explicitly so a reader doesn't run all witnesses on Fly and think they've covered the threat model.

2. **Cosignature delivery:** witness-published, not operator-aggregated. Each witness exposes `GET /v1/cosig/<log_origin>/<root_hash>`. Verifiers fetch directly from witnesses and concatenate cosigs into the operator's signed checkpoint. This pattern (matching Sigsum) is the only one that survives operator key compromise: a compromised operator cannot suppress cosigs that live on independent witness infrastructure.

3. **Threshold:** verifier's choice. The protocol does not mandate a minimum cosignature count. Per CLAUDE.md invariant 7 ("the protocol has no thumb on the scale"), verifier policy is verifier-local. A verifier with no witness keys configured trusts the operator's signature alone, which is the V1 default.

4. **Witness registry:** out of scope for V1. No coordination protocol, no reputation system, no first-party-published list. Verifiers configure trusted witness vkeys out of band the same way they configure the trusted log vkey. A future revision MAY add an open registry analogous to Sigsum, but only after atrib has non-operator verifiers to consult on what shape that registry should take.

5. **Cosignature format:** C2SP tlog-cosignature. Same outer line shape as the operator signature but the base64 token decodes to 76 bytes (4-byte keyHash + 8-byte timestamp + 64-byte sig) rather than 68. Witnesses sign over a cosignature signing input that prepends `cosignature/v1\n<seconds>\n\n` to the checkpoint body. Verifiers MUST distinguish operator from witness signature lines by decoded length.

**Alternatives considered.**

1. _Mandate a minimum threshold in the spec._ Rejected because it violates the no-thumb-on-the-scale invariant. Different consumers (a hobbyist project, a payments protocol, a regulator) genuinely need different thresholds; the protocol shouldn't pre-pick.

2. _Operator-aggregated cosignature delivery (Sigstore Rekor pattern)._ Rejected because it does not survive threat 2. A compromised operator with the operator's signing key can hide unfavorable cosigs from `/v1/checkpoint` and present a forged checkpoint as uncosigned-but-genuine. Witness-published delivery moves the cosignature path off the operator entirely.

3. _Define a witness registry now._ Rejected because we have no witnesses and no non-operator verifiers. Different ecosystems pick different registry shapes (Sigsum: open; Sigstore: curated; sumdb: directory). Locking in one before knowing the first witness operator's actual needs would be a wrong abstraction.

4. _Implement a first-party witness service for log.atrib.dev._ Rejected because a witness operated by the same party as the log is structurally useless against threats 1, 2, and 3. Self-witnessing only matters once there is a second atrib log to cross-witness or a non-operator party with an incentive to witness. Neither exists today.

**Consequences.**

- [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) is now complete: normative format and delivery, informational verifier behavior, explicit V1 scope boundary on registry/discovery.
- A future witness operator can implement against the spec without further atrib coordination. The core code (fetch checkpoint, verify operator sig, verify consistency proof, sign cosig input, publish at `/v1/cosig/...`) parallels what `services/log-node/` already does and is ~200 lines of Node.
- The dogfood verifier does NOT yet check cosignatures. When a witness exists, adding the gate is mechanical: signature lines whose decoded payload is 76 bytes are cosigs; look up witness keyHash → trusted vkey; verify per [§2.9.2](atrib-spec.md#292-cosignature-format-normative); apply threshold.
- The Sigsum-pattern choice means atrib will not drop-in to ecosystems that assume operator-aggregated delivery (Rekor). The trade-off is honest: those ecosystems implicitly accept threat 2 in exchange for simpler verifier configuration. atrib chooses the harder configuration in exchange for surviving operator compromise.

**What this DOESN'T solve.**

- _Witness bootstrapping._ The first witness will exist when atrib has a second-party verifier that wants one. The spec describes the contract; the spec does not solve the social problem of recruiting witnesses.
- _Witness staleness and liveness._ A verifier checking cosig timestamps can detect an obviously dead witness, but a witness that goes dark for months is harder. V2 may add liveness expectations.
- _Witness key rotation._ Same gap as the log key rotation deferred from [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification). Witnesses will need rotation when atrib does.
- _Cosignature retention windows._ How long must a witness keep its cosigs queryable? Verifiers may want historical cosigs to verify old settlement documents. V2.

**Acknowledged process failure.** The prior [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) prose contradicted three of the five decisions documented here. SHOULD-require-cosignature contradicted invariant 7; operator-pushes-to-witnesses contradicted threat-2 mitigation; the gestured-at "witnessing infrastructure used by log.atrib.dev" implied a registry that doesn't exist. These were aspirational drift, not deliberate choices. Same failure mode as [D030](#d030-log-key-publication-serves-both-c2sp-vkey-and-json-at-distinct-endpoints)'s note: spec text added without checking conflicts with the rest of the spec or with CLAUDE.md invariants. Recording the pattern again so the lesson is concrete, not theoretical.

---

## D033: Key rotation and revocation

**Date:** 2026-04-27
**Status:** Accepted; spec [§1.9](atrib-spec.md#19-key-rotation-and-revocation) drafted, implementation deferred to an upcoming implementation phase

**Context.** [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification) explicitly deferred key rotation. The initial creator key was found to be present in Claude Code conversation transcripts (transcripts have 600 perms but a copied key is permanently usable). The key material was rotated, but the protocol currently lacks revocation mechanics: records signed by the prior key remain verifiable without any indication to verifiers that the key is retired.

A second motivation: scheduled 90-day rotation is not viable today. If a creator wanted to rotate, every existing record would still verify under the old pubkey but with no way to prove the rotation was authorized rather than a key-loss event.

**Decision.** Key rotation is implemented via a new spec [§1.9](atrib-spec.md#19-key-rotation-and-revocation) with three normative pieces.

1. **Revocation record format.** A new `event_type: 'key_revocation'` record. Fields:
   - All existing record fields (`spec_version`, `event_type='key_revocation'`, `timestamp`, `context_id`, `creator_key`, `chain_root`, `content_id`, `signature`).
   - `revoked_key`: the base64url-encoded 32-byte public key being retired.
   - `revocation_reason`: enum `'compromise' | 'rotation' | 'retirement'`.
   - `successor_key`: optional, base64url-encoded 32-byte public key of the rotation target. Present only when `revocation_reason='rotation'`. The semantics: signed records produced by `successor_key` MAY be considered as continuing the trust scope of `revoked_key` for the purposes of the directory ([D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)).

   The revocation MUST be signed by `revoked_key` itself when `revocation_reason='rotation'` or `'retirement'`. When `revocation_reason='compromise'`, the revocation MAY instead be signed by a designated emergency key registered in the directory (see [D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)). This is the only case where a revocation can be signed by something other than the key being retired, because compromise means the legitimate owner may not have access to the key anymore.

2. **Verifier semantics.** When a verifier sees a revocation record at log index `R`:
   - All records with `creator_key === revoked_key` AND `log_index >= R` are treated as `verification_state: 'revoked_after_revocation'`. They no longer count toward attribution calculations.
   - All records with `creator_key === revoked_key` AND `log_index < R` retain their original `verification_state`. Past attribution remains valid up to the moment of revocation. This is essential. Otherwise revocation becomes a destructive operation that erases history.
   - When `successor_key` is present, the directory ([D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) updates the identity claim's active key to `successor_key`. Records signed by the successor inherit the revoked key's identity.

3. **Discovery.** Revocations are discovered the same way records are: by reading the log. A verifier MUST scan for `event_type: 'key_revocation'` records when validating any record signed by `creator_key === revoked_key`. The directory ([D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) MAY index this for efficiency but the log itself is the source of truth.

**Alternatives considered.**

1. _External CRL (certificate revocation list) maintained by the operator._ Rejected because it puts the operator in the trust path of revocation. A compromised operator could refuse to publish a creator's revocation. Putting revocation in the log inherits the log's tamper-evidence properties.

2. _Bound time-windows on creator keys (90-day expiry)._ Rejected as overly prescriptive. Different creators have different operational realities. A managed-service creator may rotate weekly; a hobbyist may go years. The protocol should not impose a global rotation schedule. Operators can adopt one as policy without needing protocol enforcement.

3. _Treat all post-revocation records as silently invalid (drop verification_state to `'unsigned'`)._ Rejected because it loses information. Distinguishing `'revoked_after_revocation'` from `'unsigned'` lets a verifier or auditor see that the record was technically signed correctly but post-revocation, which is meaningfully different from an unsigned record (no signature ever existed).

4. _Allow revocation by any party who can produce the public key._ Rejected because it creates a denial-of-service vector: anyone could revoke any creator's key. Requiring the revocation to be signed by the key being retired (or by an emergency key the creator registered up-front) prevents this.

5. _Mandate `successor_key` always._ Rejected because some revocations are terminal (creator going out of business, project deprecated). Forcing `successor_key` would force ceremonial bridging.

**Consequences.**

- Spec gains [§1.9](atrib-spec.md#19-key-rotation-and-revocation) with the format and semantics. Conformance corpus at `spec/conformance/1.9/` covers: valid rotation, valid retirement, valid compromise (signed by emergency key), invalid revocation signed by wrong key, post-revocation record correctly flagged.
- `@atrib/verify` and `services/graph-node` gain logic to detect and apply revocation records during graph construction. `verification_state` enum extends with `'revoked_after_revocation'`.
- `@atrib/cli` gains `atrib revoke --keychain --reason ROTATION --successor PUBKEY` for operator-driven rotation.
- `services/log-node` does not need changes: revocation records flow through the same submission path as any other record.
- Directory ([D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) consults revocations to update the active key for an identity claim.

**What this DOESN'T solve.**

- _Past records signed by a key compromised but used legitimately._ If a key was compromised on day 100 but used legitimately on days 0-99 and maliciously on days 100-150 before the revocation lands, days 100-150 still verify under the original key with no signal of compromise. The verifier sees `'revoked_after_revocation'` only post-150. A "compromise window" annotation is V2 work.
- _Forward-secret rotation._ Successor key inherits identity but the attacker who has the old key can still produce records that look legitimate under the old pubkey for the pre-revocation window. True forward secrecy would require a key-evolution scheme (e.g., HORS, hash chains). Out of scope.
- _Operator key rotation._ The log's signing key has the same problem as creator keys, plus an additional one: rotating the log key invalidates every prior inclusion proof's signature. Log-key rotation is its own ADR (deferred to V2).

**Implementation sequencing.** an upcoming implementation phase implements revocation + the directory together because they share data structures and verifier logic.

---

## D034: Public-key directory architecture (AKD unblinded; VRF-blinded mode available for downstream consumers)

**Date:** 2026-04-27
**Status:** Accepted; spec [§6](atrib-spec.md#6-key-directory) drafted, implementation in an upcoming implementation phase

**Context.** atrib records carry `creator_key` as opaque base64url bytes. A verifier seeing such a record has no way to learn "who is this?" There is no canonical mapping from `creator_key` to identity. An audit pass identified this as the most consequential infrastructure gap: without a directory, attribution is purely cryptographic and not semantically meaningful to anyone except the original signer.

A neighbouring class of use cases has the same problem at a higher privacy bar: any directory whose `label → value` lookup is itself sensitive (for example, end-to-end-encrypted messaging where asking "what's user X's key?" would leak interest in user X to the directory operator).

The two problem shapes share the same primitive (a verifiable, append-only, per-label-history-chained directory) but differ on privacy. After surveying the landscape, Meta's open-source `akd` (Auditable Key Directory) Rust crate implements the right abstraction: it supports both unblinded labels (cheap public lookups) and VRF-blinded labels (privacy-preserving lookups) under a single data structure. atrib needs unblinded; downstream consumers in the privacy-sensitive class need VRF-blinded; both can share the same library.

A decision was needed on three questions: (1) AKD vs roll-our-own simpler structure, (2) unblinded-only for atrib vs flag-configurable, (3) where the directory's data is hosted relative to the existing Tessera log.

**Decision.**

1. **AKD as the underlying primitive.** A plain append-only Merkle log misses 17 of the 20 properties a production-trustworthy directory needs (efficient label-indexed lookup, non-membership proofs, authenticated latest-version proofs, per-label append-only semantics, operator-independent verification, plus VRF blinding when the consumer requires privacy-preserving lookup). The "roll a simple version on the existing log" path was undersold; for atrib's actual needs (verifier resolves `creator_key` to identity claim cheaply, with cryptographic guarantees against operator forgery), AKD is the correct primitive. atrib uses AKD with unblinded labels. Downstream consumers requiring privacy-preserving lookup use AKD with VRF-blinded labels via the same library.

2. **Hosted as a sibling service** (`services/directory-node/` in the atrib repo). The directory is its own append-only structure, separate from the Tessera log. Its checkpoints are signed by an independent key (not the log key) and witnessed independently. Periodically, the directory's root commitment is posted to the Tessera log as a `directory_anchor` record so a verifier consulting the log can detect a forked directory.

3. **Identity claim format** (atrib mode):

   ```
   {
     "spec_version": "atrib/1.0",
     "claim_type": "creator_identity",
     "creator_key": "<base64url 32-byte ed25519 pubkey>",
     "claim": {
       "subject": "<freeform identity, e.g. 'tools.openai.com', 'did:web:example.com', 'mailto:nader@atrib.dev'>",
       "method": "self_attested" | "domain_verified" | "did_resolved",
       "registered_at": <unix-ms>,
       "expires_at": <unix-ms> | null,
       "metadata": { ... }   // freeform extension
     }
   }
   ```

   The claim is signed by `creator_key` itself (self-attestation). Optional verification methods (`domain_verified`, `did_resolved`) extend the trust model. A domain-verified claim includes a TXT-record proof that the domain owner endorses the claim. The protocol does not enforce verification; verifiers consume the claim and apply their own policy.

4. **VRF-blinded adapter (downstream).** Consumers with privacy requirements wrap the same AKD library but bind labels via VRF so the directory operator cannot enumerate keys or observe lookups. The blinded mode's specifics (label binding, VRF key management) live in the consuming spec rather than the atrib spec, since atrib does not deploy this mode.

5. **Consultation contract for verifiers.** A verifier seeing a record `R` with `creator_key = K` and timestamp `T`:
   - Looks up `K` in the directory at version `<= T` (most-recent claim active at the record's timestamp).
   - Combines with [§1.9](atrib-spec.md#19-key-rotation-and-revocation) revocation: if `K` was revoked at log index `R'` and the record is at log index `>= R'`, the claim no longer applies (record is `'revoked_after_revocation'`).
   - Returns `identity_resolved: ClaimObject | null` alongside the record.

**Alternatives considered.**

1. _Roll an append-only registry on the existing Tessera log._ Rejected after the 80/20 analysis: the missing 20% (efficient lookup, non-membership proofs, latest-version proofs, per-label append-only semantics, operator-independent index correctness) is exactly the trustworthy-directory part. AKD provides all of these. Rolling our own would be partial and would need to be replaced anyway.

2. _Build a custom directory protocol._ Rejected because AKD is mature, audited, and reused by Meta in production for WhatsApp key transparency. Reinventing it is unjustified scope.

3. _atrib uses unblinded forever; downstream privacy-preserving consumers fork to a different library._ Rejected because the two configurations share a substantive amount of operational infrastructure (witness model, append-only proof, rotation handling). Forking would mean maintaining two implementations of the same Merkle structure.

4. _Host the directory in the same Tessera log._ Rejected because directory entries form a different per-label append-only structure than tlog-tiles' entry-indexed structure. Conflating them would force one of them into the wrong abstraction. They share the witness pattern but not the data model.

5. _Defer directory until V2._ Rejected because the dogfood thesis needs identity semantics now. Without the directory, "agents reason from a past they can prove" is a cryptographic statement about bytes, not a semantic statement about identity.

**Consequences.**

- New service `services/directory-node/` (TypeScript wrapper around AKD via WASM bridge per the [§3.1](atrib-spec.md#31-design-principles-and-rationale) benchmark dated 2026-04-29; rust-wasm via wasm-pack chosen).
- New package `@atrib/directory` exposing `publish`, `lookup`, `history`, `proveAbsence` SDK methods.
- `@atrib/verify` consumes the directory and annotates verification results with `identity_resolved`.
- The recall tool (an MCP server consumed by the host agent) annotates returned records with the resolved identity claim per record.
- Spec [§6](atrib-spec.md#6-key-directory) covers: claim format, AKD operations, witness model parity with [§2.9](atrib-spec.md#29-witnessing-and-cosignatures), verifier consultation algorithm.
- Downstream consumers requiring VRF-blinded lookup adopt the same AKD library configured for that mode, in their own service. Their configuration spec references [D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers).

**What this DOESN'T solve.**

- _Identity verification beyond self-attestation._ The protocol records claims but does not enforce that claim subjects are who they say they are. Domain verification and DID resolution are spec'd but the trust comes from the underlying mechanism (DNS, DID method), not from atrib.
- _Privacy of unblinded mode._ atrib's directory is public by design. Anyone can enumerate registered creator_keys and their claims. This is correct for attribution (where keys appear on a public log anyway). It would be wrong for privacy-sensitive consumers, which is why AKD also offers VRF-blinded mode for them.
- _AKD's own implementation correctness._ atrib trusts the AKD crate. If AKD has a bug, atrib has the bug. Mitigation: pin the version, follow upstream advisories, run AKD's own conformance suite as part of CI.
- _Directory-key rotation._ The directory-signing key has the same rotation problem as the log-signing key. Same V2 deferral.

**Implementation sequencing.** Bridge benchmark (2026-04-29): WASM lookup at 100K labels measured at 1.8ms p95, comfortably under the 50ms threshold from [§3.1](atrib-spec.md#31-design-principles-and-rationale). Decision: ship WASM via wasm-pack + wasm-bindgen. NAPI would be ~5x faster (typical native vs WASM ratio for crypto-heavy code) but the distribution simplicity (single .wasm artifact vs per-platform .node binaries), sandbox property, and zero-toolchain install requirement make WASM the right tradeoff. AKD parallelism is gated to `disabled()` in the WASM target because WASM runtimes lack a Tokio executor; insert throughput drops to ~6.3K labels/sec single-threaded, which is comfortably above the per-operation anchoring cadence ([§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)). Sequence: AKD WASM bridge crate → @atrib/directory package → services/directory-node service → wire into @atrib/verify → wire into recall.

## D035: Extensible event_type vocabulary via URI typing

**Date:** 2026-04-28
**Status:** Accepted

**Context.** A signed-attestation protocol that targets a heterogeneous set of agent architectures (tool-using agents, multi-agent orchestration, autonomous research, coding agents, regulated-AI shops, memory products, cognitive-substrate / personal-agent harnesses) cannot use a closed `event_type` enum without picking one architecture's worldview as canonical. Each architecture has native primitives the others do not need: multi-agent platforms want `delegate` / `handoff` / `vote`, memory products want `recall` / `forget` / `consolidate`, research agents want `hypothesis` / `experiment` / `result`, cognitive-substrate systems want `observation` / `annotation` / `proposal` / `apply`. Adding every consumer's primitives to a closed enum produces sprawl and makes the spec a bottleneck for protocol evolution. Restricting the enum to one or two types makes the protocol unable to express what consumers actually do.

Open signed-attestation protocols solve this with URI-typed vocabularies plus a small normative core. W3C Verifiable Credentials uses URI-typed `@type`. ActivityStreams 2.0 uses URI-typed `type` with a normative core vocabulary plus open extension. Sigstore in-toto attestations use URI-typed `predicateType` (e.g., `https://slsa.dev/provenance/v1`) where anyone publishes a predicate URI and tooling resolves what it understands. Signature integrity is type-independent; consumers parse what they recognize.

A decision was needed on (1) wire-format shape (full URI typing vs hybrid string-with-extension-allowance vs subtype field) and (2) the normative set atrib publishes alongside the extension mechanism.

**Decision.**

1. **`event_type` is a URI.** The record-level `event_type` field carries an absolute URI rather than a short token. atrib publishes a canonical core vocabulary under `https://atrib.dev/v1/types/<name>`. Anyone MAY mint extension URIs in their own namespace; atrib does not gate, register, or approve them.

2. **Normative set: three URIs.**
   - `https://atrib.dev/v1/types/tool_call`: agent invoked a tool with input(s) and received a result. Default for any active operation against external state.
   - `https://atrib.dev/v1/types/transaction`: commerce-protocol-detected closing event (ACP / UCP / x402 / MPP / AP2 / a2a-x402). Triggers [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation. Distinct from `tool_call` because [§4](atrib-spec.md#4-attribution-policy-format) calculation is normatively gated on this URI.
   - `https://atrib.dev/v1/types/observation`: passive perception captured by an ambient watcher or input source. The agent did not invoke a tool to produce this record; the record captures something the agent received from its environment. Has no caller-supplied input and no return value to attest to.

   `assertion`, `intent`, `proposal`, `apply`, `annotation`, `delegation`, `revision`, and similar primitives belong in extension namespaces. The bar for promoting an extension URI to atrib's normative set is in [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).

3. **Binary log entry maps URI to byte ([§2.3.1](atrib-spec.md#231-entry-serialization)).** The 1-byte `event_type` slot in the 90-byte log entry is a fast-path filter:
   - `0x01`: `tool_call` URI (atrib normative)
   - `0x02`: `transaction` URI (atrib normative)
   - `0x03`: `observation` URI (atrib normative)
   - `0xFF`: extension URI (verifier reads URI from record content)
   - `0x00`, `0x04`–`0xFE`: reserved for future atrib normative additions

   Verifiers filtering by atrib normative types use the byte directly. Verifiers wanting finer-grained filtering of extension URIs fetch the record. The byte is an indexing convenience; the URI in the record content is authoritative.

4. **Verifier semantics for unrecognized URIs.** A verifier seeing a record with an extension URI it does not recognize:
   - Verifies the signature normally (cryptographic integrity is type-independent).
   - Treats the URI as opaque; surfaces it in verification output verbatim.
   - Optionally attempts URI resolution to fetch a schema document (lazy / opt-in / no protocol-level requirement).
   - Records pass [§1](atrib-spec.md#1-attribution-record-format) validation regardless of URI recognition. The URI MUST be a syntactically-valid absolute URI; that is the only enforced constraint.

5. **Extension URIs MUST be absolute.** Relative paths or bare tokens are invalid. URIs SHOULD identify a stable owner (a domain the consumer controls, or a `urn:` namespace they registered). atrib does not validate ownership; this is a discipline guideline, not a normative requirement.

6. **Future normative additions go through [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).** The bar for promoting an extension URI to atrib's normative set is defined separately in [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) (this ADR establishes the structural mechanism; [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) establishes the promotion policy).

**Alternatives considered.**

1. _Closed enum with periodic additions per consumer request._ Solves no consumer's case fully and biases the enum toward whichever architectures arrive first. Each subsequent architecture either fits the existing types poorly (substrate-blindness pattern: misusing `tool_call` for non-tool primitives) or proposes its own additions, producing chronic spec churn.

2. _Closed enum, allow non-normative string values without canonicalization._ Spec says: "atrib's normative set is X, Y, Z; consumers MAY use other strings." Rejected because string-typed event_types lack namespacing; two consumers can mint the same string with conflicting semantics. The collision risk grows with adoption. URI typing solves this with no downside beyond field length.

3. _Add an optional `event_subtype` string field; keep `event_type` as the closed enum._ Rejected as a hybrid that has the worst of both. The split between normative `event_type` and freeform `event_subtype` creates an awkward indirection (verifiers always need to look at both); the subtype namespace still has the collision-risk problem of option 2; the closed `event_type` enum still becomes a bottleneck for any genuinely new top-level primitive.

4. _Drop `event_type` entirely; classification lives in content._ Rejected because the 1-byte log entry slot is genuinely useful for fast-path filtering at the log-byte level (regulators querying "all transactions" don't want to fetch every record). Removing it forces all type-based queries through content fetch. The byte stays; the question is what its values mean.

5. _URI-type but use a namespaced-token form (e.g., `atrib:v1:tool_call`, `vendor:observation`) instead of full URIs._ Rejected because the URI form is more standard, supports natural resolution to a schema document if the consumer provides one, and matches W3C VC / Sigstore in-toto / ActivityStreams precedent. The verbosity cost is negligible (~30-80 bytes per record).

6. _Add a fixed set of new normative types (e.g., `0x03`–`0x06`) for cognitive primitives now and revisit later._ Rejected because adding fixed normative types and later moving to URI typing produces a hybrid that all subsequent code must handle (some records have short-token event_types; others have URIs; both must be valid). Cleaner to make the structural change once.

**Consequences.**

- _Spec._ [§1.3](atrib-spec.md#13-canonical-serialization) (record format) updated: `event_type` is an absolute URI. [§2.3.1](atrib-spec.md#231-entry-serialization) (binary entry) updated: byte `0x03` reserved for `observation`, `0xFF` for extension. [§2](atrib-spec.md#2-merkle-log-protocol) normatively defines the byte→URI mapping for atrib's canonical set. [§1.7](atrib-spec.md#17-transaction-event-hooks) (payment-protocol detection) unchanged: still emits `transaction` URI on detection. New [§1.4.5](atrib-spec.md#145-event_type-uri-validation) added: URI validation requirements.
- _`@atrib/mcp`._ `types.ts` `EventType` becomes `string` (URI-typed) with a constant block exporting the three normative URIs. `signing.ts` `verifyRecord` checks URI is syntactically valid; rejects empty / relative URIs. `entry.ts` adds the `0x03` and `0xFF` byte mappings. Emitters default to URI form.
- _`@atrib/agent`._ All adapters automatically emit `tool_call` URI; transaction-detection logic emits `transaction` URI. No adapter API change.
- _`@atrib/verify`._ Verification output gains an `event_type_uri` field (always populated) and a `event_type_recognized` boolean (true iff URI is in atrib's normative set or a registered consumer set the verifier was configured with). Recognition is informational, not a verification-pass criterion.
- _log-node / log-dev._ `validateSubmission` updates: accepts URI-typed `event_type`; maps to byte for entry encoding (atrib normative URIs to `0x01`/`0x02`/`0x03`; everything else to `0xFF`). Rejects records with syntactically-invalid URIs.
- _Conformance._ `spec/conformance/1.4/` corpus contains URI-typed examples. New `spec/conformance/1.4-extension/` corpus with sample extension-namespace URIs. `spec/conformance/2.6.1/` validated against URI-typed submissions.
- _Downstream consumers._ Consumers needing primitives beyond atrib's normative set mint URIs in their own namespaces (e.g., a cognitive-substrate consumer might mint `https://example.com/v1/types/annotation`, `proposal`, `apply` under a domain it controls). The choice is theirs; atrib does not prescribe.

**What this DOESN'T solve.**

- _Cross-consumer semantic alignment._ Two consumers minting URIs for similar concepts (e.g., one's `assertion` vs another's `claim`) get no automatic alignment. Verifiers treating both as equivalent need their own mapping table. This is the same situation as MIME types or VC `@type`: namespacing prevents collision but doesn't enforce convergence.
- _Schema discovery._ atrib does not require URIs to resolve to a schema document. A consumer that wants schema-aware verification publishes their own schema and configures their verifier; atrib provides no resolution infrastructure.
- _Wire-format compatibility across implementations at a single point in time._ Implementations that have not yet adopted URI-typed `event_type` will reject these records as malformed. Cross-implementation upgrade is coordinated by the implementations involved.

**Implementation sequencing.** Spec [§1.3](atrib-spec.md#13-canonical-serialization) + [§2.3.1](atrib-spec.md#231-entry-serialization) + [§1.4.5](atrib-spec.md#145-event_type-uri-validation) update → `@atrib/mcp` types + signing + entry update → `@atrib/agent` smoke test that adapters produce valid records → log-node + log-dev validation update → conformance corpus regeneration → `@atrib/verify` URI-aware verification output → unit tests across the matrix.

## D036: Bar for promoting an extension URI to atrib's normative event_type vocabulary

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D035](#d035-extensible-event_type-vocabulary-via-uri-typing) established that anyone can mint extension `event_type` URIs. atrib's normative vocabulary remains open to additions, but the criteria for adding an extension URI to atrib's canonical core need to be defined explicitly. A poorly-defined bar produces either spec sprawl (every consumer's preferred primitive ends up canonical) or capture (one or two consumers' worldview gets picked as canonical and locks subsequent architectures into mismatched primitives).

The goal is a bar that produces coherent decisions over time without requiring re-litigation, while being permissive enough that genuine convergence is not blocked by procedural friction. Rigid numerical thresholds (e.g., "exactly 3 consumers must request it") fail the latter: real consensus rarely arrives in clean numerical form. Vague principles fail the former: future maintainers have nothing to anchor decisions to.

The chosen frame: principled criteria that depend on observation rather than petition. atrib promotes a URI to normative when the conditions described below are observably true, not when a consumer asks for promotion. Extension URIs do not require atrib's blessing to be valid; they are valid the moment they are minted. Promotion to atrib's namespace is purely a downstream tooling convenience.

**Decision.**

A type is eligible for promotion to atrib's normative URI namespace when the following indicators hold _together_. None is individually sufficient; they form a posture, not a checklist.

1. **Architecture-agnostic in practice.** The primitive appears across multiple independent consumer categories already in use, not within a single architectural lineage. Functional distinctness across categories (e.g., memory products + multi-agent orchestration + regulated AI) is the relevant signal; multiple implementations within a single category is not. The point is breadth across worldviews, not depth within one.

2. **Structurally distinct from existing normative types.** The primitive is not a special case of `tool_call` with metadata, not a status variant of `transaction`, not a sub-event of `observation`. If a careful read can model the primitive as one of the existing normative URIs plus a content field, it stays in extension namespace. Genuinely new structure is the bar; richer content is not.

3. **Filterable benefit at the log-byte level.** Verifiers running real queries gain meaningfully more from byte-level filtering than from content fetch + parse. A primitive that's queried frequently across the consumer base (e.g., regulators querying for "transactions") clears this; a primitive of interest mainly to one consumer's tooling does not.

4. **Required by atrib protocol OR observably canonical in extension form.** Either atrib's own [§3](atrib-spec.md#3-graph-query-interface) graph derivation or [§4](atrib-spec.md#4-attribution-policy-format) calculation depends on distinguishing this primitive, or the same extension URI has been independently adopted by multiple consumer categories with consistent semantics across them. The first is rare and decisive; the second is the more common path.

5. **Promotion is non-disruptive.** The primitive's wire and graph behavior under its extension URI is consistent with what its normative URI would be. Consumers using the extension URI before promotion can swap to the normative URI without changing their semantics. If promotion would change behavior in a way existing extension users have to migrate around, the bar is not met (or the change is not a promotion, it is a redesign).

The rule is _additive_. atrib does not retire normative URIs; once promoted, they stay. The cost of promotion is therefore long-lived; this asymmetry is intentional and is what motivates the conservative posture.

**Posture and judgment.**

The five indicators describe a structural condition the protocol has reached, not steps a consumer has performed. Maintainers evaluating a candidate ask: do the indicators hold? not: did the consumer file the right paperwork? Accordingly:

- _No formal request process._ Anyone can write an issue or PR proposing promotion of an extension URI. The maintainers' response is an evaluation of the indicators, not a procedural pass/fail. A request is welcome but not required for consideration; observation is enough.
- _No fixed cadence._ Promotions happen when warranted, not on a schedule. atrib does not commit to "review extensions quarterly" or similar.
- _No tier system._ atrib does not maintain "candidate," "experimental," or "deprecated" sub-states for extension URIs. URIs are either in atrib's normative set (consequence: atrib protocol may treat them specially) or they are not (consequence: they are valid extension URIs, no special protocol behavior). Binary.
- _Promotion is reversible only via deprecation, not removal._ A normative URI deemed in retrospect unwise becomes deprecated (verifiers warn but accept) but never invalidated. Removing it would break records signed under it.

**Indicators of "do not promote."**

The decision should be NOT to promote when any of these observations hold, even if some of the five inclusion indicators do:

- The primitive is contested across consumer categories (e.g., one category's `proposal` semantics conflict with another's). atrib's promotion would lock one interpretation; let consumers maintain their own URIs until usage converges.
- The maintainers cannot point to operational queries verifiers would run against this byte-level type that they could not run efficiently with content parse. "Could be useful" is not the same as "is being used."
- A clean refactor of an existing normative type would obviate the new one. Sometimes the right move is to relax constraints on `tool_call` rather than add a new sibling.

**Worked example: applying the bar to a hypothetical 4-type proposal.**

Suppose a proposal arrives to add four types covering a recursive-learning loop: `observation`, `annotation`, `proposal`, `apply`. Applying the indicators:

- `observation`: indicator 1 holds (multiple categories: monitoring, multi-agent, personal, regulated-AI input loggers), indicator 2 holds (no caller-supplied input + no return value to attest to is structurally distinct from tool_call), indicator 3 holds (regulators auditing perception), indicator 4 plausible (potential [§3](atrib-spec.md#3-graph-query-interface) future use), indicator 5 holds. **Promoted**, becomes `https://atrib.dev/v1/types/observation`.
- `annotation`: indicator 2 fails (special case of tool_call where an agent invoked a classify-tool; the derivation linkage is content metadata, not a structural distinction). **Extension namespace.**
- `proposal`: indicator 1 borderline (multi-agent + approval-workflow yes; most agents act rather than propose). Indicator 4 fails initially (no atrib protocol behavior depends on it; usage may be single-category). **Extension namespace; revisit if multiple consumer categories independently adopt similar URIs.**
- `apply`: indicator 2 fails (tool_call with a `parent_proposal_record_hash` linkage covers it; the linkage is content, not structure). **Extension namespace.**

Result: one promotion (`observation`), three correct-rejections that remain valid as extension URIs.

**Alternatives considered.**

1. _Numerical threshold ("≥N independent consumers requesting promotion")._ Rejected because real adoption rarely surfaces in petition form. A primitive could be in heavy use across many categories without anyone "requesting" anything; another could have many petitions from a single architectural lineage. The threshold rewards bureaucracy over signal.

2. _Formal RFC process._ Rejected as overhead that does not produce better decisions at the protocol's current scale. If atrib reaches an ecosystem size where a process is warranted, this ADR is replaced by a successor that defines one.

3. _Tier system (candidate / experimental / promoted / deprecated)._ Rejected because it adds protocol-level state that downstream tooling has to handle. URIs are either normative or extension; atrib does not maintain a tier-tracking surface. Tier-like distinctions can exist informally in a registry document outside the spec.

4. _Fixed cadence ("evaluate extensions quarterly")._ Rejected because most periods there will be nothing to promote. Forcing a cadence biases toward false-positive promotions.

5. _Anyone can promote their own URI by following a procedure._ Rejected because that's the same as having no normative core: if every consumer's URI is normative, the distinction collapses and atrib's vocabulary becomes the union of every downstream's vocabulary. Promotion has to be a deliberate act by atrib, with criteria observable from outside the consumer that benefits from it.

**Consequences.**

- atrib publishes its normative URI set in spec [§1.2.4](atrib-spec.md#124-event_type-values) with promotion history. Each entry includes: the URI, the date promoted, the byte mapping (if any), a one-sentence semantic statement, and a pointer to the ADR that promoted it.
- Promotion of a URI to atrib normative status requires a new ADR (or an amendment to [D035](#d035-extensible-event_type-vocabulary-via-uri-typing)) referencing this bar, with an evaluation against the five indicators recorded inline.
- The ADR referencing this bar serves as the historical record of the decision; future maintainers can re-evaluate whether the bar produced the right outcome by reading both the ADR and the subsequent observation period.
- Consumers proposing promotion get a transparent answer (the indicators above) without atrib needing to maintain a process.
- Maintainers facing a promotion proposal apply the bar in one document and either promote (new ADR + spec update) or explain (issue comment + close).

**What this DOESN'T solve.**

- _Disagreement between maintainers about whether an indicator holds._ The bar is interpretive; reasonable people can read the same evidence differently. The mitigation is: write down the evidence in the proposal, write down the maintainer's read in the response, and let the historical record show which judgments aged well.
- _Drift between extension URIs and atrib's normative set._ If atrib promotes `observation` but a consumer has been using `https://example.com/observation` with subtly different semantics, their existing records remain under their URI; their new records may target atrib's URI; verifiers comparing the two need their own mapping. atrib does not enforce migration.
- _Silent adoption._ atrib only knows about promotions when extension URIs become observable. Closed-source consumers using atrib in production may have URIs that should be promoted but are not visible to atrib's maintainers. The mitigation is: encourage consumers to publish their URI choices in their own documentation, but not as a normative requirement.

**Implementation sequencing.** [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) has no implementation. It is a governance ADR. The first application of the bar is the normative set defined in [D035](#d035-extensible-event_type-vocabulary-via-uri-typing): `tool_call`, `transaction`, `observation`. The next application will be whoever proposes the next promotion.

## D037: HSM/KMS operator profile

**Date:** 2026-04-30
**Status:** Accepted (design only; implementation gated)

**Context.** The `creator_key` Ed25519 seed is stored as 32 raw bytes, in env variables, in `~/.atrib/keys/`, or in macOS Keychain (per [D033](#d033-key-rotation-and-revocation)). In development this is acceptable under a single-machine compromise threat model (covered by Keychain + per-process file-mode 0600). In production, key material must never reside in process memory at all. The standard deployment profile uses HSM-backed signing: key material resides within a Cloud KMS, Vault Transit engine, or hardware YubiHSM; the wrapper requests signatures for canonical records without holding the raw bytes.

The `keystore: 'callback'` mode (designed and merged but not yet wired end-to-end) provides the wrapper-side hook. This ADR records the operator profile that closes the loop.

**Decision.**

1. **Three reference profiles.** atrib documents three operator profiles for HSM-backed signing, all using the same `keystore: 'callback'` middleware option:
   - **AWS KMS**: `Sign` API call against a `KEY_USAGE: SIGN_VERIFY` key with `KEY_SPEC: ECC_NIST_P256` initially (deferring Ed25519 KMS support, which AWS announced in 2023 but staged region-by-region; this profile lists Ed25519 as the long-term target). Latency: ~30-50ms per sign. Cost: ~$0.03 per 10K signs.
   - **HashiCorp Vault Transit**: `transit/sign/<key>` endpoint with `key_type: ed25519`. Latency: ~5-15ms when Vault is co-located. Cost: license-dependent; effectively free if Vault is already deployed.
   - **YubiHSM 2**, local-network HSM with PKCS#11 binding via `pkcs11js`. Latency: ~10ms. Cost: hardware capex (~$650 per unit) + zero ongoing.

2. **Wrapper contract.** The `keystore: 'callback'` mode passes the canonical signing input (the bytes that would be signed by `signRecord`) and the public key (already known to the wrapper from prior bootstrapping) to the operator-supplied function:

   ```ts
   keystore: {
     mode: 'callback',
     publicKey: 'base64url-43-chars',
     sign: async (canonicalBytes: Uint8Array): Promise<Uint8Array> => {
       // operator: HSM call returning 64-byte Ed25519 signature
     },
   }
   ```

   The middleware never sees the seed. If the callback throws or returns invalid bytes, the record submission fails per [§5.8](atrib-spec.md#58-degradation-contract) (warning, not user-visible error).

3. **No coupling between profile and protocol.** atrib does not specify which HSM operators must use. Any backend that can produce a 64-byte Ed25519 signature over a 32+ byte canonical input qualifies. Non-Ed25519 HSMs (RSA-only, ECDSA-only) are not supported by atrib v1, the Ed25519 choice ([§1.4.1](atrib-spec.md#141-key-format)) is normative.

4. **Where this lives in the spec.** [§7.6](atrib-spec.md#76-hsm-operator-profile) (new subsection) documents the callback contract and the three reference profiles. The profile section is informative; the callback signature is normative.

**Alternatives considered.**

1. _Operator-managed RFC 7468 PEM file with passphrase-encrypted seed._ Rejected, passphrase has the same memory-residency problem as the bare seed once decrypted, and adds a UX layer (passphrase prompt) that breaks unattended deployments.

2. _atrib bundles its own HSM client per backend._ Rejected, proliferates dependencies and makes atrib responsible for HSM SDK upgrade cycles. The callback mode lets operators bring their own client.

3. _Bootstrap from cloud-provider IMDS._ Rejected as the default path because it ties atrib to specific cloud environments. Documented as "additional pattern: AWS Lambda may use IMDSv2 to fetch a session-scoped KMS key" but not the headline.

**Consequences.**

- _Spec._ New [§7.6](atrib-spec.md#76-hsm-operator-profile) subsection (informative profiles + normative callback contract).
- _Wrapper._ `keystore: 'callback'` is the change that matters, already designed; validation against a mock HSM signer closes the implementation gap.
- _Documentation._ Each profile gets a 1-2 page operator runbook in `docs/operator/hsm-<profile>.md`; runbooks are drafted privately and promoted to public at first non-operator adoption.
- _No breaking changes._ The `keystore: 'env' | 'file' | 'keychain'` modes remain available for solo operators / dev. Callback mode is additive.

**What this DOES NOT solve.**

- _Key escrow._ HSMs prevent extraction; they don't address "we lost access to the HSM and need our records to keep working." Per [§1.9.2](atrib-spec.md#192-signing-rules), the emergency-key path covers this, if the operator pre-registered an emergency key, they can revoke compromised + rotate to a successor without HSM access.
- _Multi-region HSM topology._ If the operator's wrapper is in us-east-1 and the HSM is in eu-west-1, every sign is a transatlantic round-trip. atrib doesn't prescribe topology; the latency tradeoff is the operator's call.
- _Auditability of HSM-side decisions._ AWS KMS, Vault, and YubiHSM each have their own audit log. atrib's [D039](#d039-audit-log-for-key-access) audit log is wrapper-side; it captures every sign request and the public key in use, but not the HSM's internal decision-making.

**Implementation sequencing.** Spec [§7.6](atrib-spec.md#76-hsm-operator-profile) draft → callback-mode validation against a mock HSM signer → AWS KMS reference adapter in `packages/agent/src/keystore-aws-kms.ts` (deferred) → operator runbook for Vault + YubiHSM (deferred).

## D038: Per-conversation key derivation

**Date:** 2026-04-30
**Status:** Accepted (spec only; implementation deferred to V2)

**Context.** A creator_key signs every record an agent emits, across every session, indefinitely. This couples three privacy/compromise concerns:

1. **Cross-session linkability.** A verifier can trivially correlate every action by the same creator_key. For some applications (e.g., a long-running personal agent operating on the user's behalf) this is desired. For others (e.g., one-off task agents that should not be linkable across users) it leaks more than intended.
2. **Compromise blast radius.** A leaked creator_key invalidates every record signed by it from the moment of leak forward (per [§1.9](atrib-spec.md#19-key-rotation-and-revocation)). With per-conversation derivation, a leak of a derived key compromises only that conversation, not the entire history.
3. **Key rotation cadence.** Today, rotating the creator_key is a heavyweight act ([D033](#d033-key-rotation-and-revocation)) that produces a `key_revocation` record and updates the directory claim. Per-conversation keys would let routine "rotation" be derivation, with the master key only rotated on actual compromise.

The mechanism: HKDF (RFC 5869) derives a per-conversation Ed25519 seed from a master seed plus a context label. The master public key is published to the directory (per [§6.1](atrib-spec.md#61-identity-claim-format)) along with the derivation rule; verifiers can independently re-derive the per-conversation public key for any record and confirm the signature against it.

**Decision.**

1. **Spec the derivation, defer the implementation to V2.** [§1.10](atrib-spec.md#110-per-conversation-key-derivation) (new subsection) is informative for v1, implementations MAY support derivation but MUST NOT require it. The bare creator_key path remains the default.

2. **Derivation rule.** Per-conversation keys derive as:

   ```
   per_conv_seed = HKDF-SHA256(
     ikm   = master_seed,           // 32 bytes
     salt  = "atrib/v1/per-conv",   // domain separator (UTF-8 literal)
     info  = context_id || conversation_id,  // 16 + 16 = 32 bytes
     L     = 32,                    // output length
   )
   ```

   The `conversation_id` is a 16-byte agent-chosen value carried in the record's `conversation_id` field (new optional field; lex-orders before `creator_key`). Records WITHOUT `conversation_id` use the master key directly.

3. **Directory disclosure.** Identity claims that opt into per-conversation derivation declare it via a new `claim_subject.derivation` field:

   ```jsonc
   {
     "creator_key": "<master pubkey>",
     "claim_subject": {
       "display_name": "...",
       "derivation": {
         "rule": "atrib/v1/per-conv-hkdf",
         "info_format": "context_id || conversation_id",
       },
     },
   }
   ```

   Verifiers seeing `derivation` consult [§1.10](atrib-spec.md#110-per-conversation-key-derivation) to re-derive the expected per-conversation public key for the record being verified.

4. **Backward compatibility.** Identity claims WITHOUT `derivation` continue to be verified against the bare `creator_key`. Records WITH `conversation_id` but whose claim has no `derivation` are flagged `claim_derivation_mismatch: true` (soft signal per [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) failure semantics).

5. **No revocation propagation.** Revoking the master key revokes all derived keys (they share the master in their ancestry). Revoking a single derived key is NOT supported in this design, the granularity is per-master.

**Alternatives considered.**

1. _Per-record derivation (full forward secrecy)._ Rejected for v1, every record requires a fresh KDF call + signature against a fresh public key, which compounds verifier work (every record requires re-deriving and looking up). The per-conversation grain is the right balance: bounded number of derived keys per master, all derivable on demand.

2. _Threshold signatures (k-of-n cosigners)._ Rejected as out of scope. Threshold schemes solve the operational continuity problem differently (no single key to compromise) but require significant cryptographic infrastructure. atrib v1 stays with single-key Ed25519.

3. _Stateful key derivation (chain forward like Signal)._ Rejected because it requires synchronized state between the agent and the verifier, both must replay from the master to the current per-conv key. The HKDF design is stateless: any verifier can derive any per-conv key independently.

**Consequences.**

- _Spec._ New [§1.10](atrib-spec.md#110-per-conversation-key-derivation) subsection (informative for v1, normative if/when an implementation adopts it). New optional `conversation_id` record field. New optional `claim_subject.derivation` field.
- _Wrapper._ No code changes for v1. Future implementations add a `keyMode: 'derived' | 'master'` middleware option.
- _Verifier._ No code changes for v1. Future implementations re-derive per-conversation public keys when verifying records that carry `conversation_id`.
- _Directory._ No schema changes, `claim_subject` is already a free-form JSON object per [§6.1](atrib-spec.md#61-identity-claim-format).

**What this DOES NOT solve.**

- _Master key compromise._ If the master seed leaks, every derived key is reproducible. The compromise blast radius is reduced for short-lived derived keys (post-revocation new conversations get fresh keys), but the historical record signed under any conversation's pre-revocation derived key is forensically replayable from the leaked master.
- _Mixing modes within one identity._ An identity that has SOME records signed with the master and OTHERS signed with derived keys is permitted but operationally confusing. Recommend operators commit to one mode per identity.

**Implementation sequencing.** Spec only for v1. Pre-implementation work: a Wycheproof-shaped HKDF test corpus to confirm the derivation rule is reproducible across implementations.

## D039: Audit log for creator-key access

**Date:** 2026-04-30
**Status:** Accepted (design + skeleton; full SIEM integration deferred)

**Context.** The wrapper holds the creator_key seed (or a callback to an HSM, per [D037](#d037-hsmkms-operator-profile)) for the lifetime of the process. Every signature operation reads or proxies that key. Without an audit log, an operator investigating a compromise has no record of when, by which process, or in response to what input the key was used. atrib's degradation contract ([§5.8](atrib-spec.md#58-degradation-contract)) and idempotency cache mean even legitimate signature requests can fan out internally; the audit log captures the wrapper-side call, not just the on-the-wire submission.

**Decision.**

1. **Per-process JSONL audit file.** Every key-access operation in the wrapper appends one JSONL line to `~/.atrib/audit/<YYYY-MM-DD>.jsonl` (configurable via `ATRIB_AUDIT_PATH`). File permissions: dir 0700, file 0600.
2. **Recorded fields.** Each line:
   ```jsonc
   {
     "ts": 1743850000000, // ms since epoch
     "op": "sign", // 'sign' | 'load_seed' | 'derive'
     "pid": 12345, // process id
     "ppid": 12344, // parent process id
     "node_v": "v22.0.0", // node version (helps trace)
     "creator_key": "<base64url>", // public key (NEVER the seed)
     "context_id": "<32-hex>", // when applicable; redacted to null for non-record-bound ops
     "record_hash": "sha256:...", // for sign ops; null otherwise
   }
   ```
   Notably ABSENT: the canonical signing input bytes, the resulting signature, and any seed material.
3. **Optional remote sync.** The wrapper supports `ATRIB_AUDIT_FORWARD=<url>` for streaming each line to an operator's SIEM (e.g., a Splunk HEC endpoint, an OpenTelemetry collector). The forwarder is fire-and-forget per [§5.8](atrib-spec.md#58-degradation-contract); a failed forward warns once and continues.
4. **Rotation.** One file per UTC day. Implicit rotation at midnight; the wrapper does not delete old files (operator policy).
5. **Where this DOES NOT live.** The audit log lives wrapper-side (filesystem or organizational SIEM). It is NOT submitted to the public log, the contents (process IDs, parent process IDs, op timing) are operational data that stays local to the deploying organization.

**Alternatives considered.**

1. _No audit log; rely on the public log._ Rejected, the public log records the OUTCOME of signing (the record committed), not the wrapper-side ATTEMPT. Failed signs, retries, and idempotent cache hits never appear publicly. An operator investigating a compromise needs the wrapper's view.
2. _syslog / journald instead of JSONL._ Rejected, JSONL is portable across OSes, easy to grep, and trivially forwardable. syslog would couple atrib to OS-specific configuration.
3. _Encrypted audit file (AES-GCM with a separate audit key)._ Rejected for v1, adds a key-management problem to solve a problem most operators don't have. File-mode 0600 + filesystem encryption (FileVault, LUKS) is the v1 default. Operators with stricter requirements use the SIEM forward.

**Consequences.**

- _Wrapper._ New `audit.ts` module in `packages/mcp/`. New env vars: `ATRIB_AUDIT_PATH`, `ATRIB_AUDIT_FORWARD`. Audit calls hooked into `signRecord` + `loadSeed`.
- _No spec changes._ The audit log is a wrapper-implementation concern, not protocol.
- _Default-on._ The audit log is created on first sign operation. Operators who want to disable it set `ATRIB_AUDIT_PATH=/dev/null`.

**What this DOES NOT solve.**

- _Tamper-evident audit._ The JSONL file is plain text, append-only by convention only, an attacker with filesystem write access can rewrite history. For tamper-evidence, the operator forwards to a SIEM with cryptographic timestamping. Building atrib-side tamper-evidence (sign each line, chain via the previous line's hash) is V2 work.
- _Cross-host correlation._ When one logical "wrapper" runs across multiple processes (e.g., Node cluster mode), each process produces its own audit file. Correlation requires the operator to ship them all to the same SIEM.

**Implementation sequencing.** `audit.ts` module → hook `signRecord` + `loadSeed` → integration tests asserting line shape + file mode → operator runbook documenting the format and SIEM forwarding example.

## D040: Reserved

[D040](#d040-reserved) is reserved for the harness reference implementation ADR: scope of `@atrib/recall`, why it's informative-not-normative. It will be authored when `@atrib/recall` is published to the `packages/recall/` directory.

## D041: informed_by linking primitive and INFORMED_BY edge type

**Date:** 2026-04-28
**Status:** Accepted

**Context.** atrib v1 chains records along three observable axes: identity (signature), per-session ordering (chain_root pointing at the parent record's hash), and cross-session sameness (session_token via CROSS_SESSION). Verifiers can prove who acted, when, and in what order. They cannot prove which prior records the agent actually consulted before each action.

The chain order says "B came after A in this session." It does not say "the agent read A's output before deciding to call B." For the brand promise of "verifiable agent actions in proper context" to be substantively honest, the substrate needs a way to express the agent's claimed reasoning composition: the specific records the agent says informed each action, including by exclusion (records that came before but did not inform).

Without such a primitive, every consumer wanting reasoning-chain auditability either rolls their own out-of-band linkage (incompatible across consumers) or re-derives causation by content analysis (loses the cryptographic anchor).

**Decision.**

1. **New optional field `informed_by`** in the attribution record format. Carries an array of record_hash values (each the SHA-256 of the JCS canonicalization of a complete signed record, hex-encoded with `sha256:` prefix, matching `chain_root` format). Empty or absent when the record makes no provenance claim.

2. **Field is optional.** Records without `informed_by` are valid. Records with `informed_by` may list zero or more record_hashes. The hashes may reference records in the same session, a different session of the same creator_key, or a session of a different creator_key.

3. **New graph edge type INFORMED_BY** derived deterministically from the field. For each record A with `informed_by: [h1, h2, ...]`, for each record B in the record set where `sha256(jcs(B)) == hi`, create INFORMED_BY edge A → B. If the referenced record is not in the resolved set, a placeholder edge to a synthetic dangling node is created with `dangling: true`. The verifier surfaces this; atrib does not infer the edge away.

4. **No semantic interpretation by the protocol.** atrib does not validate that the listed records actually informed the action. The agent claims; atrib certifies the claim was signed. Truthfulness is a downstream verification concern (cross-checking content of referenced records against the action they purport to inform).

5. **JCS canonical position.** `informed_by` slots between `event_type` and `provenance_token` lexicographically (e < i < p). Presence/absence affects the signature.

6. **Field MUST be deterministically ordered when present.** Hashes in the array MUST be sorted lexicographically by the hex string. This avoids signature instability from agent-side ordering choices.

**Alternatives considered.**

1. _No primitive; consumers build out-of-band linkage._ Rejected because every consumer reinvents the same shape with different semantics. Verifiers cannot compose. Cross-consumer reasoning audit becomes impossible.

2. _Implicit derivation from chain order._ Rejected because chain order proves precedence, not consultation. Two records in chain order need not have informed each other; the agent may have ignored A entirely when deciding B.

3. _New normative event_type for "informed_by" claims._ Rejected because it shifts the question to a different layer without solving it. INFORMED_BY needs to be a structural property of any record, not a separate record type.

4. _Inline content references rather than record_hash._ Rejected because content references re-leak whatever the referenced records leak. Hash references say "this record informed me" without re-disclosing content.

5. _Auto-tracking only; no field._ Rejected because middleware can only track what flows through it. Records the agent reads via side channels (its own memory, external state) cannot be auto-tracked. The field is the only way to express the agent's complete claim.

**Consequences.**

- _Spec._ [§1.2](atrib-spec.md#12-the-attribution-record) (record format) gains `informed_by` field definition. [§1.3](atrib-spec.md#13-canonical-serialization) (canonical serialization) updates JCS field-order example. [§3.2.3](atrib-spec.md#323-edge-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) add INFORMED_BY edge type and derivation rule. [§3.2.1](atrib-spec.md#321-node-types) records that any node type may be the source or target of an INFORMED_BY edge.
- _`@atrib/mcp`._ Record type gains optional `informed_by: string[]`. Signing/verification updates JCS canonicalization to include the field when present. New helper `recordOptions.informedBy: string[]` to allow agent override of middleware auto-tracking ([D048](#d048-plug-and-play-enforcement-contract-for-adapters)).
- _`@atrib/agent`._ Adapters gain a context tracker that records hashes of records the agent has consumed via tool results, observations, and inbound provenance. Auto-populates `informed_by` on subsequent emissions. Agent override available via `recordOptions.informedBy`.
- _`@atrib/verify`._ Verification output gains `informed_by_resolution: { resolved: ResolvedRecord[], dangling: string[] }` per record. Dangling references are flagged but do not fail verification (the claim was signed; the referent's absence is a different question).
- _services/graph-node._ Edge derivation gains step 6 (INFORMED_BY). Node response includes `informed_by_count` for browseability.
- _Conformance._ `spec/conformance/1.4/` corpus gains vectors with and without `informed_by`. New `spec/conformance/3.2.4/informed-by/` corpus exercises the derivation rule.

**What this DOESN'T solve.**

- _Truthfulness of the claim._ atrib does not prove the listed records actually informed the action. A malicious or careless agent can claim records that did not inform, or omit records that did. Truthfulness verification is a downstream concern: cross-check content (when revealed) against the claimed action.
- _Reasoning between records._ `informed_by` says "these records informed me." It does not say what the agent reasoned about between them. Reasoning auditability is the harness-side pattern in [D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern).
- _Privacy of the linkage itself._ Listing record_hashes discloses the agent's claimed reasoning composition. This is the structural disclosure that makes auditability work; consumers wanting finer control commit to a hash of the sorted list (`informed_by_commitment`) and reveal selectively. The commitment-and-reveal pattern is harness-layer; [D045](#d045-privacy-postures-normative-spec-section) documents it as a privacy posture option.

**Implementation sequencing.** Spec [§1.2](atrib-spec.md#12-the-attribution-record) + [§1.3](atrib-spec.md#13-canonical-serialization) + [§3.2.3](atrib-spec.md#323-edge-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) update → `@atrib/mcp` types + signing + canonicalization → `@atrib/agent` context tracker → `@atrib/verify` resolution output → `services/graph-node` edge derivation → conformance corpus generation → unit tests across the matrix.

## D042: Lift observation graph participation restriction

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D035](#d035-extensible-event_type-vocabulary-via-uri-typing) promoted `observation` to atrib's normative event_type set. The initial graph derivation rules ([§3.2.1](atrib-spec.md#321-node-types), [§3.2.4](atrib-spec.md#324-edge-derivation-rules)) excluded observation records from CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, and CONVERGES_ON edges. This was a conservative v1 choice: observation semantics were new, and the spec preferred to defer linkage rules until usage established what they should be.

The conservative posture has a cost. The most natural use of observation records is as context for subsequent actions: agent observes user preferences, then acts on them; agent observes a market signal, then trades on it; agent observes a tool result, then chains a follow-up. Excluding observation from chain participation means the temporal graph spine has gaps where observations belong. Verifiers querying the graph see tool_calls and transactions but not the observations that contextualize them, even when those observations are signed and chained at the record-format level (every record has chain_root since v1).

The introduction of `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)) makes the cost concrete: observations are the canonical context records that subsequent tool_calls would reference. If observations are missing from the graph spine, INFORMED_BY edges pointing at them dangle by construction.

**Decision.**

1. **Observations participate in CHAIN_PRECEDES, SESSION_PRECEDES, and SESSION_PARALLEL** like any other record type. No special-case logic. The chain spine becomes the temporal ordering of all signed records in a session, regardless of event_type.

2. **Observations DO NOT participate in [§4.6](atrib-spec.md#46-the-calculation-algorithm) attribution calculation.** The contributing set remains `tool_call` and `gap_node`. Observations are witness records, not actions: the agent did not invoke a tool to produce them. They contextualize attribution but do not contribute to value distribution.

3. **Observations DO NOT participate in CONVERGES_ON.** The CONVERGES_ON edge says "this node contributed to the transaction in this session." Observations did not contribute; they witnessed. Excluding them from CONVERGES_ON keeps the attribution graph honest.

4. **Observations MAY be the source or target of INFORMED_BY edges.** A tool_call may declare it was informed by an observation (`informed_by: [hash(observation_record)]`). An observation may declare it was informed by prior observations or tool_calls. The edge derivation is content-agnostic per [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type).

5. **No backfill.** Records signed before this ADR remain valid. The graph builder that processes them simply produces edges per the new rule when re-running.

**Alternatives considered.**

1. _Keep observation excluded._ Rejected because the cost is concrete: INFORMED_BY edges pointing at observations would dangle, and the chain spine would have gaps where the natural context records belong. The original conservative choice was reasonable for v1 in isolation; [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) changes the calculus.

2. _Promote observation to the [§4.6](atrib-spec.md#46-the-calculation-algorithm) contributing set._ Rejected because observations are witnesses, not actions. Including them in attribution would inflate claimed contributions for any agent that records its own observations. The fact/policy boundary requires observations to be queryable but not weighted by default.

3. _Add observation to CONVERGES_ON._ Rejected for the same reason as #2: CONVERGES_ON is the structural prerequisite for [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation. If observations carry CONVERGES_ON edges, attribution policies that count CONVERGES_ON would over-count.

4. _Define a separate "OBSERVATION_PRECEDES" edge type._ Rejected as artificial taxonomy growth. The temporal/chain semantics are identical for tool_calls and observations; introducing a parallel edge type for one event_type is structural duplication without benefit.

**Consequences.**

- _Spec._ [§3.2.1](atrib-spec.md#321-node-types) node types entry for observation is updated: observation participates in CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL; does not participate in CONVERGES_ON or [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation; may be source or target of INFORMED_BY ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation steps add the inclusion clarification.
- _`@atrib/verify`._ [§4.6](atrib-spec.md#46-the-calculation-algorithm) implementation explicitly excludes observation from contributing set (was implicit; becomes explicit per the rule above).
- _services/graph-node._ Edge derivation includes observations in steps 1-3 (chain, session_precedes, session_parallel) but excludes from step 4 (CONVERGES_ON). Step 5 (CROSS_SESSION) already excluded observations because session_token semantics describe agent continuation, not witness continuation.
- _Conformance._ New `spec/conformance/3.2.4/observation-chained/` corpus exercises observation-in-chain derivation. New negative case: observation MUST NOT appear in [§4.6](atrib-spec.md#46-the-calculation-algorithm) contribution sets.

**What this DOESN'T solve.**

- _Whether observations should ever count for attribution._ Some consumers may want observation contributions (e.g., a research-credit policy that values reading prior work). Such consumers express the policy in their [§4](atrib-spec.md#4-attribution-policy-format) policy document; atrib's [§4.6](atrib-spec.md#46-the-calculation-algorithm) default stays clean. This is the fact/policy separation working as intended.
- _Cross-session observation linkage._ Observations do not carry session_token (typically) and so do not participate in CROSS_SESSION. If an observation needs to anchor cross-session work, the carrier is `provenance_token` ([D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)) or `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)), not session_token.

**Implementation sequencing.** Spec [§3.2.1](atrib-spec.md#321-node-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) update → `services/graph-node` derivation update → `@atrib/verify` calculation: explicit exclusion → conformance corpus gains observation-in-chain cases → integration test with mixed event types.

## D043: Extension URI participation in graph derivation

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D035](#d035-extensible-event_type-vocabulary-via-uri-typing) established URI-typed event_type with extension URIs in consumer namespaces (byte 0xFF in [§2.3.1](atrib-spec.md#231-entry-serialization)). The initial v1 rule excluded extension records from edge derivation: "queryable as opaque-typed nodes but DO NOT participate in [§3.2.4](atrib-spec.md#324-edge-derivation-rules) edge derivation."

This rule has the same shape as the observation exclusion ([D042](#d042-lift-observation-graph-participation-restriction)) and the same cost: the temporal graph spine has gaps where extension records belong. For the [§7.5](atrib-spec.md#75-harness-side-reasoning-chains) harness-side reasoning chains pattern ([D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern)) to work using extension URIs, the extension records must appear in the chain spine alongside tool_calls and observations. Otherwise verifiers querying the graph cannot see the deliberation records the harness emitted.

The trust posture for extension URIs differs from atrib's normative URIs: atrib does not bless their semantics. Including them in the chain spine must not be mistaken for blessing.

**Decision.**

1. **Extension URI records participate in CHAIN_PRECEDES, SESSION_PRECEDES, and SESSION_PARALLEL** the same as normative records. Chain ordering is structural; it depends on chain_root linkage and timestamps, not on event_type semantics.

2. **Extension URI records DO NOT participate in CONVERGES_ON by default.** CONVERGES_ON implies contribution toward a transaction, which is an attribution claim atrib makes about its normative types. Extension URIs are consumer-namespace; default semantics conservatively exclude.

3. **Extension URI records MAY participate in PROVENANCE_OF ([D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)) and INFORMED_BY ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)).** Both edge types are content-agnostic structural primitives. An extension record may carry `provenance_token` and `informed_by`; the derivation honors the field, not the URI.

4. **Extension URI records DO NOT participate in [§4.6](atrib-spec.md#46-the-calculation-algorithm) attribution calculation by default.** Promotion to the contributing set requires [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)'s bar. Consumer policies ([§4](atrib-spec.md#4-attribution-policy-format) policy documents distinct from [§4.6](atrib-spec.md#46-the-calculation-algorithm) default algorithm) MAY include extension URIs in their own attribution; the protocol stays clean.

5. **Verifier surfaces the URI verbatim.** Graph response includes the full URI string for extension nodes. Verifiers wanting to filter by namespace do so client-side.

**Alternatives considered.**

1. _Continue excluding extension URIs from all graph edges._ Rejected because [§7](atrib-spec.md#7-harness-integration-patterns) harness-side patterns ([D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern)) need extension records in the chain spine. Excluding produces gaps where reasoning records belong.

2. _Include extension URIs in CONVERGES_ON._ Rejected because atrib does not bless extension semantics. Including extension records as contributors would imply atrib certifies their attribution claim.

3. _Require consumer to opt extension URIs into graph participation via a flag in the record._ Rejected as protocol overhead without clear benefit. The default-include-in-chain, default-exclude-from-contribution split is the right default for the substrate.

4. _Define a separate "extension chain" parallel to the main graph._ Rejected as taxonomy duplication. The chain spine is a structural property; semantics layer over it.

**Consequences.**

- _Spec._ [§3.2.1](atrib-spec.md#321-node-types) node types section gains an "Extension URI nodes" subsection clarifying participation. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation steps add the inclusion clarification.
- _services/graph-node._ Edge derivation includes extension records in chain steps. Already excluded from CONVERGES_ON since v1; no change.
- _`@atrib/verify`._ [§4.6](atrib-spec.md#46-the-calculation-algorithm) implementation explicitly excludes extension URIs from contributing set (matches existing behavior; becomes explicit).
- _Conformance._ New `spec/conformance/3.2.4/extension-chained/` cases exercise extension-record-in-chain derivation.

**What this DOESN'T solve.**

- _Cross-namespace alignment._ Two consumers minting different URIs for similar concepts (e.g., `https://a.example/proposal` vs `https://b.example/proposal`) appear as distinct node types in the graph. Verifiers wanting to treat them as equivalent maintain their own mapping. This matches MIME types and W3C VC `@type`.
- _Default [§4.6](atrib-spec.md#46-the-calculation-algorithm) participation for extension URIs that should arguably contribute._ If a consumer mints an "action" URI structurally identical to `tool_call`, atrib's [§4.6](atrib-spec.md#46-the-calculation-algorithm) still excludes it. The consumer's own policy may include it; atrib normative behavior does not change without a [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion.

**Implementation sequencing.** Spec [§3.2.1](atrib-spec.md#321-node-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) update → `services/graph-node` derivation includes extensions in chain steps → conformance corpus gains extension-in-chain cases → integration test with extension records carrying informed_by + provenance_token.

## D044: provenance_token field for cross-session causal anchoring

**Date:** 2026-04-28
**Status:** Accepted (refactored from initial draft to resolve circular derivation)

**Context.** atrib v1 has one cross-session linkage mechanism: `session_token`, defined in [§1.2.1](atrib-spec.md#121-field-definitions) as "Base64url-encoded 16-byte opaque token identifying the logical session across OTel trace boundaries." session*token expresses \_same logical session* across trace boundaries: an agent doing one continuous task that happens to span multiple OTel context_ids.

Several real cross-session patterns are NOT same-logical-session and need a different mechanism:

- **Workflow handoff:** agent A finishes its initial work, hands off to agent B for follow-up work. Different agents, different sessions, causal dependency.
- **Tool-result consumption across sessions:** agent A writes to a queue, agent B reads it later. Different agents, different times, causal dependency.
- **Webhook/event-driven:** agent A emits an event, agent B reacts later. Different agents, different times, causal dependency.

In all three patterns the downstream session is _causally anchored_ on an upstream record but is not the _same logical session_. session_token does not fit. An earlier design considered `recommendation_token` for this purpose; it was discussed in spec [§3.2.4](atrib-spec.md#324-edge-derivation-rules) notes as a deferred mechanism but never normatively specified. The name overcommits to one specific use case (recommendations); the actual mechanic is broader.

[D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) introduced `informed_by` as the general "agent's claimed reasoning context" primitive. provenance_token is best understood as a stricter, ergonomically-specialized subset of informed_by: restricted to a single value, scoped to the session-genesis record only, and truncated for cross-session API ergonomics. The two coexist; provenance_token does not replace informed_by.

**Decision.**

1. **New optional field `provenance_token`** in the attribution record format. Carries a base64url-encoded 16-byte opaque token. The token is the truncated hash of an upstream record that the downstream session claims as its causal anchor.

2. **Token derivation (downstream-side only).** A downstream record carries `provenance_token = base64url(SHA-256(JCS(upstream_record))[:16])` where `upstream_record` is the complete signed record (including its signature) the downstream session anchors on. The first 16 bytes of the SHA-256 record hash provide 2^128 collision resistance, sufficient for the cross-session anchor space.

3. **Upstream records carry no special field to be anchorable.** Any signed record in the log can be referenced as an anchor by truncating its hash. The earlier draft of this ADR specified that upstream records carry their own `provenance_token` to "declare anchorability"; this would have been circular (the record's hash depends on the token field, which depends on the hash). The cleaner model: upstream is implicitly anchorable; only downstream records carry the token claim.

4. **Field MUST appear only on the genesis record of a session.** A session's ancestry is a session-level property. The genesis record is the natural place to declare it. Subsequent records in the session inherit ancestry implicitly via session membership (same context_id). Non-genesis records carrying `provenance_token` MUST be rejected as malformed; this constraint avoids ambiguity about which token represents the session's true ancestry.

5. **provenance_token as a stricter subset of informed_by.** Both fields express agent-claimed causal references. The distinctions:

   | Property                     | `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)) | `provenance_token` (this ADR)                     |
   | ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
   | Cardinality                  | Multi-valued (array)                                                                  | Single-valued                                     |
   | Scope                        | Per-record (any record may carry it)                                                  | Per-session (genesis record only)                 |
   | Hash form                    | Full record_hash (43 chars + prefix = ~71 chars per entry)                            | Truncated 16 bytes (22 chars base64url)           |
   | Use case                     | "Records this action consulted"                                                       | "This session's ancestry anchor"                  |
   | Cross-session API ergonomics | Not optimized for env-var / header passing                                            | Designed for env-var / header / URL-param passing |

   A consumer wanting full-precision cross-session references with multiple anchors uses `informed_by` (which can include record_hashes from any session). provenance_token is the ergonomic shorthand for the special case of declaring a session's single ancestral anchor, designed to be passed across session boundaries via environment variables, HTTP headers, or URL parameters.

6. **New graph edge type PROVENANCE_OF** derived from the field. For each genesis record D with `provenance_token: T`, search the record set for any record U where `base64url(SHA-256(JCS(U))[:16]) == T` and `U.context_id ≠ D.context_id`. If found, create PROVENANCE_OF D → U. If not found, create PROVENANCE_OF D → synthetic_dangling_node(T) with `dangling: true`. The direction reads as "D's session descends from U's anchor."

7. **JCS canonical position.** `provenance_token` slots after `informed_by` and before `session_token` lexicographically (i < p < s). Presence/absence affects the signature.

8. **session_token semantics unchanged.** session*token continues to mean \_same logical session across traces* and continues to drive CROSS_SESSION edges. provenance_token is a distinct field with distinct semantics; the two MAY coexist on the same record (a session-genesis record may both belong to a multi-trace logical session AND descend from a prior session's anchor).

9. **Distinct from `recommendation_token`.** The `recommendation_token` mention in [§3.2.4](atrib-spec.md#324-edge-derivation-rules) (originally a deferred design note) is removed from the spec. This ADR formally supersedes it.

**Alternatives considered.**

1. _Reuse session_token for both same-session and cross-session-causal patterns._ Rejected because the semantics differ. session_token says "this is the same logical session"; the new mechanism says "this is a different session with causal dependency." Conflating them would force verifiers to disambiguate from context, defeating the point of explicit fields.

2. _Use `informed_by` exclusively (no separate provenance_token)._ Rejected because the ergonomic case for a short, single-valued ancestry token is real: cross-session APIs (env vars, HTTP headers, URL parameters) have length limits and benefit from a 22-char anchor over a 71-char full-hash array entry. provenance_token is the specialized ergonomic form; informed_by remains the general-purpose primitive.

3. _Keep upstream-side broadcast (initial draft of this ADR)._ Rejected because the derivation was circular: upstream record's hash depends on the token field, which depends on the hash. The downstream-only model is structurally clean; any signed record is implicitly anchorable.

4. _Allow provenance_token on any record, not just genesis._ Rejected because session ancestry is a session-level property. Allowing arbitrary records to carry different ancestry tokens within a single session would create ambiguity about which token represents the session's true origin. Constraining to genesis records keeps the semantic clean.

5. _Keep `recommendation_token` name._ Rejected because the name describes one use case (recommendations) when the mechanic is general. `provenance_token` is accurate across all the cross-session causal patterns.

6. _32-byte token (full record_hash) instead of 16-byte truncation._ Rejected as defeating the ergonomic purpose. The truncation is the whole point. 16 bytes give 2^128 collision resistance, which is sufficient for the global cross-session token space.

7. _Cryptographic signing of the token by the upstream agent._ Rejected as redundant. The token is derived from an already-signed record; anyone fetching the referenced upstream record can verify the hash matches. No additional signature on the token itself adds value.

**Consequences.**

- _Spec._ [§1.2](atrib-spec.md#12-the-attribution-record) (record format) gains `provenance_token` field definition. [§1.2.6](atrib-spec.md#126-provenance_token) gives the full semantics including the genesis-record constraint. [§1.3](atrib-spec.md#13-canonical-serialization) updates JCS field-order example. [§3.2.3](atrib-spec.md#323-edge-types) gains PROVENANCE_OF edge type. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) gains derivation step 7 (PROVENANCE_OF) after the existing 5 steps and the new INFORMED_BY step ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) note about "recommendation_token" is removed.
- _`@atrib/mcp`._ Record type gains optional `provenance_token: string`. Helper `recordOptions.provenanceToken: string` lets a session's genesis record claim a known anchor token. Validation: middleware MUST reject `provenance_token` on non-genesis records.
- _`@atrib/agent`._ Adapters auto-derive provenance_token from inbound cross-session API state when the agent uses canonical subagent-spawn or workflow-handoff APIs ([D048](#d048-plug-and-play-enforcement-contract-for-adapters)). Other patterns require explicit opt-in via `recordOptions`.
- _`@atrib/verify`._ Verification output gains `provenance: { token, upstream_record_hash, upstream_resolved: ResolvedRecord | null }` for the genesis record carrying the token. Dangling references (token claimed but upstream record not in resolved set) are flagged.
- _services/graph-node._ Edge derivation gains step 7 (PROVENANCE_OF). Cross-session query semantics extended.
- _Conformance._ `spec/conformance/1.4/` corpus gains vectors with provenance_token on genesis records. New `spec/conformance/3.2.4/provenance/` corpus exercises derivation across context_ids. New negative case: provenance_token on non-genesis record MUST be rejected.

**What this DOESN'T solve.**

- _Truthfulness of the claim._ atrib certifies that downstream record D was signed and carries token T. atrib does not certify D's session was actually caused by U. Verifiers cross-check content (when revealed) against the claimed anchor.
- _Multi-anchor cross-session causation._ A session may genuinely descend from multiple upstream sessions (e.g., merging two task threads). provenance_token is single-valued; informed_by handles the multi-valued case (full hashes, any record can carry it).
- _Forward inference._ PROVENANCE_OF edges only exist when downstream genesis records explicitly claim a token. atrib does not infer provenance from content overlap or behavioral similarity.

**Implementation sequencing.** Spec [§1.2](atrib-spec.md#12-the-attribution-record) + [§1.2.6](atrib-spec.md#126-provenance_token) + [§1.3](atrib-spec.md#13-canonical-serialization) + [§3.2.3](atrib-spec.md#323-edge-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) update → `@atrib/mcp` types + signing + canonicalization + genesis-record validation → `@atrib/agent` auto-derivation for canonical patterns → `@atrib/verify` provenance resolution → `services/graph-node` step 7 derivation → conformance corpus generation → integration test for handoff and webhook patterns.

## D045: Privacy postures normative spec section

**Date:** 2026-04-28
**Status:** Accepted

**Context.** atrib's substrate is public by design: the log is public-readable, records carry verifiable signatures, and the graph layer derives structure from observable record content. The disclosure surface of any record includes: `creator_key` (public identity), `tool_name` (verbatim string), `args_hash` and `result_hash` (SHA-256 commitments), `timestamp_ms` (millisecond precision), `event_type` URI (consumer namespace for extensions), and any optional fields like `informed_by` and `provenance_token`.

Three of these are required by the current spec and pose real privacy concerns under default settings:

- **`tool_name`** verbatim discloses the kind of action (`book_flight`, `transfer_usdc`).
- **`args_hash`** / **`result_hash`** enable pre-image attacks on low-entropy args (e.g., `flight_id` from a known set) and equality leakage (same args → same hash).
- **`timestamp_ms`** discloses operational fingerprints (working hours, reaction times, batch patterns).

Mitigations exist (opaque tool labels, salted commitments, coarsened timing) but require spec-level support to be a normative property of the substrate rather than an ad-hoc harness choice. Without normative privacy postures, the brand promise of "verifiable and privacy-configurable" is not honestly true: harnesses that need privacy must build it themselves and lose interoperability.

**Decision.**

1. **Spec gains a new [§8](atrib-spec.md#8-privacy-postures) "Privacy postures" section** establishing four normative postures. A record's posture is encoded in the record's structural shape (presence/absence of optional fields, choice of commitment scheme); verifiers detect the posture from the record's bytes.

2. **[§8.1](atrib-spec.md#81-default-posture) Default posture.** Plain SHA-256 hashes for args/result, millisecond timestamps, verbatim tool_name strings. Maximum auditability. The current v1 default. No record changes.

3. **[§8.2](atrib-spec.md#82-opaque-name-posture) Opaque-name posture.** `tool_name` MAY be an opaque label or a hash. Allowed forms: (a) `sha256:<hex>` to indicate a hashed name (verifier knows mapping if configured), (b) opaque labels matching `[a-z0-9_-]{1,64}` with no required mapping. Verifier surfaces the form verbatim and indicates `tool_name_form: "opaque" | "hashed" | "verbatim"`.

4. **[§8.3](atrib-spec.md#83-salted-commitment-posture) Salted-commitment posture.** `args_hash` and `result_hash` MAY use salted commitments. Salt is per-record random (≥16 bytes). Two commitment schemes defined: `salted-sha256` (`H(salt ‖ canonical_bytes)` with salt revealed in a sibling field `args_salt` / `result_salt`), and `hmac-sha256` (`HMAC(key, canonical_bytes)` with key kept private). Verifier indicates `args_commitment_form: "plain-sha256" | "salted-sha256" | "hmac-sha256"`.

5. **[§8.4](atrib-spec.md#84-coarsened-timing-posture) Coarsened-timing posture.** `timestamp_ms` MAY be rounded. Allowed granularities: millisecond (default), second (×1000), minute (×60000), hour (×3600000), day (×86400000). Granularity is encoded by the timestamp value itself; a value of 1743850000000 is millisecond-precise; a value of 1743849600000 (rounded to minute) is minute-precise. Verifier indicates `timestamp_granularity: "ms" | "s" | "min" | "h" | "d"` derived from value structure (trailing-zero analysis).

6. **[§8.5](atrib-spec.md#85-combined-postures) Combined postures.** Harnesses MAY combine postures freely. A record may use opaque tool_name with salted commitments and minute-granularity timestamps. The verifier reads each posture independently; they compose without interaction.

7. **[§8.6](atrib-spec.md#86-threat-model) Threat model.** A normative subsection enumerates what an adversary learns under each posture combination. Includes worked examples (default posture: full content fingerprintable; opaque + salted + minute: only structural and identity claims observable).

8. **Posture selection is a harness concern.** [§7](atrib-spec.md#7-harness-integration-patterns) (Harness Integration Patterns) gains a "Privacy posture selection" subsection explaining how to pick a posture for a given consumer (high-audit B2B → defaults; consumer-facing app → opaque + salted + minute; etc.).

**Alternatives considered.**

1. _Keep all privacy mitigations harness-only; no spec changes._ Rejected because three of the leaky fields are required by current spec. Harnesses cannot mitigate without breaking spec compliance. Privacy must be a normative concept.

2. _Single configurable "privacy mode" enum on each record._ Rejected because privacy postures are independent (tool_name, commitments, timing). A single enum forces bundles that may not match consumer needs. Independent posture fields compose better.

3. _Mandatory privacy by default; downgrade opt-in._ Rejected because changing v1 default breaks existing tooling and corpus. Additive posture options preserve the default and allow opt-in.

4. _Defer privacy postures to a v1.1 spec._ Rejected because the gap is concrete now. The substrate's brand promise depends on configurable disclosure being a normative property. Pre-public, additive optional changes are essentially free.

5. _Use zero-knowledge commitments (Pedersen, KZG) for args/result._ Rejected as v1 spec material. ZK schemes have meaningful complexity and ecosystem dependency. They MAY be added as additional commitment schemes in [§8.3](atrib-spec.md#83-salted-commitment-posture) in future revisions; the spec defines the extensibility shape now.

**Consequences.**

- _Spec._ New [§8](atrib-spec.md#8-privacy-postures) section with five subsections defining the postures and threat model. [§1.2](atrib-spec.md#12-the-attribution-record) field definitions updated to allow the alternate forms (tool_name forms, optional salt/key fields). [§7](atrib-spec.md#7-harness-integration-patterns) gains posture-selection subsection.
- _`@atrib/mcp`._ Record type gains optional `args_salt`, `result_salt` fields. Signing/verification updates to detect commitment scheme from record shape. Helpers for each posture: `recordOptions.toolNameForm: "verbatim" | "opaque" | "hashed"`, `recordOptions.commitmentScheme: "plain-sha256" | "salted-sha256" | "hmac-sha256"`, `recordOptions.timestampGranularity: "ms" | "s" | "min" | "h" | "d"`.
- _`@atrib/verify`._ Verification output indicates the posture detected per record. Threat-model implications surfaced as informational warnings (not verification failures).
- _Conformance._ `spec/conformance/8/` corpus exercises each posture combination. Verifier MUST correctly detect posture from record bytes.

**What this DOESN'T solve.**

- _Identity privacy._ `creator_key` is required and discloses the agent's stable identity. The [§6](atrib-spec.md#6-key-directory) directory may resolve creator_key to a real-world identity claim. Identity privacy requires a different mechanism (key rotation, per-conversation derivation) addressed in [D033](#d033-key-rotation-and-revocation) and the deferred [D038](#d038-per-conversation-key-derivation).
- _Linkage privacy._ `informed_by` and `provenance_token` disclose the agent's claimed reasoning composition. This is the structural disclosure that makes auditability work. Harness-layer mitigations (commitment-and-reveal patterns) are documented in [§7](atrib-spec.md#7-harness-integration-patterns).
- _Metadata privacy of the log itself._ The log entry ([§2.3.1](atrib-spec.md#231-entry-serialization)) discloses creator_key, context_id, timestamp, event_type byte even when the record content uses high-privacy postures. Mitigating this requires log-level changes outside this ADR's scope.

**Implementation sequencing.** Spec [§8](atrib-spec.md#8-privacy-postures) drafted → [§1.2](atrib-spec.md#12-the-attribution-record) field definitions updated → `@atrib/mcp` posture detection + helpers → `@atrib/verify` posture surfacing → conformance corpus generation → [§7](atrib-spec.md#7-harness-integration-patterns) posture-selection subsection.

## D046: Positioning lock for what atrib chains and does not chain

**Date:** 2026-04-28
**Status:** Accepted

**Context.** "Verifiable agent actions" implies the substrate certifies a complete picture of what an agent did. atrib's actual claims are narrower: identity, ordering, structural causation. Without explicit positioning, consumers may infer atrib certifies things it does not (causation that A's output influenced B's input; truthfulness of the agent's reasoning; reality of the tool's response).

The positioning needs to be visible in the spec, README, and per-package READMEs in lockstep. Pre-public, this is essentially free work that prevents brand mismatch.

**Decision.**

1. **New spec subsection in [§3](atrib-spec.md#3-graph-query-interface) (Graph Query Interface)** titled "What atrib chains, what it does not." Lists the structural axes atrib certifies (identity, per-session ordering, cross-session sameness via session_token, cross-session causal anchoring via provenance_token, agent-claimed reasoning composition via informed_by) and the gaps atrib does NOT certify (causation that prior records influenced subsequent decisions; truthfulness of the agent's reasoning claims; reality of tool responses absent tool-side attestation).

2. **Spec [§0](atrib-spec.md#0-foundations) abstract update** to use the locked positioning. Headline stays "Verifiable agent actions." Sub-line stays "Every action becomes signed context for the next." Tagline stays "Agents that reason from a past they can prove." A new sentence in the abstract clarifies: "atrib certifies who acted, what they did, when, in what order, and what the agent claims informed each action. atrib does not certify the agent's reasoning is truthful or that prior records influenced subsequent decisions; only that the claims were signed."

3. **README and per-package README updates.** Each surface gets a one-paragraph "What atrib chains, what it does not" block (or link to the spec subsection) so consumers reading any entry point see the same posture.

4. **No protocol or code changes.** This ADR is a documentation-only decision.

**Alternatives considered.**

1. _Leave positioning ambient and let consumers infer from the spec body._ Rejected because the spec body uses precise language that consumers may not parse fully. Explicit positioning is cheap and removes ambiguity.

2. _State the limits in the README only._ Rejected because the spec is the authoritative reference; positioning belongs there too. README-only would create drift risk.

3. _Add a separate "Limitations" document._ Rejected because the limitations are not a separate concern; they are part of the substrate's positive definition. Splitting them invites readers to skip the limitations doc.

**Consequences.**

- _Spec._ [§0](atrib-spec.md#0-foundations) abstract update. New [§3](atrib-spec.md#3-graph-query-interface) subsection (positioning lock). Cross-references from [§1.1](atrib-spec.md#11-normative-requirements-language) (normative requirements language) to the positioning subsection.
- _README.md._ New section after the introductory paragraph: "What atrib chains, what it does not" mirroring the spec subsection.
- _Per-package READMEs._ `packages/mcp/README.md`, `packages/agent/README.md`, `packages/verify/README.md`, `packages/cli/README.md`, `services/log-node/README.md`, `services/graph-node/README.md` all gain the positioning block (or a link to the spec subsection).
- _ARCHITECTURE.md._ Trust model section gains explicit limit statement.

**What this DOESN'T solve.**

- _Future consumer misreadings._ Positioning lock prevents the most common misreadings; it does not prevent all of them. Continued consumer-facing communication is a brand discipline, not a spec property.
- _Drift across surfaces._ Doc propagation requires discipline. CLAUDE.md sync triggers ([D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern) in cross-reference, also: this ADR triggers a positioning-block sync trigger) catch drift on subsequent edits.

**Implementation sequencing.** Spec [§0](atrib-spec.md#0-foundations) abstract + new [§3](atrib-spec.md#3-graph-query-interface) positioning subsection → README block → per-package README blocks → ARCHITECTURE.md trust model update → CLAUDE.md sync trigger registration.

## D047: Harness-side reasoning chains as informative [§7](atrib-spec.md#7-harness-integration-patterns) pattern

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D045](#d045-privacy-postures-normative-spec-section)'s "verifiable agent actions in proper context" framing requires reasoning auditability for the brand promise to be substantively honest. Promoting a `reasoning_step` URI to atrib normative (Path 2 from prior session discussion) fails [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)'s indicator 4: reasoning shapes vary too much across harnesses (ReAct, CoT, scratchpad, multi-agent debate, plan-and-execute) for any single shape to be observably canonical.

The right layer for reasoning chains is the harness, not the protocol. Consumers mint extension URIs in their own namespaces (e.g., `https://example.com/v1/types/reasoning_step`) and link them via `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). atrib's substrate makes this possible without standardizing what reasoning _is_.

[§7](atrib-spec.md#7-harness-integration-patterns) (Harness Integration Patterns) already exists in the spec as informative material. Adding a "Harness-side reasoning chains" subsection demonstrates the pattern concretely without elevating it to normative.

**Decision.**

1. **New [§7](atrib-spec.md#7-harness-integration-patterns) subsection titled "Harness-side reasoning chains."** Informative content showing how a harness mints an extension URI (e.g., `https://example.com/v1/types/reasoning_step`), emits records carrying the URI alongside `tool_call` records, links them via `informed_by`, and exposes them through recall-style consumer surfaces.

2. **Trust boundary statement is mandatory.** The subsection states plainly: "reasoning records live outside atrib's normative trust boundary. They prove the harness emitted these bytes. They do NOT prove the LLM actually reasoned this way." This sentence preserves the trust boundary and MUST NOT be removed in subsequent edits without a successor ADR.

3. **No normative claims.** The pattern is illustrative. atrib does not bless any specific reasoning predicate. Consumers may adopt the pattern, vary it, or replace it with their own.

4. **Cross-reference to [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) + [D043](#d043-extension-uri-participation-in-graph-derivation).** The pattern depends on `informed_by` (linking primitive) and extension URI graph participation ([D043](#d043-extension-uri-participation-in-graph-derivation)). The subsection cross-references both.

5. **Companion [§7](atrib-spec.md#7-harness-integration-patterns) subsection: "Outcome verification patterns."** Documents two opt-in patterns for closing the outcome-linkage gap: (a) tool-side response signing (the tool signs responses; the agent records signed-response-hash in `result_hash`), (b) external witness records (downstream observation references external proof such as a chain transaction ID). Same informative-not-normative posture.

**Alternatives considered.**

1. _Promote `reasoning_step` to atrib normative URI._ Rejected per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) indicator 4 (not observably canonical) and privacy concerns (prompt/response hash fingerprinting).

2. _Document the pattern in a separate guide outside the spec._ Rejected because [§7](atrib-spec.md#7-harness-integration-patterns) is the right place: it already exists as informative-pattern content, and consumers reading the spec find the pattern in context.

3. _No documentation; let consumers discover the pattern._ Rejected because discoverability is poor and the trust boundary statement is critical to get right. Spec-level documentation prevents misuse.

**Consequences.**

- _Spec._ [§7](atrib-spec.md#7-harness-integration-patterns) gains "Harness-side reasoning chains" subsection ([§7.5](atrib-spec.md#75-harness-side-reasoning-chains)) and "Outcome verification patterns" subsection ([§7.6](atrib-spec.md#76-outcome-verification-patterns)). Both informative.
- _`@atrib/agent`._ No code change. Adapters already support extension URIs; the documented pattern uses existing primitives.
- _`packages/recall` (when the package ships)._ Reference implementation includes a reasoning-chain example in `packages/integration/examples/recall-with-reasoning/` to make the pattern concrete.

**What this DOESN'T solve.**

- _Cross-consumer reasoning predicate convergence._ Multiple consumers minting different reasoning URIs do not auto-converge. If usage establishes convergence over time, [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) may promote to atrib normative; until then, each consumer's URI is its own.
- _Trust of the LLM's reasoning._ The pattern proves the harness emitted reasoning bytes signed under a key. It does not prove the LLM's reasoning was truthful or coherent. That is a different evaluation layer.
- _Privacy of reasoning content._ Reasoning records may carry hashes of prompts/responses, which leak fingerprints. Consumers wanting privacy use the salted-commitment posture ([D045](#d045-privacy-postures-normative-spec-section)) on reasoning record hashes.

**Implementation sequencing.** Spec [§7.5](atrib-spec.md#75-harness-side-reasoning-chains) + [§7.6](atrib-spec.md#76-outcome-verification-patterns) written → reference example added when the recall package ships.

## D048: Plug-and-play enforcement contract for adapters

**Date:** 2026-04-28
**Status:** Accepted

**Context.** atrib's value proposition depends on minimal agent involvement. An agent author should not need to remember which fields to populate, which event types to emit, which tokens to propagate, or how to derive edges. The substrate should be plug-and-play across all event types, all edge types, and all framework adapters (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain, raw MCP SDK, future frameworks).

The introduction of `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)), `provenance_token` ([D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)), observation graph participation ([D042](#d042-lift-observation-graph-participation-restriction)), and extension URI participation ([D043](#d043-extension-uri-participation-in-graph-derivation)) expands what middleware can and should automate. The contract for what's automatic vs. agent-explicit needs to be specified so adapter implementations stay consistent across frameworks.

**Decision.**

1. **Adapter conformance contract.** A conformant atrib adapter MUST:
   - **(C1)** Auto-sign every record with the configured creator_key.
   - **(C2)** Auto-populate `chain_root` from internal autoChain state (parent record's hash).
   - **(C3)** Auto-emit `tool_call` records on tool invocation through the host framework's tool-call path.
   - **(C4)** Auto-emit `transaction` records when canonical payment patterns (x402, ACP, UCP, AP2, MPP) are detected by the protocol adapter.
   - **(C5)** Auto-track inbound records consumed by the agent (tool results, observations, inbound provenance) in a context tracker.
   - **(C6)** Auto-populate `informed_by` on subsequent record emissions from the context tracker, with deterministic ordering.
   - **(C7)** Auto-emit `provenance_token` on canonical subagent-spawn patterns (host framework's subagent-creation API).
   - **(C8)** Accept agent-provided overrides via `recordOptions` for `informedBy`, `provenanceToken`, `publishProvenance`, posture options ([D045](#d045-privacy-postures-normative-spec-section)), and other fields.
   - **(C9)** Validate URI format for extension event_types per [§1.4.5](atrib-spec.md#145-event_type-uri-validation).
   - **(C10)** Honor degradation contract per [§5.8](atrib-spec.md#58-degradation-contract) (catch all failures; never throw to caller).

2. **Patterns the adapter MAY auto-handle but is not required to.** Workflow handoff, webhook reception, async event chains. These require application-level intent that the middleware cannot infer reliably; explicit opt-in via `recordOptions` is the documented path.

3. **Patterns the agent MUST handle explicitly.** Recording observations (the agent decides what to witness), choosing extension URIs (consumer namespace by design), choosing privacy posture per record ([D045](#d045-privacy-postures-normative-spec-section)), claiming `informed_by` overrides for records consumed via side channels.

4. **Adapter conformance test suite.** A new `packages/agent/test/conformance.test.ts` exercises each contract item. New adapters MUST pass the conformance suite before being added to the supported-frameworks table.

5. **Adapter authoring guide.** `packages/agent/CONTRIBUTING.md` (or equivalent) documents the contract and provides a template implementation. Future adapters follow the template.

**Alternatives considered.**

1. _No formal contract; document each adapter individually._ Rejected because consistency matters. A consumer using two different framework adapters expects the same observable behavior; a per-adapter contract drifts.

2. _Make every contract item the agent's responsibility._ Rejected because plug-and-play is the value proposition. Pushing fields and edge derivation to the agent defeats the substrate's purpose.

3. _Make every pattern auto-handled (including handoff, webhook)._ Rejected because the middleware cannot reliably infer application intent. False auto-emissions are worse than missing ones (they create incorrect graph edges).

**Consequences.**

- _`@atrib/agent`._ Existing adapters audited against the contract; gaps closed in subsequent work. New context tracker (C5, C6) added to the middleware. New test file for conformance.
- _Spec._ [§5.4](atrib-spec.md#54-atribagent-agent-middleware) (adapter section) updated to reference the contract. [§5.7](atrib-spec.md#57-automation-triggers-normative) (Automation Triggers) extended with the new auto-emissions.
- _Documentation._ Contract published in `packages/agent/README.md` adapter table. Adapter authoring guide added.

**What this DOESN'T solve.**

- _Adapters built by third parties._ atrib does not control third-party adapter quality. The conformance test suite is published; users of third-party adapters can run it.
- _Frameworks that don't expose a tool-call interception point._ For frameworks where wrapping the tool path is impossible, the adapter cannot satisfy C3. Such frameworks fall back to manual emission with reduced auto-tracking.

**Implementation sequencing.** Contract documented in [§5.4](atrib-spec.md#54-atribagent-agent-middleware) + [§5.7](atrib-spec.md#57-automation-triggers-normative) → test suite skeleton in `packages/agent/test/conformance.test.ts` → existing adapters audited and gaps closed → CONTRIBUTING guide → conformance results table added to README.

## D049: Layered leak defense (regex + LLM-semantic + cloud audit + style guide)

**Date:** 2026-04-28
**Status:** Accepted

**Context.** Maintaining operator-state framing out of public protocol docs is a recurring class of cleanup work. Term-list audits are fundamentally upper-bounded by the auditor's imagination; a fixed-term cloud audit cannot anticipate new substitution patterns introduced by previous cleanup passes themselves. The recursion converges only when the audit becomes structural rather than literal.

A layered defense replaces the ad-hoc catch-up cycle with structural prevention. Four layers, each catching what the layer above misses, with a positive style guide as the source of truth that all layers reference.

**Decision.**

1. **Style guide as source of truth.** A prose style guide defines the _positive_ spec for what public prose may contain: present-tense decisions and rationale; no operator-state framing (numeric ordinals tied to internal plans, timestamps with hour-of-day precision, narrative attributions to specific actors, commit/session self-reference, references to private planning artifacts); cross-references to other ADRs by number, spec by section, code by file path only. The denylist becomes derivative; the style guide is primary.

2. **Layer A: Pre-commit regex check.** Local git hook running on `git commit`. Pattern-based regex catches generic shapes (numeric ordinals tied to plans; self-referential commit/session/pass language; time-of-day patterns; actor-narration patterns; references to private planning artifact and memory-store identifiers; references to subagent-process framing). Hook blocks commit on flag; can be bypassed with `--no-verify` for emergency override.

3. **Layer B: Pre-push LLM-semantic audit.** Local git hook running on `git push`. Sends the diff to a hosted LLM API (free-tier model) with a prompt that asks "does this prose contain operator state, internal-process framing, or anything that doesn't belong in a public protocol spec?" Reads API credentials from local configuration. Blocks push on flag; can be bypassed with explicit override flag.

4. **Layer C: Cloud audit backstop.** A weekly remote audit runs against the public repo and includes the regex patterns from Layer A plus the LLM-semantic check from Layer B. Catches drift, regression after history rewrites, anything missed locally.

5. **Layer D: Documentation.** A leak-class catalog and audit-procedure document cross-references the four layers and is updated as new leak classes are discovered. The style guide and this document together form the prevention reference.

6. **Implementation sequencing.** Style guide drafted first (defines what the regex/LLM check against). Then Layer A (regex hook; cheap, fast, catches the common shapes). Then Layer B (LLM hook; catches the spirit). Then Layer C update (cloud audit gains the new patterns). Each layer is independently useful; the combination is what makes the defense robust.

**Alternatives considered.**

1. _Continue per-wave term-list expansion._ Rejected because each wave introduces new substitution patterns that future waves must catch. The recursion converges only when the audit becomes structural rather than literal.

2. _LLM-semantic check at the cloud audit only (no local hooks)._ Rejected because catching leaks after they've been live in main for a week is much worse than catching them before push. Local hooks give immediate feedback.

3. _Regex check only; no LLM check._ Rejected because regex catches known shapes; LLM catches new categories. The combination handles both.

4. _Use Anthropic API for the LLM check (consistent with Claude Code's primary provider)._ Rejected per cost. A free-tier hosted LLM is available via the operator's existing model-provider configuration; reuse the same path here. The check is run frequently (every push), so cost accumulates.

5. _Mandatory hook installation; no opt-out._ Rejected because emergency overrides are sometimes needed (e.g., fixing a hook itself). Documented overrides with audit-log entry.

**Consequences.**

- _Documentation artifacts._ New prose style guide. Updated leak-class catalog with the four-layer defense.
- _atrib (public repo)._ New `.git-hooks/pre-commit` and `.git-hooks/pre-push` scripts (committed for transparency; users opt in via `git config core.hooksPath .git-hooks`). New `scripts/check-leaks.mjs` (regex check) and `scripts/check-leaks-semantic.mjs` (LLM check).
- _Cloud routine._ The weekly audit gains the new regex patterns and LLM-check step.

**What this DOESN'T solve.**

- _Operator override misuse._ `--no-verify` bypasses the hooks. The override is logged but not enforced. Discipline is required.
- _Hosted LLM availability._ If the API is unavailable, Layer B fails open (push proceeds). The cloud audit (Layer C) catches what Layer B missed.
- _Style guide drift._ The style guide itself can grow stale. Quarterly review (manual) checks alignment.

**Implementation sequencing.** Style guide drafted → regex check script + pre-commit hook → LLM check script + pre-push hook → cloud audit update → documentation cross-reference.

## D050: Cross-log replication for equivocation defense

**Date:** 2026-04-28
**Status:** Accepted

**Context.** atrib's [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) witnessing protocol distributes trust in checkpoints across multiple operator-independent witnesses. A single log operator cannot equivocate (publish different checkpoint roots to different parties) without witnesses noticing. But [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) is a CHECKPOINT-LEVEL defense: it secures the root, not the records the root commits to. A log operator can still:

- Selectively censor records (refuse to commit them while returning success to the submitter)
- Equivocate at the record level (commit a record to position N for one viewer and a different record to position N for another) when collusion with witnesses is possible
- Lose data after commitment (operator failure or attack)

The strongest defense against operator-level threats is independent replication: the same record committed to multiple operator-independent logs, with verifiers consulting more than one. This is how Certificate Transparency works in practice (browsers require SCTs from multiple CT logs for EV certificates). atrib has the same threat model and benefits from the same defense.

**Decision.**

1. **Records MAY be replicated to multiple atrib-conformant logs.** No protocol-level mandate; consumers wanting cross-log confidence opt in by submitting to N logs.

2. **Each replication produces an independent inclusion proof.** Logs do not coordinate; each treats the submission as a fresh entry. The record's bundle ([§2.8](atrib-spec.md#28-proof-bundle-format)) carries a list of `(log_id, checkpoint, inclusion_proof)` tuples instead of a single tuple.

3. **Verifier consults the configured threshold.** A verifier configured with a list of trusted log operators requires inclusion proofs from at least M of N expected logs (M is consumer policy; default M=1 means single-log behavior preserved). Inclusion proofs from logs not in the trusted list are surfaced but do not count toward M.

4. **Equivocation detection.** If a record bundle carries proofs from multiple logs, and the logs return different content for the same record_hash, the verifier MUST reject the record and flag the discrepancy. This is the equivocation signal.

5. **Log identity.** Each log publishes a stable identifier (`log_id`) derived from its origin string per [§2.4](atrib-spec.md#24-checkpoint-format). The proof bundle entries reference this identifier. Verifiers cross-reference the identifier against a trust configuration.

6. **Cross-log replication is OPTIONAL.** Default-posture submissions to a single log remain valid. Cross-log replication is a robustness enhancement consumers adopt as their threat model requires.

**Alternatives considered.**

1. _Mandate cross-log replication for all records._ Rejected as adoption barrier. Single-log deployments are valuable; the mandate would block them.

2. _In-protocol cross-log gossip._ Rejected as protocol surface bloat. Logs do not coordinate at the protocol level; replication is consumer-side.

3. _Witnessing alone is sufficient._ Rejected because witnessing secures the checkpoint root, not record-level censorship by the operator. Cross-log replication addresses a strictly broader threat.

**Consequences.**

- _Spec._ New [§2.11](atrib-spec.md#211-cross-log-replication) "Cross-log replication" subsection. [§2.8](atrib-spec.md#28-proof-bundle-format) (proof bundle format) extended to allow a list of `(log_id, checkpoint, inclusion_proof)` tuples instead of a single tuple. [§2.4](atrib-spec.md#24-checkpoint-format) (checkpoint format) gains a normative `log_id` field referenced by replication.
- _`@atrib/mcp`._ Submission API gains `submitToLogs: LogConfig[]` option. Default behavior unchanged.
- _`@atrib/verify`._ Verification gains `cross_log_proof_count` and `cross_log_threshold_met` outputs. Equivocation detection MUST reject records when cross-log discrepancies are observed.
- _services/log-node._ No log-side changes; logs are oblivious to replication. Verifier-side does the work.
- _Conformance._ `spec/conformance/2.11/` corpus exercises cross-log proof bundles, threshold checks, and equivocation detection.

**What this DOESN'T solve.**

- _Collusion across logs._ If all N logs collude, replication does not help. Trust diversity is the consumer's responsibility (pick logs operated by independent parties with different incentives).
- _Submission-time censorship._ If the submitter is denied service by some logs, the bundle has fewer proofs but is not detectable as malicious. Threshold M handles this gracefully (require fewer than total).
- _Record-level retroactive removal._ If a log removes a previously-committed record, verifiers consulting the log later see "record not found" but cannot prove the log is lying about its history. Witnessing ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures)) and cross-log replication together address this when at least one cooperative log retains the record.

**Implementation sequencing.** Spec [§2.11](atrib-spec.md#211-cross-log-replication) + [§2.8](atrib-spec.md#28-proof-bundle-format) + [§2.4](atrib-spec.md#24-checkpoint-format) update → `@atrib/mcp` submission API extension → `@atrib/verify` cross-log proof verification → operator documentation on running multi-log deployments → conformance corpus.

## D051: Capability-scoped records via directory-published envelopes

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [§6](atrib-spec.md#6-key-directory) (key directory) resolves an opaque `creator_key` to an identity claim ("this key belongs to Acme Corp's official agent, attested by domain DNS"). Identity attestation answers "WHO is this?" but not "WHAT IS THIS KEY ALLOWED TO DO?" A compromised but legitimately-attested key can sign any record; verifiers see a valid identity and have no static framework for spotting out-of-scope claims (e.g., a customer-service agent's key suddenly signing million-dollar transactions).

Capability scoping turns the static identity claim into a dynamic policy claim: the directory publishes the key's declared capability envelope (which tools, dollar amounts, counterparties, action types). Records can be checked against the envelope; out-of-envelope records are flagged as suspect. This is structurally analogous to how OAuth scopes constrain what a token can do, applied at the signed-record level.

**Decision.**

1. **Identity claim format ([§6](atrib-spec.md#6-key-directory)) gains an OPTIONAL `capabilities` field.** Format:

   ```
   {
     "creator_key":    "...",
     "claim_type":     "domain_verified",
     "claim_method":   "...",
     "capabilities":   {
       "tool_names":    ["search", "browse", "read_email"],   // optional allowlist; absent = no constraint
       "max_amount":    { "currency": "USD", "value": 1000 }, // optional cap on transaction amounts
       "counterparties": ["acme.com", "verified.example"],   // optional allowlist of transaction counterparties
       "event_types":   [                                     // optional allowlist of event_type URIs
         "https://atrib.dev/v1/types/tool_call",
         "https://atrib.dev/v1/types/observation"
       ],
       "expires_at":    1761000000000                         // optional; envelope rotates with the identity claim
     }
   }
   ```

2. **All capability fields are optional.** An identity claim without `capabilities` declares no scope; this is equivalent to "any action this key signs is in-envelope." Adding the field narrows the scope.

3. **Verifier checks records against the active capability envelope at signing time.** The active envelope is the most recent identity claim published before the record's `timestamp` ([§6](atrib-spec.md#6-key-directory) directory history is timestamped). Records signed under a key whose declared `tool_names` does not include the record's tool_name are flagged with `out_of_capability_envelope: true`.

4. **Out-of-envelope is a SIGNAL, not invalidation.** Records remain cryptographically valid (signature verifies, log inclusion verifies). The envelope-check output is a verifier annotation that consumers use in their trust assessment. Defaulting to invalidation would break common cases (envelope updates, tool-rename migrations) and is the wrong layer for enforcement.

5. **Envelope rotation follows identity-claim publication.** When a key's capabilities change, the operator publishes a new identity claim with the updated envelope. The directory history ([§6.2](atrib-spec.md#62-directory-operations)) preserves prior envelopes; verifiers checking historical records use the envelope active at the record's timestamp.

6. **No protocol-level enforcement.** atrib does not block out-of-envelope submissions or refuse to commit them. Enforcement is consumer policy at the verification layer.

**Alternatives considered.**

1. _Per-record `declared_capability` field instead of per-key envelope._ Rejected as field bloat and as harder for verifiers to validate (each record's declaration would be self-asserted; the envelope-as-published model lets a separate publication channel constrain claims).

2. _Mandatory envelopes for all identity claims._ Rejected as adoption barrier. Capability declaration is optional; consumers wanting it adopt it.

3. _Hard rejection of out-of-envelope records._ Rejected as too brittle for real-world envelope evolution and operator error. Signal-not-block is the right granularity.

4. _Envelope encoded in the record itself rather than the directory claim._ Rejected because envelope-in-record is self-asserted (the key author writes their own constraints); envelope-in-directory ties the constraint to the identity claim's separate publication channel, which is harder for an attacker compromising the key alone to forge.

**Consequences.**

- _Spec._ New [§6.7](atrib-spec.md#67-capability-declarations) "Capability declarations" subsection. [§6.1](atrib-spec.md#61-identity-claim-format) (identity claim format) extended with optional `capabilities` field.
- _`@atrib/cli`._ `atrib publish-claim --capabilities <file.json>` lets operators declare envelopes when publishing.
- _`@atrib/verify`._ Verification output gains `capability_check: { envelope: CapabilityEnvelope | null, in_envelope: bool, mismatches: string[] }` per record.
- _services/directory-node._ Directory publishes capability fields in identity claims; lookup returns them. No new endpoints required.
- _Conformance._ `spec/conformance/6.7/` corpus exercises capability declaration, envelope rotation, and out-of-envelope detection.

**What this DOESN'T solve.**

- _Coordinated compromise._ An attacker who compromises both the signing key AND the publication channel for identity claims can publish an updated envelope that whitelists the attacker's intended actions. Mitigation: identity-claim publication should be on a different operational footing than agent operation (e.g., manual re-publication on a hardware-isolated key).
- _Capability enforcement at signing time._ atrib does not refuse to sign out-of-envelope records; the envelope is a verifier-side annotation. Consumers wanting signing-time enforcement build it into their middleware.
- _Granular field-level constraints._ The envelope schema is intentionally narrow (tool_names, max_amount, counterparties, event_types). More granular constraints (e.g., "only between 9-5 PM UTC") are out of scope; consumers needing them publish a separate policy document and check externally.

**Implementation sequencing.** Spec [§6.7](atrib-spec.md#67-capability-declarations) + [§6.1](atrib-spec.md#61-identity-claim-format) update → `@atrib/cli` envelope publication command → `@atrib/verify` envelope check → directory-node serves capabilities in lookup → conformance corpus → integration test exercising envelope rotation.

## D052: Cross-attestation requirement for transaction records

**Date:** 2026-04-28
**Status:** Accepted

**Context.** Transaction records (`event_type = https://atrib.dev/v1/types/transaction`) are the highest-stakes record type in atrib: they are the record the [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation is normatively gated on. A single agent unilaterally signing a transaction record makes a cryptographically valid claim that "this transaction occurred for this amount with this counterparty", without independent corroboration. An attacker who compromises one signing key can fabricate transactions out of thin air.

Other record types tolerate single-signer claims more gracefully because their downstream consequences are smaller (a tool_call's claim affects only attribution shares; a transaction's claim affects actual settlement). For the highest-consequence type, requiring more than one signer is structurally appropriate.

**Decision.**

1. **Transaction records MUST carry a `signers` field listing the public keys of all attesting parties.** Format:

   ```
   "signers": [
     { "creator_key": "agent-key-base64url",        "signature": "..." },
     { "creator_key": "counterparty-key-base64url", "signature": "..." }
   ]
   ```

   The legacy `signature` field at the top level is OPTIONAL on transaction records and SHOULD be omitted when `signers` is present. When `signature` IS present alongside `signers`, the top-level signature is treated as an additional signer entry from the same `creator_key` (informational; not double-counted).

2. **Minimum signer requirement: 2.** The atrib normative minimum for transaction records is 2 signers: the agent that initiated the transaction AND the counterparty (typically the merchant or settlement party). Records with fewer signers are flagged as `cross_attestation_missing: true`.

3. **Each signer's signature covers the same canonical bytes.** All signatures in `signers` cover the same JCS-canonical record (with the `signers` array empty for the canonicalization). The verifier confirms each signature against the corresponding public key.

4. **Counterparty discovery and key exchange.** Counterparty keys are discovered out-of-band: via the directory ([§6](atrib-spec.md#6-key-directory)) lookup of the merchant's published identity, via payment-protocol-specific channels (x402 facilitator metadata, ACP order envelope, etc.), or via consumer-arranged key exchange. atrib does not specify the discovery mechanism; the spec only requires the keys be present in the record.

5. **Other event types unaffected.** tool_call, observation, and extension records continue to use single-signer signatures via the top-level `signature` field. [D052](#d052-cross-attestation-requirement-for-transaction-records) applies only to `transaction`.

**Alternatives considered.**

1. _Threshold signatures (M-of-N) for transactions._ Considered. The simpler 2-signer model covers the highest-frequency case (agent + merchant). M-of-N adds complexity (threshold key management, partial-signature aggregation) without proportionate gain at this stage. May revisit if usage establishes a multi-party need.

2. _Make cross-attestation OPTIONAL for transactions._ Rejected. Transactions are the [§4.6](atrib-spec.md#46-the-calculation-algorithm)-gated record type; the substrate's strongest robustness commitment belongs here. Optional weakens the guarantee.

3. _Apply cross-attestation to all record types._ Rejected as overhead for non-transaction records. The robustness gain is concentrated at the transaction layer.

4. _Use multi-signature schemes (Schnorr aggregation, BLS) instead of an explicit signers array._ Rejected as cryptographic complexity. The explicit-array form is auditable, debugable, and uses the same Ed25519 primitive as everywhere else in the spec.

5. _Canonicalize signing input by omitting `signers` entirely (rather than setting it to `[]`)._ Considered. Both forms are unambiguous and reproducible. The explicit `signers: []` form was chosen because it makes the canonical-input shape uniform regardless of whether the record carries the `signers` field or not (every transaction record produces the same signing-input shape: `signers:[]`, signature omitted). The omit-entirely alternative would create two canonical-input shapes (one for transaction records, one for everything else) that implementations would need to branch on. The explicit-empty form simplifies signing/verification logic without changing the security properties.

**Consequences.**

- _Spec._ New [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) "Cross-attestation requirement for transaction records" subsection. [§1.2](atrib-spec.md#12-the-attribution-record) record format note extended to clarify that transaction records use `signers` array. [§4.6.2](atrib-spec.md#462-step-1-identify-contributing-nodes) contributing-set check extended to flag cross-attestation status.
- _`@atrib/mcp`._ Transaction record signing path emits `signers` array. Counterparty signature is collected via `recordOptions.counterpartySignature: { creator_key, signature }` (the application supplies the counterparty's signature obtained out-of-band).
- _`@atrib/agent`._ Payment-protocol adapters ([§1.7](atrib-spec.md#17-transaction-event-hooks)) extended to coordinate counterparty signature collection from their respective protocols' settlement responses.
- _`@atrib/verify`._ Verification of transaction records extended to verify each signer's signature and to surface `cross_attestation: { signer_count, all_verified, missing_required }`.
- _Conformance._ `spec/conformance/1.7.6/` corpus exercises 2-signer transaction records, single-signer flagging, signer mismatch detection.

**What this DOESN'T solve.**

- _Counterparty collusion._ If the agent and merchant collude to fabricate a transaction, both sign and the cross-attestation passes. Cross-log replication ([D050](#d050-cross-log-replication-for-equivocation-defense)) and external evidence ([§7.6](atrib-spec.md#76-outcome-verification-patterns) Pattern B) help here.
- _Counterparty key compromise._ If the merchant's signing key is compromised, the attacker can sign as the merchant. Identity attestation ([§6](atrib-spec.md#6-key-directory)) and key revocation ([§1.9](atrib-spec.md#19-key-rotation-and-revocation)) help.
  **Implementation sequencing.** Spec [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) + [§1.2](atrib-spec.md#12-the-attribution-record) + [§4.6.2](atrib-spec.md#462-step-1-identify-contributing-nodes) update → `@atrib/mcp` transaction signing path extension → `@atrib/agent` payment-protocol adapter coordination → `@atrib/verify` multi-signature verification → conformance corpus.

## D053: Inclusion-proof aggregation (flagged for follow-up)

**Date:** 2026-04-28
**Status:** Flagged for follow-up; design subject to change

This ADR is a placeholder. It records that inclusion-proof aggregation has been considered and queued for future work, without committing to specific design details. When this ADR is formally written and the mechanism is implemented, the details below MAY change in any way; this entry documents the intent and the known-design-questions, not the final spec.

**Context.** [D050](#d050-cross-log-replication-for-equivocation-defense) (cross-log replication) and [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) (witnessing) defend against log-operator equivocation and selective censorship at the checkpoint level. A complementary mechanism, inclusion-proof aggregation, would defend at the record level: subsequent records cite the inclusion proofs of prior records, creating a web of mutual confirmation. If a log operator later removes or alters a referenced record, citing records still point at proof of the prior state.

**Sketch (subject to change).**

A new optional field `inclusion_proof_refs: [{ log_id, record_hash, checkpoint_root }, ...]` on records. Subsequent records cite the inclusion proofs of records they reference (via `informed_by` or `provenance_token` or chain). Verifiers MAY require that cited proofs resolve to records in the log; resolution failures are flagged.

**Why deferred.**

- The marginal robustness gain over [D050](#d050-cross-log-replication-for-equivocation-defense) (cross-log replication) plus [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) (witnessing) is real but smaller than the gain from those mechanisms individually.
- Sequencing is non-trivial: a record citing its parent's inclusion proof needs the parent to have been committed AND for a checkpoint covering it to have been published AND for that checkpoint to have been witnessed (depending on consumer policy). The chicken-and-egg patterns need careful design.
- Cross-log replication ([D050](#d050-cross-log-replication-for-equivocation-defense)) introduces multiple proofs per record; the citation field needs to specify which log(s) to cite.
- Field bloat: each record gains another reference list; storage and proof verification work scale.
- Adding a fourth robustness mechanism in the same session as [D050](#d050-cross-log-replication-for-equivocation-defense)-[D052](#d052-cross-attestation-requirement-for-transaction-records) increases interaction surface beyond what careful design supports.

**Known design questions for the formal ADR.**

1. Which proofs MUST be cited (parent only? all `informed_by` referents? all cross-session anchors?) versus MAY be cited.
2. How to handle cross-log replication: cite all logs' proofs, the trusted-set logs' proofs, or a single canonical log per record?
3. Sequencing: do citing records wait for witnessing, or accept un-witnessed checkpoint citations?
4. Storage and verification cost trade-offs at high record volumes.
5. Failure modes: how does a verifier surface "cited proof exists but doesn't verify against current checkpoint state"?

**Implementation sequencing.** None for now. When formally written: spec subsection (the original [§2.12](atrib-spec.md#212-record-body-archive-layer) slot is taken by [D070](#d070-record-body-archive-layer) Record Body Archive Layer; aggregation lands in §2.13 or as a [§2.11](atrib-spec.md#211-cross-log-replication) extension) → record format extension → verifier-side cross-checking → conformance corpus → operator guidance.

**Caveat on this entry.** Because this ADR is a placeholder, anything described above is a sketch, not a commitment. The formal ADR (when authored) will follow the standard format and may diverge from this placeholder in any technical detail. Cross-references to [D053](#d053-inclusion-proof-aggregation-flagged-for-follow-up) from other ADRs or the spec MUST treat the substance as forward-looking, not normative.

## D054: Unified public explorer (vs per-service admin UIs)

**Date:** 2026-04-29
**Status:** Accepted

**Context.** At the time of this decision, atrib's read-side data lived across three deployed services: log-node (entries + checkpoints + inclusion proofs), graph-node (graph queries derived from log entries), directory-node (identity claims + AKD proofs). All three serve public data per spec [§0](atrib-spec.md#0-foundations) ("anyone can verify"). None of them ships a human-readable inspection UI; the only interaction surface is JSON-over-HTTP designed for machine consumers (verifiers, agents, libraries). [D070](#d070-record-body-archive-layer) later added optional archive evidence as another read API for the same explorer surface.

The natural impulse is to add an admin/inspection UI to each service: a small HTML page on log-node, another on graph-node, another on directory-node. Each would let a human paste a record_hash / context_id / creator_key and see what the service knows about it.

This is the wrong shape. It produces three disconnected admin pages instead of solving the underlying "where do I look to see what's happening" problem. Humans understanding atrib activity care about the JOIN across the three services: "this record_hash was signed by THIS identity (directory) at THIS chain position (log) producing THESE graph edges (graph)." Three separate UIs force humans to do that join manually.

The right shape is a unified explorer that composes from the public read APIs. This is the same pattern Certificate Transparency (crt.sh), Sigstore (rekor.sigstore.dev), and Ethereum (Etherscan) use: individual logs/services don't ship UIs; one explorer composes from all of them.

**Decision.**

1. **No per-service inspection UIs.** log-node, graph-node, and directory-node MUST NOT ship inline admin/dashboard HTML. Their interfaces stay JSON-over-HTTP for machine consumers.

2. **A unified explorer ships separately.** A standalone surface composes from the public read APIs and presents the joined views humans actually want. The first five primary views were identity (anchored on `creator_key`), session (anchored on `context_id`), action (anchored on `record_hash`), anchoring (recent log checkpoints + directory anchors), and search (free-text resolving to identity / context / record). Later explorer iterations added demo and trace views, and [D070](#d070-record-body-archive-layer) added archive evidence to action receipts.

3. **Read-only and unauthenticated.** The explorer reads only public data. Adding an auth wall would (a) break the spec [§0](atrib-spec.md#0-foundations) "verifiable by anyone" promise, (b) be security theater (the underlying APIs are public anyway), and (c) create false-restriction perception. Read views stay open forever.

4. **Public explorer, not personal dashboard.** Visiting the explorer URL shows aggregate public data with search-by-anything. There is no concept of "logged-in user" in the explorer. A SEPARATE PRODUCT (a personal dashboard, auth-gated by signature-challenge proving control of a creator_key) may be added later for users actively managing their own atrib presence; that product is out of scope for this ADR and lives at a different URL.

5. **Three-stage build sequence.** The deployment strategy proceeds in three stages. First: a minimal single-page HTML (no build step, no framework) **served inline by log-node at `https://explore.atrib.dev/`** so the first stage doesn't introduce a second hosting platform. Second: a Vite/Next.js SPA with proper routing + components, deployed to its own hosting (likely Cloudflare Pages at `dashboard.atrib.dev` or `atrib.dev/dashboard`); at that point the inline log-node route either redirects to the SPA or stays as a backup. Third: a full block-explorer-grade surface with search indexing, real-time updates, embedded chain visualizations. The first stage ships immediately; the second follows when dogfood metrics produce useful results to display; the third follows the broader implementation work.

6. **CORS allowed on composed read endpoints.** `Access-Control-Allow-Origin: *` is set on log-node, graph-node, directory-node, and archive-node read endpoints so a browser-based explorer hosted from any origin can read the public APIs. The data is already public; CORS just makes browser-based composition possible.

7. **Future write actions require per-action auth.** If the explorer ever gains write actions (e.g., "publish an identity claim from the UI" instead of CLI), THOSE specific actions get authenticated per action, the read views stay open. This boundary is preserved through future iterations.

**Alternatives considered.**

1. _Per-service admin UIs._ Rejected as enumerated above. Three disconnected pages forces users to manually join across services. Conflates inspection (human surface) with API serving (machine surface) at the wrong layer.

2. _No inspection UI; just curl + scripts._ Rejected because the operator (and future users) need visibility into the system to debug and demo. Without a UI, the brand promise of "verifiable by anyone" is theoretical: humans see only JSON outputs, no holistic view. Block-explorer surfaces are the natural materialization of verifiability for human consumers.

3. _Build the personal dashboard now and skip the public explorer._ Rejected because public verifiability is structurally upstream of personal management. A personal dashboard without the explorer would mean users can manage their own data but external auditors/regulators/curious-parties have nothing to point at. The explorer comes first.

4. _Embed the explorer in the spec/docs site._ Rejected because they're different surfaces with different scopes. The docs site (operator intent, separate memory entry) is documentation. The explorer is operational data. Embedding either in the other creates conflation pressure as both grow.

**Consequences.**

- _Spec._ No spec changes for [D054](#d054-unified-public-explorer-vs-per-service-admin-uis) itself; the explorer reads from the existing [§2.5](atrib-spec.md#25-tile-api-read-interface) / [§3.4](atrib-spec.md#34-query-api) / [§6.2](atrib-spec.md#62-directory-operations) read APIs. CORS clarification can land in those sections as a normative note (`Access-Control-Allow-Origin: *` is the canonical setting for the read endpoints).
- _log-node, graph-node, directory-node, archive-node._ Composed read services set `Access-Control-Allow-Origin: *` headers on read endpoints (and OPTIONS preflight handling where needed). Tests confirm headers present.
- _Repo._ New `apps/dashboard/` directory ships the explorer source. Option 1 is a single HTML file with embedded CSS + vanilla JS (no build step). Options 2 and 3 will introduce a framework + build step when they're built.
- _Hosting._ Option 1 is served inline by log-node at `https://explore.atrib.dev/` (also at `https://log.atrib.dev/dashboard` for legacy direct access). The Dockerfile copies `apps/dashboard/index.html` into the image; the server reads it once at startup, caches in memory, and returns with `Cache-Control: public, max-age=60`. The "no per-service inspection UIs" rule (point 1 above) bans per-service ADMIN HTML, page-shaped, service-private surfaces. Serving the unified explorer from a service is materially different: log-node is acting as a static-file host for the cross-service surface, not exposing a service-specific admin. The host-based routing is explicit: when the request `Host` header is `explore.atrib.dev` the dashboard is returned at `/`; otherwise log-node returns API responses at `/v1/*` and a 404 hint at `/`. When option 2 (SPA) ships it will get its own hosting (likely Cloudflare Pages); the inline route stays as a fallback. **Naming rationale:** `explore` was chosen over `dashboard` so that `dashboard.atrib.dev` is reserved for the actual auth-gated personal dashboard product (separate memory entry); `explore` reads as block-explorer and avoids the "dashboard implies my-account" connotation.
- _CLAUDE.md._ New sync trigger: "Explorer view changes" → update apps/dashboard/ + verify CORS unchanged on the underlying services.

**What this DOESN'T solve.**

- _Personal dashboard._ Out of scope. Tracked separately as a future product item; needed before public outreach to users (not before).
- _Real-time updates._ Option 1 + 2 are pull-on-load; option 3 may add WebSocket or SSE for live updates.
- _Search indexing at scale._ Option 1 + 2 do client-side filtering against API responses. Option 3 may need a server-side search index when the log volume makes client-side impractical.
- _Internationalization._ Out of scope for option 1. Option 2/3 may add when the user base warrants.
- _Mobile responsiveness._ Option 1 is desktop-first (best-effort viewport). Option 2/3 should be properly responsive.

**Implementation sequencing.**

Option 1 (now): single HTML file at `apps/dashboard/index.html`; CORS added to the composed read services; log-node serves the HTML at `/dashboard`; Dockerfile bundles the file; deployed to https://explore.atrib.dev/. The explorer loads against production (`log.atrib.dev`, `graph.atrib.dev`, `directory.atrib.dev`, and optional `archive.atrib.dev`) by default with URL-param overrides for local services. Option 2 (when dogfood metrics are producing measurable signal): Vite/Next.js refactor of option 1's view components into a proper SPA; deploys to its own hosting (likely Cloudflare Pages). Option 3 (after the broader implementation work completes): full block-explorer-grade surface; search indexing, real-time updates, visualization. Personal dashboard tracks separately.

## D055: annotation / proposal / apply types stay as extension URIs (not promoted to atrib-normative)

**Date:** 2026-04-30
**Status:** Accepted

**Context.** A downstream consumer's observation subsystem emits records that semantically fall into three shapes beyond atrib's then-normative vocabulary: `annotation` (a per-observation note attached to an existing record), `proposal` (a cross-observation pattern suggesting a change), and `apply` (the act of executing an applied proposal). The shapes were originally raised as candidates for atrib-normative promotion when `event_type` was a closed enum (`tool_call` + `transaction` only). At that time the operator chose Path Y ("formally extend the atrib spec") over Path X ("collapse everything to `tool_call`"); `observation` was subsequently promoted to a third normative type as part of the [§1.2.4](atrib-spec.md#124-event_type-values) URI vocabulary migration.

The URI migration ([D035](#d035-extensible-event_type-vocabulary-via-uri-typing) + [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)) materially changed the proposal's shape. Under the URI vocabulary, extension URIs in any namespace already validate, sign, chain, and verify; they encode as `0xFF` (extension) in the [§2.3.1](atrib-spec.md#231-entry-serialization) log entry; they do not need any spec change to be used in the wild. The remaining decision was therefore whether to promote any of `annotation` / `proposal` / `apply` to atrib-normative, taking byte assignments and getting first-class treatment in conformance, in `@atrib/verify`, and in the explorer.

**Decision.** Keep all three as extension URIs in the consumer's own namespace (e.g., `https://example.com/v1/types/annotation`). Do NOT promote any of them to atrib-normative.

**Rationale.**

1. **The [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion bar is not cleared.** [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) requires multi-harness adoption AND structural-shape relevance to verifiers (not just operators). Only one harness currently uses these shapes; verifiers do not need to do anything different per type.

2. **Extension URIs already give the consumer everything it needs.** The records validate, sign, and chain identically. Extension URIs encode as `0xFF` in the binary entry; consumers reading the JSON record see the full URI, which is more informative than a single byte. Nothing about the consumer's actual workflow improves by switching to a normative byte.

3. **Normative vocabulary should stay small.** `tool_call`, `transaction`, `observation` cover the universal substrate of agent-to-tool interactions. `annotation` / `proposal` / `apply` are consumer-workflow-shaped: they describe a particular reasoning workflow rather than the universal substrate. Adding workflow-specific types to atrib's normative vocabulary would re-introduce the closed-enum problem the URI migration was designed to escape.

**Alternatives considered.**

1. _Promote all three as atrib-normative (taking byte assignments)._ Rejected. Single-harness adoption fails [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary). Would prematurely freeze a single consumer's vocabulary into atrib's spec without evidence that other harnesses converge on the same shape.

2. _Promote only `apply` (most generally-shaped)._ Rejected. Same reasoning. `apply` does have cross-harness potential (any agent that executes a previously-proposed change has the same shape), but no second harness has surfaced it yet. Reassess if a second independent harness adopts an `apply` URI of its own.

3. _Defer the decision indefinitely (status quo via silence)._ Rejected. The proposal had been open with no formal disposition. Recording the decision either way is better than letting it linger as ambiguous backlog state.

**Consequences.**

- _Spec._ No spec changes. [§1.2.4](atrib-spec.md#124-event_type-values) already accommodates extension URIs.
- _Consumer._ Continues using its own namespace URIs. No coordination with atrib spec maintainers required for vocabulary additions.
- _atrib explorer._ Extension-URI records render with their full URI string (not a normative type label). When a second harness adopts an `apply`-shaped type, revisit promotion via a fresh ADR.
- _Reopening criteria._ This decision is reopened automatically the moment a second independent harness uses the same URI shape (or an isomorphic one): i.e., the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar starts to clear. At that point write a new ADR; do not amend [D055](#d055-annotation-proposal-apply-types-stay-as-extension-uris-not-promoted-to-atrib-normative).

---

## D056: Promote `directory_anchor` to atrib-normative event_type (byte `0x04`)

**Date:** 2026-04-30
**Status:** Accepted

**Context.** [§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log) requires the directory operator to emit a `directory_anchor` record into the tlog after each operation, committing the directory's current root for downstream verifier consultation per [§6.3](atrib-spec.md#63-verifier-consultation-algorithm). The reference directory at `directory.atrib.dev` does this today: it signs records with `event_type: "https://atrib.dev/v1/types/directory_anchor"`. Until [D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04), the URI was not in the normative set, so [§2.3.1](atrib-spec.md#231-entry-serialization) required encoding it with `event_type = 0xFF` (extension). The explorer ([D054](#d054-unified-public-explorer-vs-per-service-admin-uis)) consequently labels these rows "extension," which is misleading: `directory_anchor` is atrib-system substrate behavior defined in the spec, not a third-party extension.

This labeling artifact is symptomatic of a real spec gap: the URI is normatively defined and its emission is normatively required, but it lacked a byte slot. Verifiers running [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 (AKD anchor consistency check) need to find directory_anchor records efficiently; without a byte slot, they have to read every extension record's content to decide whether it's a directory_anchor or some other extension URI.

**Decision.** Promote `https://atrib.dev/v1/types/directory_anchor` to atrib's normative event_type vocabulary. Allocate byte `0x04` in the [§2.3.1](atrib-spec.md#231-entry-serialization) log entry encoding. Reserved range narrows from `0x04`–`0xFE` to `0x05`–`0xFE`.

**Evaluation against [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).**

1. **Architecture-agnostic in practice.** Does NOT clear under the cross-category-adoption reading. Today the only emitter is atrib's own reference directory. This is the indicator that's weakest, but the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) text on indicator 4 explicitly admits "required by atrib protocol" as an alternative path, "rare and decisive." `directory_anchor` is the canonical example of that path.

2. **Structurally distinct from existing normative types.** Holds. `directory_anchor` is not a `tool_call` (no caller-supplied arguments, no MCP tool invocation). Not a `transaction` (no commerce protocol detection). Not an `observation` (the directory is not "perceiving its environment"; it is committing its own state). The closest neighbor is `observation`, but `observation` carries "the agent received this from outside"; `directory_anchor` carries "this service committed its internal state at this moment." Different semantic shape.

3. **Filterable benefit at the log-byte level.** Holds. [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 (AKD consistency check) is a real verifier query that needs all directory_anchor records for a given directory key. Without a byte slot, verifiers fetch the content of every `0xFF` entry from the directory's `creator_key` and parse the URI. With a byte slot, the same query is a byte filter on the binary entry.

4. **Required by atrib protocol.** Holds, decisively. [§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log) requires the emission. [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 requires consumption. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) graph derivation excludes `directory_anchor` from session edges (system commitments are not session participants). Three normative spec sections distinguish the type today.

5. **Promotion is non-disruptive.** Holds. The URI does not change. Existing directory_anchor records (signed before the byte allocation, encoded as `0xFF`) remain valid: the URI in the record content is the authoritative type per [§2.3.1](atrib-spec.md#231-entry-serialization)'s "byte mapping is a fast-path filter; the authoritative type is the URI." New records get the new byte. Verifiers wanting complete directory_anchor queries during the transition window filter by URI (always works) rather than by byte (works only for post-promotion records). Once the pre-promotion records age out of operational interest, byte filtering suffices.

Four of five indicators clear. Indicator 1 fails the literal cross-category reading but is moot because indicator 4's protocol-required branch holds, and [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) explicitly contemplates this case.

**Alternatives considered.**

1. _Leave as `0xFF` extension forever._ Rejected. The URI is in the atrib namespace and its emission is normatively required; encoding it identically to third-party extension URIs misrepresents the type and produces the misleading "extension" labeling in the explorer. Verifier filtering remains inefficient.

2. _Fix the explorer label only, no spec change._ Rejected as the standalone fix. The explorer fix lands separately ([D054](#d054-unified-public-explorer-vs-per-service-admin-uis) update) and is correct on its own, but it papers over the underlying byte-encoding misclassification rather than fixing it. Both fixes ship together.

3. _Promote in a batch with future system types (e.g., reserve `0x04`–`0x07` for "atrib system" types)._ Rejected. [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) explicitly rejects pre-allocation and tier systems. Each promotion gets its own ADR; the next system type that needs a byte gets the next byte (`0x05`) when its own promotion case clears.

4. _Re-encode pre-promotion records to update the byte from `0xFF` to `0x04`._ Rejected. The log is append-only; rewriting historical entries breaks immutability and inclusion proofs. The spec is explicit that the URI is the source of truth; transition-window mismatches are tolerable.

**Consequences.**

- _Spec ([§1.2.4](atrib-spec.md#124-event_type-values))._ Add `https://atrib.dev/v1/types/directory_anchor` to the normative URI table with byte `0x04` and a one-sentence semantic.
- _Spec ([§2.3.1](atrib-spec.md#231-entry-serialization))._ Add row `0x04 = https://atrib.dev/v1/types/directory_anchor`. Narrow reserved range to `0x05`–`0xFE`.
- _`packages/mcp/src/types.ts`._ Add `EVENT_TYPE_DIRECTORY_ANCHOR_URI` constant; include it in `NORMATIVE_EVENT_TYPE_URIS`.
- _`packages/mcp/src/entry.ts`._ Add `EVENT_TYPE_DIRECTORY_ANCHOR = 0x04`; update `eventTypeUriToByte` mapping; update doc comment.
- _`packages/verify/src/types.ts`._ Extend `EventType` union with `'directory_anchor'`; add case in `graphLabelFromEventTypeUri`. Graph nodes for directory_anchor records get the new short label.
- _`services/log-node/src/server.ts`._ Decoder labels byte `0x04` as `'directory_anchor'`. `/v1/stats` `entries_by_event_type` gains a `directory_anchor` count.
- _`services/graph-node`._ No code change required; the URI-to-label mapping flows through `@atrib/verify`'s helper.
- _`services/directory-node`._ No code change. Already emits the URI.
- _`apps/dashboard`._ Chip color and label flow naturally from the new short-label string. The `renderEventChip` "atrib system" fallback (added under [D054](#d054-unified-public-explorer-vs-per-service-admin-uis)) becomes redundant for directory_anchor records but stays as the safety net for any future atrib-system URI that lands before its own byte allocation.
- _Existing records._ Pre-promotion directory_anchor records (encoded `0xFF`) remain valid. Verifiers wanting complete queries filter by URI rather than byte for the transition window.
- _Conformance._ No `spec/conformance/2.3.1/` corpus exists yet. The spec change is small enough that the implementation tests in `packages/mcp/test/entry.test.ts` (existing) cover the regression risk; a corpus is a follow-up task if/when 2.3.1 gets formal vectors.

**Reopening criteria.** None. Promotion is irreversible (per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary): "atrib does not retire normative URIs; once promoted, they stay"). If the URI is later deemed unwise, it becomes deprecated (verifiers warn, accept) but never invalidated.

---

## D057: Pre-call signing hook (`preCallTransform`) for cross-tool causal embedding

**Date:** 2026-05-04
**Status:** Accepted

**Context.** [§5.3](atrib-spec.md#53-atribmcp-mcp-server-middleware) describes the middleware as signing AFTER the upstream tool returns and adding the propagation token to the response `_meta`. This ordering is correct for the universal case: latency stays off the tool's critical path, and a failed tool call never produces an orphan signed record.

A class of useful integrations needs the inverse ordering. When an MCP tool writes data to durable storage (e.g., a row in a database, a message on a queue, a record in an external API), and downstream consumers want to anchor their own `informed_by` references to the row produced by that call, the row needs to carry the atrib receipt_id at the moment of insert, not as a follow-up update after the row already exists. Concrete example: an MCP server that posts to a shared-context database. A second agent reading that row immediately after the post should be able to extract the receipt_id and use it as an `informed_by` anchor for its own emission, closing a cross-repo causal edge in the graph. With post-call signing, the row briefly exists without the receipt_id; a fast consumer reads it before the column is filled in.

**Decision.** Add `preCallTransform?: PreCallTransform` to `AtribOptions`. When set, the middleware signs the record BEFORE forwarding the call to the upstream handler, computes the [§1.5.2](atrib-spec.md#152-http-transport-tracestate) propagation token (`receiptId`) and the canonical record_hash reference (`recordHash`), invokes the callback with `{ toolName, args, receiptId, recordHash, contextId }`, and replaces the upstream call's `arguments` with the return value. Post-success commit (onRecord, outbound context, log submission, autoChain bookkeeping) is unchanged: the same signed bytes that were committed pre-call to the host are queued for log submission post-success.

**Rationale.**

1. **Spec-orthogonal.** No on-disk record format changes, no spec section changes, no conformance corpus changes. The signed record is byte-identical to the post-call path; only the ordering of "produce signed bytes" vs. "forward to upstream" changes. Verifiers reading log entries cannot distinguish the two paths and do not need to.

2. **Opt-in keeps the default contract.** Tools without `preCallTransform` set retain post-call signing, preserving the universal-case latency guarantee. The pre-call latency tax (one Ed25519 signature on the critical path) is paid only when the host explicitly opts in for the cross-tool embedding benefit.

3. **Graceful degradation per [§5.8](atrib-spec.md#58-degradation-contract).** Errors thrown from `preCallTransform` (or any failure during pre-call signing) are caught; the middleware falls back to the standard post-call signing path so the tool call itself never fails because of attribution.

4. **No double-sign.** The pre-built record is cached and reused at commit time. Exactly one signed record is emitted per successful tool call, identical to the post-call path semantics.

5. **Failure semantics preserved.** If the upstream returns `isError: true` after pre-call signing, the pre-built record is discarded: no `onRecord` call, no log submission, no autoChain bookkeeping. The receipt_id may have been embedded into upstream args (and the tool may have done something with it), but no record claims that activity from the agent's side. This matches the post-call semantics: `isError` suppresses emission either way.

**Alternatives considered.**

1. _Two-phase commit via a follow-up `attach_atrib_receipt` tool on the upstream server._ Rejected. Two roundtrips per call; brief inconsistency window where the row exists without the receipt; requires every cross-tool-embedding upstream to expose a separate update tool; couples atrib's substrate to a specific upstream API shape.

2. _Manual signing path in the wrapper bypassing `createAtribProxy` for the affected tool._ Rejected. Wrapper code re-implements every middleware concern (autoChain, informedBy, onRecord, queue submission) for one tool. Drift risk: future middleware improvements (chain context handling, additional optional record fields) won't apply to the tools using the manual path until the manual path is updated.

3. _Default to pre-call signing for all tools._ Rejected. The universal-case contract is post-call signing per [§5.3](atrib-spec.md#53-atribmcp-mcp-server-middleware); changing the default would shift latency for every existing user of the middleware to gain a benefit only a small fraction of integrations need.

**Consequences.**

- _Spec._ No changes. The hook is implementation-side; on-the-wire records are identical.
- _`packages/mcp/src/middleware.ts`._ `buildSignedRecord` and `commitRecord` extracted as inner helpers; `makeWrappedHandler` gains the pre-call branch gated on `options.preCallTransform`.
- _`packages/mcp/src/index.ts`._ Exports `PreCallTransform` and `PreCallTransformContext` types alongside `AtribOptions` and `AtribServer`.
- _`packages/mcp/test/middleware.test.ts`._ Five new test cases cover: receipt_id format + shape, args mutation reaches upstream, no double-sign, throw → fallback to post-call, upstream isError → no commit and no autoChain bookkeeping. Existing 26 tests unchanged.
- _`packages/mcp/README.md`._ Adds a row to the `AtribOptions` table.
- _Reusable beyond Loop 5._ Any wrapper that needs to embed an atrib receipt into downstream-visible data (database rows, queue messages, external-API request bodies) gets the same hook for free. Future cross-tool causal-link work does not need to revisit this design.

**Reopening criteria.** None expected. The hook surface is small, opt-in, and on the SDK side rather than the spec side. If a future use case needs a different shape (e.g., the host needs to influence record fields beyond just args mutation), that is a separate addition rather than a revision of [D057](#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding).

---

## D058: Promote `annotation` to atrib-normative event_type byte 0x05

**Date:** 2026-05-04
**Status:** Accepted

**Context.** Agents that read back their own signed records via the recall harness lose nuance compared to the agent that wrote them. The agent-at-write knew which records mattered, what topics they covered, what one-sentence summary captured them, what confidence applied. The agent-at-read sees a flat list of records of equal apparent weight and has to reconstruct importance from prose, often imperfectly.

The recall-fidelity primitive that closes this gap is _annotation_: a separate signed record pointing at any prior record via an `annotates` field, carrying structured metadata (importance, topics, summary) that downstream readers can filter and sort by. Annotation is the dual of `informed_by`, forward-pointing (a new record claims something _about_ an earlier record) rather than backward-pointing (a new record claims earlier records _informed_ it). Both are agent-declared causal links; both are surfaced as graph edges; their temporal orientation differs.

[D055](#d055-annotation-proposal-apply-types-stay-as-extension-uris-not-promoted-to-atrib-normative) ruled (2026-04-30) that `annotation` should stay as an extension URI in a single consumer's namespace because no second harness used the same shape. That ruling is reopened here: ANY atrib-using agent emitting "this record matters more than the others; weight it heavy in future recall" is using the same shape. Two independent harnesses (atrib-using agents in general, plus the original consumer specifically) need the identical semantic. The [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion bar clears.

**Decision.** Promote `https://atrib.dev/v1/types/annotation` to the atrib-normative event_type vocabulary, taking byte `0x05` in the [§2.3.1](atrib-spec.md#231-entry-serialization) log entry encoding. ([D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04) took `0x04` for `directory_anchor`; reserved range narrows from `0x05`–`0xFE` to `0x06`–`0xFE`.) Add the `annotates` optional field to the record format ([§1.2.7](atrib-spec.md#127-annotates)): `sha256:<64-hex>` reference to the target record. Validators MUST require `annotates` on annotation records and MUST reject `annotates` on any other event_type. The graph layer derives `ANNOTATES` edges (the eighth edge type beyond [§3.2.3](atrib-spec.md#323-edge-types)'s seven) per a new [§3.2.4](atrib-spec.md#324-edge-derivation-rules) step 8: for each annotation record A carrying `annotates: T`, create edge A → T; if T is not in the resolved set, create A → synthetic_dangling_node(T) with `dangling: true`.

**Rationale.**

1. **Recall fidelity is a substrate-level concern.** The "agents that reason from a past they can prove" tagline depends on that past being usefully readable, not just retrievable. Without structured annotation, every consumer reinvents the same importance-encoding pattern in prose, and readers can't filter by it without a domain-specific parser per consumer.

2. **Promotion bar ([D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)) is met.** Two independent harnesses need the identical semantic with no harness-specific divergence: (a) any atrib-using agent annotating its own prior records during recall workflows, (b) the original downstream consumer that minted the extension URI. The shape (`annotates` ref + structured importance/topics/summary) is identical across both.

3. **Dual-of-informed_by structure makes the cascade trivial.** Step 8 derivation mirrors Step 6 (INFORMED_BY) almost verbatim, modulo direction (forward vs backward) and the additional event_type filter. The dangling-node + reason annotation pattern from [D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)/Loop 5 carries over without modification.

4. **Byte allocation is the canonical fast-path filter.** Verifiers can byte-filter for annotations without fetching records, enabling fast queries like "all annotations on a session" without scanning every record. Pre-[D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) annotation records (emitted under downstream-consumer extension URIs) remain valid signed records and remain queryable by URI; the byte filter only catches post-promotion records.

5. **Closes a downstream consumer's annotation-shape carryover.** Existing consumers emitting annotation-shaped records under `event_type=observation` (because the annotation URI wasn't normative) flip one URI string post-[D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) and the records are correctly typed. The on-chain bytes are otherwise unaffected; the discontinuity is purely the event_type label.

**Alternatives considered.**

1. _Keep annotation as an extension URI per [D055](#d055-annotation-proposal-apply-types-stay-as-extension-uris-not-promoted-to-atrib-normative)._ Rejected. The recall-fidelity insight provides the second-harness use case [D055](#d055-annotation-proposal-apply-types-stay-as-extension-uris-not-promoted-to-atrib-normative) was waiting for. Continuing to leave it as extension blocks structured recall queries across the atrib ecosystem.

2. _Add `annotates` field to `observation` event_type instead of minting a new type._ Rejected. Observation and annotation have distinct cognitive roles: observations are first-class signed events the agent witnessed, annotations are commentary about earlier records. Conflating them in the same event_type loses the queryability advantage and forces consumers to inspect every observation record's content shape to know which kind it is.

3. _Promote annotation but skip the `annotates` field requirement._ Rejected. Without a structured target reference, the graph layer can't derive ANNOTATES edges; consumers fall back to scanning content prose. The whole point of normative promotion is the structured queryability the field enables.

**Consequences.**

- _Spec._ [§1.2.4](atrib-spec.md#124-event_type-values) event_type table gains a row for annotation (byte 0x05). [§1.2.7](atrib-spec.md#127-annotates) added covering the `annotates` field. [§2.3.1](atrib-spec.md#231-entry-serialization) byte mapping table gains a row, reserved range narrows. [§3.2.3](atrib-spec.md#323-edge-types) edge types table gains ANNOTATES (eighth type). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation gets Step 8.
- _@atrib/mcp._ `EVENT_TYPE_ANNOTATION_URI` constant + `EVENT_TYPE_ANNOTATION = 0x05` byte + entry encoder switch case + types.ts `annotates` optional field. AtribRecord type extended.
- _@atrib/verify._ `EventType` union gains `'annotation'`. `EdgeType` union gains `'ANNOTATES'`. `graphLabelFromEventTypeUri` switch gains a case.
- _services/graph-node._ Step 8 derivation in graph-builder.ts. 8-edge regression guard updated (was 7-edge from [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)+[D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)).
- _services/log-node._ Decoder switch + stats counter + endpoint doc + verify-loop validEventTypes Set + metrics.mjs per-byte filter.
- _apps/dashboard._ Chip color (teal) + `.chip.event-annotation` rule + Event-type chip block-comment refresh to reference [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05).
- _Tests._ +4 graph-builder tests (resolved, dangling, malformed-on-non-annotation, multi-annotation). 8-edge regression guard now has the ANNOTATES leg.
- _Reusable beyond P003._ The forward-pointing dangling pattern is now established for any future link-via-field promotion.

**Reopening criteria.** None expected. Future cognitive primitives (e.g., revision per the parked P003.5 / 1.65 work) follow the same cascade pattern as new ADRs without revising [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05).

---

## D059: Promote `revision` to atrib-normative event_type byte 0x06

**Date:** 2026-05-04
**Status:** Accepted

**Context.** Annotation ([D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)) addresses the recall-fidelity gap by letting agents weight, summarize, and topic-tag prior records. It does not address a distinct gap: when the agent's current position is _incompatible_ with a prior claim, annotation comments without overturning, and informed_by acknowledges sources without contradicting them. There is no protocol-level primitive for "I held position X; I now hold not-X because of Z."

A recognized gap in prior approaches is the lack of a protocol-level primitive for explicitly signaling when an agent's position contradicts a prior claim. A revision record should be signed to declare: "P was my prior claim. C is my new claim. Reason for revision: Z." This enables future agents to locate and evaluate changes in stance as first-class graph nodes. Without a normative type, agents either smuggle the contradiction through observation prose (lossy) or skip emitting anything (the silent-override anti-pattern).

The promotion bar ([D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)) clears for the same reason annotation cleared: any atrib-using agent doing reasoning that involves position changes hits the same shape. The substrate generalizes; agent-specific divergence in semantics is unnecessary.

**Decision.** Promote `https://atrib.dev/v1/types/revision` to the atrib-normative event_type vocabulary, taking byte `0x06` in the [§2.3.1](atrib-spec.md#231-entry-serialization) log entry encoding. ([D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) took `0x05`; reserved range narrows to `0x07`–`0xFE`.) Add the `revises` optional field to the record format ([§1.2.9](atrib-spec.md#129-revises)): `sha256:<64-hex>` reference to the predecessor record this revision supersedes. Validators MUST require `revises` on revision records and MUST reject `revises` on any other event_type. The graph layer derives `REVISES` edges (the ninth edge type) per a new [§3.2.4](atrib-spec.md#324-edge-derivation-rules) step 9: for each revision record R carrying `revises: T`, create edge R → T; if T is not in the resolved set, create R → synthetic_dangling_node(T) with `dangling: true`. Multiple revisions of the same target are allowed (a chain of mind-changes).

**Rationale.**

1. **Mind-changes deserve first-class status.** The substrate's "agents that reason from a past they can prove" claim depends on being able to surface contradictions explicitly. Without REVISES, an agent reading back records sees inconsistent positions with no signal that one supersedes the other. Annotation is too weak to carry the semantic.

2. **[D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) pattern is reusable verbatim.** Step 9 derivation mirrors Step 8 (ANNOTATES) modulo the field name (`revises` vs `annotates`) and event_type filter. The cascade across spec, mcp, verify, graph-node, log-node, dashboard is mechanical given the [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) precedent.

3. **Distinct semantic from annotation justifies a separate byte.** Conflating revision into annotation would force consumers to inspect content to know whether the new record overturns the old one or merely comments on it. Byte-level distinction keeps queries fast.

4. **No retroactive change to prior records.** Records remain immutable. A revision is a new signed record asserting the prior is no longer held; the prior stays on the log unchanged. This preserves the "atrib certifies what was signed, not what is currently true" invariant.

5. **Multiple revisions of the same target are allowed.** A chain of mind-changes (R1 revises P, R2 revises R1, R3 revises R2) produces a REVISES chain in the graph. Verifiers and recall consumers walk the chain to find the current position; the substrate doesn't normatively prescribe which revision "wins" because that's a downstream policy concern.

**Alternatives considered.**

1. _Use annotation for both commentary and revisions._ Rejected. Conflating commentary (no position change) with revision (position change) loses queryability and forces consumers into per-content parsing.

2. _Add a `revision_of` content field on observation records._ Rejected. Observations are first-class signed events, not commentary about prior records. Reusing observation for this would muddy its semantic and require consumers to filter every observation by content shape to find revisions.

3. _Skip the spec change and rely on agent prose to declare revisions._ Rejected. The whole point of normative promotion is making agent-declared causal links structurally derivable, not parseable-from-content. Without a field, no graph derivation; without graph derivation, no edge for verifiers and recall to query.

**Consequences.**

- _Spec._ [§1.2.4](atrib-spec.md#124-event_type-values) event_type table gains a row for revision (byte 0x06). [§1.2.9](atrib-spec.md#129-revises) added covering the `revises` field. [§2.3.1](atrib-spec.md#231-entry-serialization) byte mapping table gains a row, reserved range narrows to 0x07-0xFE. [§3.2.3](atrib-spec.md#323-edge-types) edge types table gains REVISES (9 types now). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation gets Step 9.
- _@atrib/mcp._ `EVENT_TYPE_REVISION_URI` constant + `EVENT_TYPE_REVISION = 0x06` byte + entry encoder switch case + types.ts `revises` optional field. AtribRecord type extended.
- _@atrib/verify._ `EventType` union gains `'revision'`. `EdgeType` union gains `'REVISES'`. `graphLabelFromEventTypeUri` switch gains a case.
- _services/graph-node._ Step 9 derivation in graph-builder.ts.
- _services/log-node._ Decoder switch + stats counter + endpoint doc + scripts/verify-loop.mjs validEventTypes Set + scripts/metrics.mjs per-byte filter and label.
- _apps/dashboard._ Indigo chip color for revision + `.chip.event-revision` rule + Event-type chip block-comment refresh.
- _Tests._ +4 graph-builder tests (resolved, dangling, malformed-on-non-revision, multi-revision). 9-edge regression guard now expects the REVISES leg.

**Reopening criteria.** None expected. The pattern is now extensible to any future link-via-field event_type promotion (e.g., `delegation`, `apply`) following the same cascade with no reopening of [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) or [D059](#d059-promote-revision-to-atrib-normative-event_type-byte-0x06).

## D060: CHANGELOG strategy, changesets per-package + GitHub Releases, no top-level CHANGELOG

**Supersedes:** P006 (a former pending decision about CHANGELOG strategy; entry removed when this ADR codified the choice).

### Context

When P006 was filed, the repo had no CHANGELOG anywhere. By the time this decision was made, the changesets pipeline had been deployed and per-package CHANGELOG.md files were being auto-generated by `changesets/action` on every Version Packages PR merge. The remaining question was whether that is enough or whether atrib needs additional artifacts (top-level CHANGELOG.md, GitHub Releases, spec revision history alignment).

### Decision

**Adopt changesets-generated per-package CHANGELOG.md as the source of truth. Enable GitHub Releases via `createGithubReleases: true` on `changesets/action` so external consumers can browse versioned release notes via the GitHub UI. Do NOT create a top-level CHANGELOG.md. Leave atrib-spec.md revision history as a separate concern, deferred until an external spec implementer needs it.**

### Rationale

**Per-package CHANGELOGs (changesets):**

- Already shipped, already accurate. Each Version Packages PR merge appends to the relevant per-package files automatically.
- Cross-package dependency-bump tracking ("Updated dependencies") happens for free.
- Integrates with the existing Trusted Publishing OIDC pipeline; no separate tooling.

**GitHub Releases:**

- Useful for external consumers who browse via the GitHub UI rather than the npm registry.
- One-line workflow change (`createGithubReleases: true`).
- Tags created automatically per per-package version, leveraging the existing `commitMode: github-api` signing path.

**Why NOT a top-level CHANGELOG.md:**

- High drift risk. Per-package CHANGELOGs are auto-generated; a top-level summary would have to be hand-rolled or regenerated by a separate tool, adding maintenance cost without value-add.
- Standard monorepo pattern (turborepo, vercel, vitest, vue, react) uses per-package CHANGELOGs without a top-level digest.
- Consumers who want cross-package context can read the per-package files; consumers who want repo-level context can read git log or DECISIONS.md.

**Why defer atrib-spec.md revision history:**

- The spec is a normative protocol document, not a package. Its versioning concern is separate from package versioning (a package can ship without a spec change; a spec change can land before any package implements it).
- No external spec implementer exists yet. When one does, the right shape is likely a §A appendix with dated revision entries OR a `spec/CHANGELOG.md` adjacent to the spec, not a section in DECISIONS.md or a per-package CHANGELOG.
- The conformance corpus already partially serves this role: each spec section change triggers regeneration of the relevant `spec/conformance/<§>/` corpus, and corpus changes are visible in git log.

### Alternatives rejected

1. **Top-level CHANGELOG.md (P006 option 1).** Drift risk + maintenance cost.
2. **release-please from conventional commits (P006 option 4).** Conflicts with changesets, both want to own version bumping.
3. **GitHub Releases only, no per-package CHANGELOGs (P006 option 3).** Loses per-package version history once a package's release notes scroll off the Releases tab.

### Consequences

- `createGithubReleases: true` added to the release job's `changesets/action` config in `.github/workflows/release.yml`.
- Future Version Packages PRs auto-create per-package GitHub Releases (e.g., `@atrib/mcp@0.1.3`) on merge, in addition to publishing to npm.
- DECISIONS.md doubles as the authoritative log for non-package architectural decisions; per-package CHANGELOGs cover code/release-level changes.
- If atrib-spec.md revision history becomes necessary for external implementers, open a follow-up ADR specifying the location and format.

## D061: Add tool_name, args_hash, result_hash fields to [§1.2.1](atrib-spec.md#121-field-definitions)

### Context

[§8.2](atrib-spec.md#82-opaque-name-posture) (opaque-name posture) and [§8.3](atrib-spec.md#83-salted-commitment-posture) (salted-commitment posture) referenced `tool_name`, `args_hash`, and `result_hash` as record fields without ever adding them to the [§1.2.1](atrib-spec.md#121-field-definitions) canonical record schema. The [§1.2](atrib-spec.md#12-the-attribution-record) standard-shape table only listed `args_salt` and `result_salt`, leaving the actual hash and tool-name fields as spec-implied-but-not-defined.

This created two coupled gaps:

- **[§8.2](atrib-spec.md#82-opaque-name-posture) verifier surface** (`tool_name_form`) had nothing to detect against. The [§1.2.2](atrib-spec.md#122-content_id-derivation) `content_id` derivation hashes `serverUrl + toolName` into `content_id`, but the verifier cannot reverse-derive `tool_name` from that hash.
- **[§8.3](atrib-spec.md#83-salted-commitment-posture) salted-commitment scheme** (`H = SHA-256(salt ‖ canonical_args_bytes)`) defined a salt without the corresponding hash. A salt with no companion `args_hash` on the record is salt-for-nothing, there is no committed value to verify against.

The [§8.3](atrib-spec.md#83-salted-commitment-posture) commitment-form posture detection shipped on 2026-05-04 surfaces only the salt-presence dimension (`args_commitment_form: 'plain-sha256' | 'salted-sha256'` driven by `args_salt` presence). The actual commitment cannot be checked because `args_hash` is not on the record.

### Decision

**Add `tool_name`, `args_hash`, and `result_hash` as MAY fields on the [§1.2.1](atrib-spec.md#121-field-definitions) standard record shape. All three default to absence (preserving the [§8.1](atrib-spec.md#81-default-posture) default posture). Verifiers MUST treat absence as "not asserted" rather than as a default value.**

### Field details

| Field         | JCS-canonical sort position                                                                            | Format                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `tool_name`   | last in current schema (`t-o-...` after `t-i-...`)                                                     | string per [§8.2](atrib-spec.md#82-opaque-name-posture) |
| `args_hash`   | between `annotates` (`a-n`) and `args_salt` (`a-r-g-s-_-s`); `a-r-g-s-_-h` lies between                | `"sha256:" + 64 lowercase hex`                          |
| `result_hash` | between `provenance_token` (`p`) and `result_salt` (`r-e-s-u-l-t-_-s`); `r-e-s-u-l-t-_-h` lies between | `"sha256:" + 64 lowercase hex`                          |

### §8.2 ambiguity resolution

The [§8.2](atrib-spec.md#82-opaque-name-posture) form distinction is between three values: `verbatim` / `opaque` / `hashed`. The opaque-label regex (`[a-z0-9_-]{1,64}`) is broad enough that the spec's own verbatim example `book_flight` matches it. There is no structural way for a verifier to tell `book_flight` (verbatim) apart from `tool_a7f3` (opaque) by reading the record.

Three fixes were considered:

1. Add a separate `tool_name_form?` field that the signer declares.
2. Tighten the opaque regex (e.g., require an `op_` prefix). Backward-incompatible with the spec's own examples.
3. Surface only the structurally-detectable distinction (`hashed` vs `plain`) and document that `verbatim` vs `opaque` is producer-side intent, not verifier-detectable.

**Adopted: option 3.** Verifiers indicate `tool_name_form: "hashed" | "plain" | null`:

- `"hashed"` when the value matches `^sha256:[0-9a-f]{64}$`.
- `"plain"` for any other present value.
- `null` when the field is absent.

The [§8.2](atrib-spec.md#82-opaque-name-posture) prose is updated to acknowledge the limitation: consumers wanting to enforce verbatim-vs-opaque MUST do so via out-of-band metadata (e.g., a name registry), not by parsing the record value.

### Backward compatibility

- Existing records (none on the production log carry `tool_name`, `args_hash`, or `result_hash` as of 2026-05-04) remain valid and continue to verify identically.
- New records that opt into any of the three fields produce different JCS canonical bytes and therefore different signatures from records that omit them, this is intentional and is the same backward-compat shape as `informed_by`, `provenance_token`, `args_salt`, `result_salt`, and `timestamp_granularity`.
- Middleware (`@atrib/mcp`) gains opt-in config flags that default to off:
  - `disclosure: { tool_name: 'omit' | 'verbatim' | 'hashed' }`, defaults to `'omit'` (preserves [§8.1](atrib-spec.md#81-default-posture)).
  - `commitment: { args: 'omit' | 'plain-sha256' | 'salted-sha256', result: 'omit' | 'plain-sha256' | 'salted-sha256' }`, defaults to `'omit'`.
- Operators flipping any opt-in to non-`'omit'` are choosing to disclose more per [§8](atrib-spec.md#8-privacy-postures) and accept the privacy trade-off documented in [§8.6](atrib-spec.md#86-threat-model).

### Verifier surface (`@atrib/verify`)

`PostureAnnotation` gains:

- `tool_name_form: 'hashed' | 'plain' | null` per the [§8.2](atrib-spec.md#82-opaque-name-posture) fix above.
- (Already shipped) `args_commitment_form` / `result_commitment_form`, semantics unchanged; these now align with the spec since `args_hash` and `result_hash` are formally on the record.

### Conformance corpus

`spec/conformance/8.2/` ships with this ADR: cases for omitted, plain (verbatim-style), plain (opaque-label-style, same surface as verbatim), and hashed values. Each case fixes the canonical signing input + expected `tool_name_form` output.

### Alternatives rejected

1. **Add only `tool_name` and defer `args_hash` / `result_hash`.** Rejected because the same shape of gap blocks both surfaces; doing one and not the other leaves the spec internally inconsistent the same way it was before.
2. **Skip the spec change and have the verifier surface `unresolvable: true` permanently.** Rejected because that means the [§8.2](atrib-spec.md#82-opaque-name-posture) / [§8.3](atrib-spec.md#83-salted-commitment-posture) surfaces are documentation-only forever, they describe postures consumers can never actually verify.
3. **Tighten [§8.2](atrib-spec.md#82-opaque-name-posture) opaque-label regex (option 2 above).** Rejected because backward-incompatible with the spec's own published examples; the cost is wider than the value.

### Consequences

- [§1.2.1](atrib-spec.md#121-field-definitions) field-table grows by three rows (tool_name, args_hash, result_hash); standard-shape example record updated.
- [§8.2](atrib-spec.md#82-opaque-name-posture) prose updated to reference the new field and document the regex ambiguity.
- [§8.3](atrib-spec.md#83-salted-commitment-posture) prose clarifies that args_hash / result_hash are [§1.2.1](atrib-spec.md#121-field-definitions) MAY fields.
- `AtribRecord` TypeScript type adds three optional string fields with the documented JCS sort positions.
- `@atrib/mcp` middleware adds opt-in disclosure / commitment config (default off; preserves existing record shapes for consumers that don't flip the flags).
- `@atrib/verify` `PostureAnnotation` adds `tool_name_form`.
- `spec/conformance/8.2/` corpus + reference test ship in the same change.
- CLAUDE.md sync triggers: "Privacy posture spec section [§8](atrib-spec.md#8-privacy-postures) changed" already covers regenerating the [§8.2](atrib-spec.md#82-opaque-name-posture) corpus and refreshing the verifier; the [§1.2.1](atrib-spec.md#121-field-definitions) schema-extension trigger ("Wire-format or wire-protocol change") covers the rest.

## D062: Local mirror sidecar, two-tier "private local + public canonical" persistence

**Date:** 2026-05-04
**Status:** Implemented in `@atrib/mcp` v0.2.x, `@atrib/mcp-wrap` v0.2.x, `@atrib/atrib-emit` (envelope shape). Spec-formalized in atrib-spec.md [§5.9](atrib-spec.md#59-local-mirror-conventions).

### Context

The local jsonl mirror, what `@atrib/mcp-wrap`'s `persistRecord` and `@atrib/atrib-emit`'s `mirrorRecord` write to `~/.atrib/records/*.jsonl`, was always an implementation detail outside the spec. Originally it stored the bare signed AtribRecord, byte-identical to what gets submitted to the public log. That made the local mirror a useful re-verification and replay surface, but it threw away every piece of pre-sign payload context: tool names, raw args, raw results, the `content` blob passed to `atrib-emit`, the `topics`/`what`/`why_noted` fields.

This was fine when nobody consumed the mirror semantically. As soon as we started building consumer-side cognitive primitives, first the SessionStart hook (2026-05-04), then `atrib-trace`, then `atrib-summarize`, the impoverishment was felt immediately. Recall returned event*type + hashes; trace returned chains of event_type + hashes; summarize had nothing semantic to feed an LLM. The mirror was the bottleneck: not the substrate, not the tools, but the \_persistence layer between them*.

The architectural opportunity: the public log MUST be lean (only commitments + cryptographic evidence, that's what makes it cheap to operate, public to share, hard to weaponize). But the local mirror has none of those constraints, it's the agent's own working memory, on the agent's own disk, scoped to the agent's own consumption. There's no spec reason it should be byte-identical to the log.

### Decision

**Adopt a two-tier persistence pattern: the public log stores the canonical signed AtribRecord (lean, cryptographically minimal); the local mirror stores an envelope around the same signed record plus an OPTIONAL `_local` sidecar carrying pre-sign payload context that the signed record commits to but does not itself contain.**

Concretely:

- The signed AtribRecord remains the canonical artifact. Public log submission is unchanged. Verifier semantics are unchanged.
- The local mirror writes envelopes of shape `{ record, _local?, written_at }` per JSONL line.
  - `record`: the canonical signed AtribRecord. UNCHANGED bytes.
  - `_local`: optional sidecar carrying pre-sign content (`toolName`, `args`, `result`, `content`, `producer`). NEVER affects the signature. NEVER reaches the public log.
  - `written_at`: wall-clock time of mirror write, for staleness debugging.
- Readers MUST tolerate three on-disk shapes:
  - LEGACY bare-record JSON per line (older mirror writes pre-[D062](#d062-local-mirror-sidecar-two-tier-private-local-public-canonical-persistence))
  - ENVELOPE without sidecar `{ record, written_at }`
  - ENVELOPE with sidecar `{ record, _local: {...}, written_at }`
- Producers MAY supply a sidecar; producers without pre-sign context (or callers that explicitly opt out) write envelopes without `_local`.

### Implementation evidence (what the rollout taught us)

The implementation shipped 2026-05-04 (commit `e0699b5` for `@atrib/mcp` + `@atrib/mcp-wrap` + `@atrib/atrib-emit`). Concrete findings that informed this ADR:

1. **Backward compatibility is essentially free.** `loadAutoChainSeed` already had to parse "lines that may or may not have all fields" defensively (malformed lines, partial writes). Extending the parser to accept either bare-record OR envelope shape was 15 lines (`normalizeMirrorLine` in `mcp-wrap/src/mirror.ts`). 4 new tests in `mirror.test.ts` cover legacy + envelope + sidecar + mixed-shape file in the same JSONL.

2. **The signature contract is not threatened.** Because the sidecar lives at the envelope level (not inside `record`), there is no path by which sidecar content can affect JCS canonicalization or the Ed25519 signature. The submission queue receives `record` directly; the envelope only exists on disk. We added zero spec rules that hosts must enforce, the structural placement is the enforcement.

3. **The producer field disambiguates cross-source records.** When both a wrapper-side producer (auto-signing tool calls) and an emit-side producer (explicit observations) write to mirror files in the same directory, the `producer` field on the sidecar lets readers distinguish their origins. Useful for `atrib-trace` when walking a chain that mixes both.

4. **Sidecar shape varies by producer.** Wrapper-side records get `toolName + args + result`; emit-side records get `content`. Both populate `producer`. The `OnRecordSidecar` TypeScript type has all fields optional, and downstream readers (storage.ts in trace + summarize) just access whichever fields are present. No shape-rigidity needed at the spec level, let producers populate what they have.

5. **Consumer-side payoff is large.** Without the sidecar, `atrib-trace`'s per-record output was event_type + truncated hash + trace_id + creator_key. With the sidecar, output gains `tool_name`, `topics`, first 200 chars of `what`/`summary`, `importance` for annotations. `atrib-summarize` LLM prompts go from "synthesize this list of event_type chronology" to "synthesize this richly-described causal chain". Same code path, ~10x more useful output.

6. **The `_local` field naming convention is enough.** Underscore-prefixed envelope-level fields are a standard "this is local-only" convention. No spec mechanism beyond the field name needed to enforce "don't leak this to the log", the structural placement (outside `record`) does it. Producers that go through the standard submission path literally cannot leak `_local` because the queue only sees `record`.

### Alternatives rejected

1. **Keep the mirror as a pure log-copy, build consumers against the impoverished view.** Tried implicitly through the SessionStart hook and the early `atrib-trace` scaffold. The output was too thin to be useful. `atrib-summarize` would have been actively misleading (impoverished input → confident-sounding LLM hallucinations).

2. **Extend the signed AtribRecord with the semantic content directly.** Rejected on first principles: the public log MUST stay lean per the spec's privacy postures ([§8](atrib-spec.md#8-privacy-postures)) and the operator-cost principle ([§2](atrib-spec.md#2-merkle-log-protocol)). Adding rich semantic content to signed records pushes against both.

3. **A separate per-record JSON file alongside the JSONL mirror.** Considered briefly. Rejected because the JSONL append-only invariant keeps autoChain and crash-safety intact; introducing a second persistence surface creates synchronization risk.

4. **A different field name (e.g. `meta`, `private`, `extra`).** Rejected because they're either too generic (`meta`, `extra`) or implied a security property the field doesn't actually provide (`private`, the field IS private to the host's filesystem, but that's a deployment property, not a cryptographic one). `_local` is honest: "this content lives on the local host only, by virtue of where it's written."

### Consequences

- **Spec**: [§5.9](atrib-spec.md#59-local-mirror-conventions) formalizes the local mirror as an OPTIONAL host-side persistence surface, the envelope shape as the canonical local format going forward, and the `_local` sidecar conventions. Existing producers + consumers are conformant by construction.
- **Implementation**: `@atrib/mcp` exports the `OnRecordSidecar` type. `AtribOptions.onRecord` accepts an optional second argument. `@atrib/mcp-wrap` and `@atrib/atrib-emit` both write the envelope shape. `@atrib/atrib-trace` and `@atrib/atrib-summarize` read it.
- **Backward compatibility**: legacy bare-record entries in existing mirror files continue to parse. No data migration required. New writes use the envelope shape unconditionally.
- **Future-proofing**: the envelope is extensible. New optional sidecar fields can be added without spec changes (they're producer-agnostic). New envelope-level fields (e.g. `cached_at`, `last_verified_at`) can be added the same way.
- **Public log unaffected**: this ADR introduces ZERO changes to public log semantics, submission protocol, or verifier behavior on log-fetched records.

### Open questions deferred

- **Conformance corpus**: a `spec/conformance/<§>/` corpus for the envelope shape would let third-party host-side persistence implementations validate against. Deferred until a third-party host actually exists; current consumers all live in the workspace and test against each other directly.
- **Sidecar size limits**: tool-call results can be large (megabytes for some MCP tools). The current spec version persists the full `result` object regardless of size. A future ADR may introduce a size-cap convention or a "result fingerprint" pattern. Defer until a real bloat case appears.
- **Encryption at rest**: the sidecar may contain secrets the host doesn't want on disk in plaintext (API keys leaking into tool args, etc). The current spec version lets the mirror live at mode 600 in `~/.atrib/records/` and inherit whatever the host filesystem provides. Spec-level encryption is out of scope; host-level encryption (FileVault, etc.) covers most threat models.

### How to apply

When extending atrib-emit, mcp-wrap, or any future producer to populate a sidecar field:

1. Add the field to `OnRecordSidecar` in `@atrib/mcp/src/middleware.ts`
2. Pass it through the existing `onRecord` callback or `mirrorRecord` call site
3. Update consumers (`atrib-trace`, `atrib-summarize`, recall) to surface the new field
4. No spec section update needed unless the field's semantics are normative

When the spec needs to evolve (e.g. result fingerprint convention lands), update [§5.9](atrib-spec.md#59-local-mirror-conventions) "Local mirror conventions", regenerate any associated conformance corpus, and refresh the implementations in lockstep.

---

## D063: Canonical event_type examples and selection tree

**Date:** 2026-05-05
**Context:** The atrib spec [§1.2.4](atrib-spec.md#124-event_type-values) defined the six normative `event_type` URIs and the field-level requirements ([§1.2.7](atrib-spec.md#127-annotates) annotates, [§1.2.9](atrib-spec.md#129-revises) revises) but did not provide canonical examples or a selection tree. The result was repeatable drift between `observation` and `annotation` across producer implementations:

- Lifecycle hooks (PreCompact, SessionEnd) initially emitted `event_type=observation` as a fallback when the annotates pipeline was not yet wired through atrib-emit, even though the records had a clear referent (the chain-tail record_hash) and were structurally annotations. Migrated to `event_type=annotation` per [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) once the pipeline shipped.
- A retrospective batch watcher pipeline emitted `event_type=observation` for records that carried `informed_by` and annotation-shaped content (`ref`, `observation_source`, `summary`). Migrated to `event_type=annotation` once the byte 0x05 promotion ([D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)) cleared the on-the-wire ambiguity.
- An analysis of cognitive event drift in the atrib ecosystem documented a related class of drift: agent in-the-moment cognitive events that _should_ have been `observation` (no specific referent: discoveries, hypotheses, in-the-moment notings) had no automated path and were not being signed at all. Tracked separately under the cognitive-completeness work; the spec-side fix is the canonical examples here.

The semantic distinction between observation, annotation, and revision is structural (referent presence, referent strength) but the prose-only treatment in [§1.2.7](atrib-spec.md#127-annotates) / [§1.2.9](atrib-spec.md#129-revises) left producers without a single place to look for "what does each look like, and which one fits this record?"

**Decision:** Add two normative-explanatory subsections to [§1.2.4](atrib-spec.md#124-event_type-values):

1. **[§1.2.4.1](atrib-spec.md#1241-canonical-examples) Canonical examples**, one example record skeleton per event_type (tool_call, transaction, observation [passive watcher], observation [agent self-emitted], directory_anchor, annotation, revision), with a caption explaining the structural and semantic positioning.
2. **[§1.2.4.2](atrib-spec.md#1242-choosing-event_type) Choosing event_type**, a five-step decision tree consumers run to select the right event_type, plus targeted disambiguation for the two common confusion cases (observation vs annotation, annotation vs revision) and producer guidance for emit pipelines that automate event_type selection (lifecycle hooks, extractor sub-agents, periodic watchers).

Also broaden the `observation` row in the [§1.2.4](atrib-spec.md#124-event_type-values) normative-URI table to clearly include both production shapes (passive watcher AND agent self-emitted standalone notings); the prior wording read narrowly as "passive watcher only" even though the field semantics never required that.

**Alternatives considered:**

- _Leave the spec as-is and rely on implementation memory + skill docs for the disambiguation._ Rejected because the drift is documented across multiple producer surfaces (lifecycle hooks, synthesize.py, agent self-emission gap), and the dogfood architecture has now been bitten by the same ambiguity twice. The spec is the right level for the fix; implementation-side guidance leaks operator-context detail and does not propagate to future implementers.
- _Restrict observation to passive-watcher use only and expand annotation to absorb agent self-emitted notings._ Rejected because annotation REQUIRES `annotates` per [§1.2.7](atrib-spec.md#127-annotates) (validators MUST reject annotation without it) and the structural semantics drive [§3.2.4](atrib-spec.md#324-edge-derivation-rules) ANNOTATES edge derivation. Removing the requirement would silently break graph derivation. The right move is clarifying that observation has two valid production shapes, not collapsing observation into annotation.
- _Mint extension URIs for the agent self-emitted case (e.g. `https://atrib.dev/v1/types/discovery`)._ Rejected because the structural semantics already match the existing observation type (no required referent, first-class noting). Adding a new type would increase the vocabulary without resolving the drift; it would introduce a different ambiguity (discovery vs observation).
- _Add canonical examples in a separate appendix or supplementary doc._ Rejected because consumers selecting an event_type are reading [§1.2.4](atrib-spec.md#124-event_type-values) first; a separate location would not be where the question gets asked.

**Consequences:**

- Producer implementations have a single source of truth for event_type selection. The [§1.2.4.2](atrib-spec.md#1242-choosing-event_type) decision tree is the resolution path.
- Future emit pipelines (extractor sub-agents reading transcripts, decision-time guidance hooks, Hermes-as-Critic per cognitive-completeness Track 1) have explicit guidance on how to map detected events to event_type. The producer-guidance sub-paragraph in [§1.2.4.2](atrib-spec.md#1242-choosing-event_type) captures the mapping rule (referent → annotation; superseding referent → revision; standalone noting → observation).
- The [§1.2.4](atrib-spec.md#124-event_type-values) observation prose now explicitly admits agent self-emitted observations as a valid production shape. Producers no longer need to choose between "this looks like observation but the spec implies passive watcher only" and "force it into annotation even though there's no referent."
- The conformance corpus is unaffected ([§1.4.4](atrib-spec.md#144-test-vector-validation), [§A.10](atrib-spec.md#a10-conformance-corpus-for-optional-fields-and-postures)). The examples are illustrative, not normative test vectors.

**Scope of the spec change.** The change is additive (new subsections + broadened prose for one row of the normative URI table). No field semantics change. No graph derivation rule changes. No conformance corpus regeneration required. Validators and verifiers do not need updates.

**Cross-references:**

- [§1.2.4](atrib-spec.md#124-event_type-values) normative URI set (table updated for observation row)
- [§1.2.4.1](atrib-spec.md#1241-canonical-examples) canonical examples (NEW)
- [§1.2.4.2](atrib-spec.md#1242-choosing-event_type) selection tree (NEW)
- [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) annotation byte 0x05 promotion (the on-the-wire ambiguity this clarification builds on)
- [D059](#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) revision byte 0x06 promotion (paired type with the same selection-tree question)

---

## D064: graph-node persistent volume + replay-on-cold-start (Layer 1 durability)

**Date:** 2026-05-06
**Context:** graph-node holds the canonical full-record content in memory (records ingested via `/v1/ingest`, derived edges built per [§3.2.4](atrib-spec.md#324-edge-derivation-rules), revocation registry, capability envelopes). log-node persists only the 90-byte log entries per [§2.3.1](atrib-spec.md#231-entry-serialization) and discards the full record content after fanout, log-node alone CANNOT reconstruct graph-node's state. The only persistent copies of full records are in producer-local mirror files maintained per spec [§5.9](atrib-spec.md#59-local-mirror-conventions).

A failure mode occurs when graph-node is OOM-killed with ~1500 records in memory: state cannot be reconstructed from log-node alone due to the deliberate omission of full record content. Trace endpoints return 404s for pre-restart records and session views show only post-restart data. State can be recovered by replaying records from a producer-local mirror via `/v1/ingest`.

The architectural gap: graph-node has no startup-replay logic. There's no mechanism for a graph-node-equivalent to recover from log-node alone, because log-node deliberately doesn't persist full record content (privacy + log-size invariants).

**Decision:** Add an opt-in append-only JSONL archive to graph-node, mounted on a fly volume, replayed on cold-start before binding the server.

Concretely:

1. `services/graph-node/src/persistence.ts` (NEW): exports `createArchiveAppender(path)` returning an O_APPEND handle, and `replayArchive(path, ingest)` that streams via readline and re-invokes the store's `addRecord` for each parsed line. Format: one JSON object per line, shape `{record, log_index}`. log_index is preserved alongside the record so revocation registry semantics per [§1.9.3](atrib-spec.md#193-revocation-cutoff) still apply after replay.

2. `bindGraphServer` accepts a new `BindOptions` object: optional `store` (so callers can prepopulate state via replay before binding) and `onRecordIngested` hook (called after `store.addRecord` on each successful ingest). Existing callers pass nothing → behavior identical (fresh in-memory store, no persistence).

3. `main.ts` wires the two via env var `ATRIB_RECORD_ARCHIVE`. When set: replay archive → create store with replayed state → open appender → bind server with `onRecordIngested = appender.append`. When unset: behavior identical to before this commit.

4. Production `services/graph-node/fly.toml` gets `[[mounts]]` (volume `atrib_graph_data` mounted at `/data`) and `ATRIB_RECORD_ARCHIVE=/data/records.jsonl`. Memory bumped 256mb → 1024mb at the same time after the OOM observation.

Crash safety: every successful ingest appends a single LF-terminated line via O_APPEND. The OS guarantees the line is atomic; a mid-write crash leaves at most a torn final line which the per-line try/catch on replay skips with a warning.

**Alternatives considered:**

- _Move log-node to persist full records (a full-record archive in addition to the 90-byte Merkle log)._ Rejected for this layer because it requires a spec amendment ([§2.3.1](atrib-spec.md#231-entry-serialization) deliberately commits only to 90-byte entries) and ecosystem coordination across third-party log operators. Tracked separately as the Layer 5 long-term fix.
- _External durable storage (S3/R2/Tigris) instead of a fly volume._ Rejected for now, adds a runtime dependency, network failure modes, and cost. Volume + replay is the simplest model that solves the immediate problem. External storage is the right answer if/when graph-node grows past one machine.
- _Periodic snapshot to disk instead of append-on-every-ingest._ Rejected because periodic snapshot leaves a window of records-in-RAM-only between snapshots; if graph-node OOMs in that window, you lose the records since the last snapshot. Append-on-every-ingest is durable for every record up to the last successful append.
- _SQLite or LMDB instead of JSONL append-only._ Considered but rejected for Layer 1 scope. Disk-backed graph store is the right Layer 4 fix once record volume forces it; for the first iteration, a flat JSONL file is the simplest crash-safe shape and produces a recoverable archive without any binary-format gotchas.

**Consequences:**

- graph-node survives OOM / deploy / fly machine reboot without data loss going forward. In production deployments, 994 records have been replayed on first boot in under 1 second.
- Cold-start time scales with archive size (~1-3 KB per record + JSON parse). Sustainable to ~10⁵ records before cold-start exceeds fly's startup grace; Layer 4 (disk-backed graph store) takes over at that scale.
- Single-volume single-machine model only. Multi-machine would need either multiple volumes (data divergence) or shared external storage. Documented in [`services/graph-node/fly.toml`](services/graph-node/fly.toml).
- Archive grows on every successful ingest, including dedups (because `store.addRecord` returns void, the appender can't tell whether the record was new). Bounded by fanout-retry count; tracked as a follow-up to flip `addRecord` to return `boolean`.
- New opt-in env var `ATRIB_RECORD_ARCHIVE`; tests run without it so the unit-test path is unaffected (50/50 graph-node tests pass).

**Cross-references:**

- [`services/graph-node/src/persistence.ts`](services/graph-node/src/persistence.ts) (the new module)
- [`services/graph-node/src/main.ts`](services/graph-node/src/main.ts) (wiring + replay-before-bind)
- [`services/graph-node/src/server.ts`](services/graph-node/src/server.ts) (`BindOptions` + `onRecordIngested` hook)
- [`services/graph-node/fly.toml`](services/graph-node/fly.toml) (volume mount + env)
- [§2.3.1](atrib-spec.md#231-entry-serialization) (log-node 90-byte entry serialization that motivates this gap)
- [§5.9](atrib-spec.md#59-local-mirror-conventions) (producer-local mirror conventions that complement durability)
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) (sidecar precedent for two-tier persistence design)

---

## D065: `ATRIB_CHAIN_TAIL_<context_id>` env var for cross-producer chain-tail handoff

**Date:** 2026-05-06
**Context:** atrib's `chain_root` derivation per [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records) requires that every non-genesis record point at a real ancestor's record_hash. Producer middleware (`@atrib/mcp`) already supports two paths to find the right `chain_root` for a new sign:

1. **Inbound traceparent** ([§1.5.2](atrib-spec.md#152-http-transport-tracestate)), the spec-canonical W3C-tracestate-based propagation. Cross-process via the wire.
2. **autoChain in-memory tail**: the most recent record this middleware instance signed for the given `context_id`. Within-process across multiple calls; survives process restarts when the caller seeds via `autoChainSeed`.

Neither covers the case observed in production: a parent process spawns a _different middleware instance_ (a separate producer type) as a child subprocess to sign records. The child has no traceparent and no autoChain seed for the parent's context, it sees an empty chain, marks itself genesis, and uses the synthetic-context-hash `chain_root` per [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records).

An observed session with hash prefix `b5a2ebf8` had 130-418 records flagged `is_genesis=true` (all signed by the same `creator_key` in the same `context_id`), each starting its own single-record "chain" because hook subprocesses kept spawning fresh atrib-emit processes that each saw an empty chain. The session had no recoverable provenance structure; CHAIN_PRECEDES edges only formed within the long-lived atrib-emit instance's own emissions, missing the hook-spawned ones.

**Decision:** Add a third source between (2) and the genesis fallback: an env var named `ATRIB_CHAIN_TAIL_<context_id>` whose value is the parent's current chain tail (`sha256:<64-hex>`). When the child middleware initializes and faces an empty in-memory tail for that context, it consults the env var; if set + valid format, that becomes the child's first sign's `chain_root`. Subsequent signs in the same child use the in-memory tail (autoChain natural behavior).

Priority cascade (full):

1. Inbound traceparent atrib token (spec-canonical [§1.5.2](atrib-spec.md#152-http-transport-tracestate))
2. autoChain in-memory `lastRecordHashByContext` (within-process)
3. **NEW:** `ATRIB_CHAIN_TAIL_<context_id>` env var (cross-process handoff)
4. Synthetic genesis (`sha256:hex(SHA-256(UTF-8(context_id)))` per [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records))

The chain_root determination logic was extracted into a pure helper `resolveChainRoot()` (in `packages/mcp/src/chain-root.ts`) so it can be unit-tested without mocking `process.env`. The middleware passes `process.env` to the helper at call time; tests pass an explicit `env` to override.

**Per-context-id namespacing.** A single parent process may handle multiple concurrent `context_id`s. Naming the env var with the `context_id` suffix lets the parent set only the relevant tail in the child's spawn env without leaking unrelated chain state. Format: `ATRIB_CHAIN_TAIL_<32-hex-context-id>=<sha256:64-hex-tail>`. Total ~111 chars, well within env limits.

**No security wrapper.** The value being passed is a record_hash that's already in the public log; there's no secret. An attacker who controls the parent process can already sign whatever they want, adding the env var doesn't expand attack surface. Plain env inheritance, no encryption / IPC handshake / signed token.

**Tree-shaped chains accepted.** Multiple parallel children spawned by the same parent will inherit the same env-var value and sign their first records with the same `chain_root` → fan-out from the common parent. Per [§3.2.4](atrib-spec.md#324-edge-derivation-rules) step 1, `CHAIN_PRECEDES` derivation handles fan-out naturally; the spec doesn't require chains to be linear, only that every non-genesis record point at a resolvable ancestor.

**Alternatives considered:**

- _Shared on-disk file with `flock` ([Approach A](#) in the audit pre-deliberation)._ Rejected because lock contention on bursty hook fires would be a real footgun, and file I/O is on the hot path of every sign.
- _Long-running emit daemon ([Approach B])._ Rejected: adds daemon lifecycle management + IPC complexity for a problem env-var inheritance solves cleanly.
- _Coordinated signing through a single wrapper ([Approach C])._ Rejected: requires deep producer-architecture changes; creates a single point of failure; the env-var approach achieves the same goal with one variable.
- _Mirror file as the sole source of truth with concurrency control ([Approach D])._ Already exists via `ATRIB_AUTOCHAIN_SOURCE` for within-producer-type chaining. The cross-producer-type case is what the env var fills; mirror file is the pull mechanism, env var is the push mechanism, both are valid and complement each other.
- _Spec change: embrace multi-rooted chains as first-class ([Approach E])._ Rejected as unnecessary: the env-var fix produces tree-shaped chains which are already spec-valid per [§3.2.4](atrib-spec.md#324-edge-derivation-rules). Spec change would lose the "one chain per session" mental model without solving anything the env var doesn't already solve.

**Consequences:**

- Producer codebases (mcp-wrap, hook-driven emit-helpers, future runtime adapters) gain a clean primitive for chain-state handoff to spawned children. The pattern: read your current tail (via autoChain or your own in-memory state), set `ATRIB_CHAIN_TAIL_<context_id>` in the child's spawn env.
- Within-process auto-chain semantics are unchanged. The env var is a third fallback, only consulted when both inbound traceparent and in-memory tail are empty for the context.
- The issue producing fan-out genesis records is resolved for future signings (when producers correctly configure the env var). Historical genesis records remain immutable with `chain_root = sha256(context_id)`.
- New unit tests cover the priority cascade (9 tests in `packages/mcp/test/chain-root.test.ts`): inbound wins over autoChain wins over env wins over genesis; namespace isolation; malformed-env fallthrough; format validation.
- `@atrib/mcp@0.5.0` was released as a minor bump. The cognitive-primitive packages (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`) resolve `@atrib/mcp@^0.4.0` and will receive the update transitively upon install; their lockfiles must be refreshed to enable the env var feature downstream.
- Producer-side wiring is the responsibility of the producer implementation (parent processes must set the env var when spawning). Implementation is tracked per-producer.

**Cross-references:**

- [`packages/mcp/src/chain-root.ts`](packages/mcp/src/chain-root.ts) (`resolveChainRoot` helper + `genesisChainRoot` + `chainRoot`)
- [`packages/mcp/src/middleware.ts`](packages/mcp/src/middleware.ts) (signing path uses `resolveChainRoot`)
- [`packages/mcp/test/chain-root.test.ts`](packages/mcp/test/chain-root.test.ts) (priority cascade tests)
- [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records) (chain_root semantics)
- [§1.5.2](atrib-spec.md#152-http-transport-tracestate) (canonical traceparent propagation, priority 1)
- [§3.2.4](atrib-spec.md#324-edge-derivation-rules) (CHAIN_PRECEDES derivation tolerates tree-shaped chains)

---

## D066: Dashboard graph-viz library set: Sigma.js + dagre + graphology + cosmos.gl, lazy-loaded CDN, no build step

**Date:** 2026-05-06
**Context:** [D054](#d054-unified-public-explorer-vs-per-service-admin-uis) committed the explorer to a single-HTML-file no-build-step architecture (option 1 of three). The graph-rendering work for trace / session DAG / future creator activity / future global views needs concrete library choices that respect that constraint AND scale to the volumes the substrate is producing (one observed session: 243 nodes / 29403 SESSION_PRECEDES edges; future global view: 100k+ nodes).

Two independent decisions need to compose:

1. **Renderer.** What draws nodes + edges to the canvas / WebGL.
2. **Layout.** What computes (x, y) positions.

The dashboard's existing constraints:

- No build step ([D054](#d054-unified-public-explorer-vs-per-service-admin-uis)). Libraries must be available as browser-loadable UMD or ESM, fetched from a CDN.
- Single-HTML-file. No package.json, no bundler.
- Performance scales with substrate growth. Sigma's WebGL renderer handles 100k+ nodes; dagre's hierarchical layout chokes on 17k+ edges (O(V + E²) crossing detection freezes the main thread).

**Decision:** Use the following library set, lazy-loaded only when a graph view first renders so non-graph pages stay zero-byte:

| Library      | Version                           | Purpose                                                      | CDN      |
| ------------ | --------------------------------- | ------------------------------------------------------------ | -------- |
| `graphology` | 0.26.0                            | Graph data structure (nodes, edges, attributes)              | jsDelivr |
| `dagre`      | 0.8.5                             | Hierarchical (top-to-bottom) DAG layout                      | jsDelivr |
| `sigma`      | 3.0.0                             | Canvas / WebGL renderer (handles 100k+ nodes)                | jsDelivr |
| `cosmos.gl`  | (deferred to global-view rollout) | WebGL force-directed for the global view (100k+ nodes scale) | TBD      |

All three current libraries pinned with sha384 SRI integrity hashes. If jsDelivr serves a tampered file, the browser blocks it and the graph render fails closed (banner shown to user) instead of executing untrusted JS in `explore.atrib.dev`'s origin.

**Layout selection by graph shape.** The DAG renderer (`renderSigmaDAG` in `apps/dashboard/index.html`) picks a layout per-render:

- HIERARCHICAL_EDGE_TYPES present (`CHAIN_PRECEDES`, `INFORMED_BY`, `PROVENANCE_OF`, `ANNOTATES`, `REVISES`, `CONVERGES_ON`) AND total edges < `DAGRE_MAX_EDGES` (2000) → dagre top-to-bottom DAG. Right tool for ancestry / chain views.
- Otherwise (large + non-hierarchical, e.g. a session with no chain_root reconstruction so every record gets all-pairs `SESSION_PRECEDES`) → built-in circular layout (no library). Every node renders around a ring, edges cross the middle. Sigma's WebGL handles the rendering scale; the dagre layout step is what was choking.

Force-atlas2 would give nicer dense layouts than circular but is published as CommonJS only and needs `esm.sh` or local bundling, out of scope for the current iteration.

**Custom EdgeArrowProgram.** Sigma's stock arrow program scales the head proportionally to edge size, conflating "make arrow visible" with "make line thicker." The dashboard substitutes a custom arrow program via `Sigma.rendering.createEdgeArrowProgram({ lengthToThicknessRatio: 5, widenessToThicknessRatio: 6 })`, decoupling head prominence from line weight. Slim 2px lines, fat triangular heads.

**Edge-color palette in two semantic tiers.** Tier 1 (vibrant, meaning-carrying): `--edge-ancestry` (orange `#fb923c`, dedicated, no node analogue) for `INFORMED_BY` + `PROVENANCE_OF`; intentional aliases `--edge-annotates` / `--edge-revises` / `--edge-converges` track their paired node colors. Tier 2 (muted greys, structural, graded by strength): `--edge-chain` = `--text-2` (most common edge in any session graph but least semantically dense), `--edge-session-precedes` = `--text-3`, `--edge-session-parallel` = `--text-4`, `--edge-cross-session` = `--muted`. The aliasing IS the design statement: where an edge color tracks a node color, the `var(--et-*)` reference in CSS records the intent.

**Pair-aware legend.** Two-row grid; paired entries (annotation/ANNOTATES, revision/REVISES, transaction/CONVERGES_ON) stack in the same grid column on both rows; unpaired entries flow into a shared tail column that flexes independently per row, so neither row's tail inherits the other's content widths.

**Alternatives considered:**

- _Cytoscape.js (single library, both renderer and layout)._ Rejected: 5k node ceiling per its own docs. The substrate's growth rate makes that a 1-2 month problem at most; switching mid-flight when it fails would be more disruptive than picking the right library now.
- _D3 + d3-force._ Rejected for the renderer half: d3 is SVG-based, doesn't scale to 100k+ nodes. Acceptable for layout but cosmos.gl is the right fit for the WebGL global view.
- _Single library that does both renderer and layout (e.g., vis.js)._ Same scale ceiling as Cytoscape; same rejection.
- _Build the dashboard as a bundled SPA (option 2 per [D054](#d054-unified-public-explorer-vs-per-service-admin-uis))._ Rejected, contradicts [D054](#d054-unified-public-explorer-vs-per-service-admin-uis) option 1 commitment. Lazy-loaded CDN with SRI gives us the needed dependency footprint without bundling.
- _Inline the libraries in `index.html` instead of CDN._ Considered but rejected, would bloat the inline file from ~2400 lines to ~30k lines with minified library code, making the file unreadable for the "view source to learn" use case [D054](#d054-unified-public-explorer-vs-per-service-admin-uis) explicitly preserves.
- _Keep dagre for everything, accept main-thread freezes._ Rejected after observing the b5a2ebf8 session would freeze the browser. Layout-by-shape selector is the correct response.

**Consequences:**

- The trace view (`#/trace/<record_hash>`) and the session DAG view (`#/session/<context_id>`) ship with this library set.
- The creator activity map renders inside the existing identity view (`#/identity/<creator_key>`), NOT at a separate `#/creator/<key>/activity` route as the original draft of this ADR proposed. The natural product is one creator-centric route that absorbs both the directory-claim/sessions-list surface AND the activity-map graph; two routes would duplicate creator metadata and split the user's navigation between "browse this creator" and "see their activity graph." The identity view fetches `/v1/creators/<key>/graph` (spec [§3.4.7](atrib-spec.md#347-get-v1creatorscreator_keygraph)) below the existing sessions table and renders the response with `renderSigmaDAG` + `populateGraphLegend`; no new library.
- The global view (`#/global`, planned) introduces cosmos.gl as a second renderer for the 100k+ node scale; same data adapter `{nodes, edges}` flows through both renderers.
- The transaction settlement view (a future `#/transaction/<record_hash>` or upgraded `#/action/<record_hash>` for transaction-event records, planned) renders `CONVERGES_ON` edges from contributing records to the transaction node. Reuses `renderSigmaDAG`; same library set. Open question: separate route or inline upgrade of the action view when `event_type=transaction`.
- The cross-creator network view (planned, no route assigned yet) takes two or more `creator_key`s and visualizes records they jointly informed/annotated/revised plus their `session_token`-shared sessions. Reuses `renderSigmaDAG` for small networks; cosmos.gl when the joint-record set exceeds Sigma's comfortable scale.
- Future polish (legend click-to-highlight, hover spring, force-directed background motion, revision-aware rendering) builds on the same library set; Sigma's reducer-state pattern supports per-element re-render based on app state, which covers the interactive-legend + revision-applied-view roadmap items.
- Total dashboard CDN footprint: ~540KB (graphology 74KB + dagre 284KB + sigma 186KB), all three fetched only when a graph view first renders.
- SRI hashes must be regenerated whenever a version is bumped. Comment in `apps/dashboard/index.html` documents the procedure (`curl -sL <url> | openssl dgst -sha384 -binary | base64`).

**Cross-references:**

- [`apps/dashboard/index.html`](apps/dashboard/index.html) (the implementation)
- [`apps/dashboard/README.md`](apps/dashboard/README.md) (graph viz dependencies section)
- [D054](#d054-unified-public-explorer-vs-per-service-admin-uis) (the explorer architecture this builds on)

---

## D067: Multi-producer chain composition precedence contract

**Date:** 2026-05-07
**Context:** [D065](#d065-atrib_chain_tail_context_id-env-var-for-cross-producer-chain-tail-handoff) added `ATRIB_CHAIN_TAIL_<context_id>` to `@atrib/mcp`'s middleware as a third source for chain-root resolution between the inbound traceparent ([§1.5.2](atrib-spec.md#152-http-transport-tracestate)) and the synthetic genesis fallback. Verification against a live agent session showed wrapper-signed `tool_call` records correctly used the new env var (mcp-wrap is a long-running middleware instance that consumes the new env var), but cognitive primitives signed by `atrib-emit` subprocesses did not: a majority of the most recent `annotation`/`observation`/`revision` records on context `b5a2ebf81d43019ed658152d009ac927` carried `chain_root = sha256(context_id)`, the genesis chain root, meaning each emit subprocess produced an isolated single-record chain.

The cause was a duplicated chain resolver. `services/atrib-emit/src/auto-chain.ts` reimplemented chain-root selection with its own decision tree (file-as-IPC mirror inheritance) and never consulted the env var. The published packaging suggested otherwise, `@atrib/emit@0.4.2` declared `@atrib/mcp@0.5.0` as a dependency, but the runtime did not call into `resolveChainRoot`. Worse, the local resolver short-circuited on `callerContextId`: when a hook spawned `atrib-emit` with the agent's `context_id` set (so cognitive records would land on the same trace), the resolver returned `genesisChainRoot(callerContextId)` without consulting any other source, including the mirror-file inheritance the same module advertised.

The structural problem was duplication of chain-resolution logic across producers. The wrapper got the env-var fix; the emit subprocess did not. Without a normative contract at the spec level, every future producer joining the substrate would face the same drift hazard: reimplement the resolver to taste, miss whatever new resolution layer landed in `@atrib/mcp` last sprint, and silently produce malformed records. No co-producer test exercised both producers together, so the drift was invisible behind green CI.

**Decision:** Make multi-producer chain composition a normative spec-level contract, delivered through three parallel artifacts.

**Spec.** [§1.2.3.1](atrib-spec.md#1231-multi-producer-chain-composition) documents the precedence ordering as **MUST** language: inbound propagation token, within-process auto-chain tail, cross-producer env-var handoff, cross-producer mirror-file inheritance, synthetic genesis. The ordering reflects fidelity to the upstream signal (inbound is explicit, env-var is parent-set, mirror may lag). The mirror-file path requires filtering by `context_id` because chaining to a tail on a different context produces a malformed record.

**Reference implementation.** `resolveChainRoot` in `packages/mcp/src/chain-root.ts` is extended to accept a `mirrorTailHex` parameter and `inheritChainContext` in `packages/mcp/src/mirror.ts` orchestrates the file I/O + context_id inheritance. Both are exported from `@atrib/mcp`. `services/atrib-emit/src/auto-chain.ts` is deleted; `atrib-emit` calls `inheritChainContext` directly. Future cognitive-primitive producers (`atrib-recall`, `atrib-trace`, `atrib-summarize`) and any third-party producer in any language MUST use `resolveChainRoot` as the reference implementation or replicate it bit-for-bit against the corpus.

**Conformance corpus.** Conformance cases at `spec/conformance/1.2.3/multi-producer/cases/` exercise the precedence cascade plus malformation fall-through and namespace isolation. Producers in any language can consume the JSON and assert their resolver matches the expected `chain_root` per case. Reference test at `packages/mcp/test/conformance-1.2.3-multi-producer.test.ts`. A regression-style co-producer integration test at `services/atrib-emit/test/co-producer-chain.test.ts` exercises the full chain through the emit handler with simulated cross-producer state.

**Alternatives considered:**

- _Patch atrib-emit's local resolver to consult the env var, leave the duplicate alive ([Approach A])._ Rejected: papers over the symptom but leaves the drift class in place. Next time `@atrib/mcp` adds a new resolution source (e.g., session_token threading, capability-scoped chain rules), atrib-emit drifts again. We are back here.
- _Push chain coordination to the hook-helper layer ([Approach B])._ Rejected: hook helpers reading the recent chain tail from the mirror and passing `chain_root` explicitly via the emit tool's `chain_root` arg works, but it abandons the substrate's claim that the env-var/mirror handoff mechanism is universal. Every new hook-runtime would have to learn the dance.
- _Extract chain resolution to a new `@atrib/chain` package ([Approach C])._ Same drift properties as the chosen approach, plus cleaner module boundary. Deferred: `@atrib/mcp` already owns record types, signing, JCS canonicalization, sha256, chain resolution is in the same family. Pulling it into a new package is a defensible refactor but solves a problem the chosen approach solves equally well, with bigger refactor cost. Trigger to revisit: `@atrib/mcp` shipping multiple breaking minors driven by chain-resolution changes.
- _External coordination daemon ([Approach D])._ Rejected: introduces a runtime dependency that fails. The substrate's [§5.8](atrib-spec.md#58-degradation-contract) degradation contract is built on the assumption that producers can sign records _without_ a coordination service being up. Daemon-style coordination would make sense at multi-host scale, not for single-operator dogfood.

**Consequences:**

- Producers in `atrib-emit`, `mcp-wrap`, and future cognitive-primitive packages share one chain-resolution path, eliminating the drift class. A future producer joining the substrate writes one line of code (`await inheritChainContext({...})`) instead of reimplementing.
- The `inheritedFrom` value that surfaces in `inheritChainContext` results gains two new variants: `'env-tail'` and `'mirror-tail'` (replacing the prior `'wrapper-mirror'`). Producers consuming the value (currently only `atrib-emit` for warnings) must handle the new variants. Backward compatibility was not preserved; the rename removes ambiguity for callers.
- Live verification on a fresh emit post-fix: `chain_root != sha256(context_id)` for hook-spawned records sharing context with the wrapper. The rate of isolated-genesis records drops to zero for new emissions. Historical records signed before the fix remain immutable.
- Conformance corpus enforces the precedence contract for any producer claiming `@atrib/mcp@0.5.x` compliance. Producers in non-Node languages can consume the JSON corpus directly; the corpus README documents the input/expected schema.
- Spec [§1.2.3.1](atrib-spec.md#1231-multi-producer-chain-composition) is the new normative anchor. Future changes to the precedence ordering require regenerating the corpus, refreshing the reference implementation, and updating every producer's use site (tracked in CLAUDE.md sync-triggers).

**Cross-references:**

- [§1.2.3.1](atrib-spec.md#1231-multi-producer-chain-composition) (the normative precedence ordering)
- [`packages/mcp/src/chain-root.ts`](packages/mcp/src/chain-root.ts) (`resolveChainRoot` reference implementation)
- [`packages/mcp/src/mirror.ts`](packages/mcp/src/mirror.ts) (`readMirrorTail` + `inheritChainContext` orchestration)
- [`packages/mcp/test/chain-root.test.ts`](packages/mcp/test/chain-root.test.ts) (priority cascade unit tests)
- [`packages/mcp/test/mirror.test.ts`](packages/mcp/test/mirror.test.ts) (mirror reader + inheritance orchestration tests)
- [`packages/mcp/test/conformance-1.2.3-multi-producer.test.ts`](packages/mcp/test/conformance-1.2.3-multi-producer.test.ts) (corpus reference test)
- [`services/atrib-emit/test/co-producer-chain.test.ts`](services/atrib-emit/test/co-producer-chain.test.ts) (regression integration test)
- [`spec/conformance/1.2.3/multi-producer/`](spec/conformance/1.2.3/multi-producer/) (the conformance corpus)
- [D065](#d065-atrib_chain_tail_context_id-env-var-for-cross-producer-chain-tail-handoff) (the env-var primitive this contract formalizes)

---

## D068: trace operations split, provenance trace vs causal chain

**Date:** 2026-05-07
**Context:** graph-node ships a `/v1/trace/{record_hash}` endpoint that walks producer-claimed ancestry edges (INFORMED_BY, ANNOTATES, REVISES). The endpoint exists in the implementation but was not codified in the spec, [§3.4](atrib-spec.md#34-query-api) defined `/v1/graph/...` and `/v1/creators/...` endpoints but said nothing about trace operations. Reviewing the dashboard's trace view surfaced a separate gap: most production records (~71%, the union of `tool_call` records and `observation` records emitted without `informed_by`) show the message "no informed_by, annotates, or revises edges into the resolved set," because those producer-set fields are typically absent. CHAIN_PRECEDES edges, derived structurally from `chain_root` per [§3.2.4](atrib-spec.md#324-edge-derivation-rules), connect those records into their session chain, but the trace endpoint did not walk them.

**Decision.** Codify two distinct trace operations in [§3.4](atrib-spec.md#34-query-api), separated along the structure-vs-claims axis that [§3.1](atrib-spec.md#31-design-principles-and-rationale) establishes for the graph layer overall.

**Provenance trace** at [§3.4.5](atrib-spec.md#345-get-v1tracerecord_hash) walks INFORMED_BY, ANNOTATES, REVISES, every edge is derived from a field the producer explicitly set, naming a specific prior record as informing, annotating, or revising the current one. Provenance trace MUST NOT walk CHAIN_PRECEDES.

**Causal chain** at [§3.4.6](atrib-spec.md#346-get-v1chainrecord_hash) walks CHAIN_PRECEDES, the substrate-derived ordering edge linking each record to its immediate predecessor in the same `context_id`. Causal chain MUST NOT walk INFORMED_BY, ANNOTATES, or REVISES.

The two endpoints answer different questions: provenance trace answers "what did the producer claim informed this record?" and causal chain answers "what did the substrate observe came before this record in the same context_id?" Consumers needing both views compose the responses client-side.

**Rationale.** The structure-vs-claims separation is the same boundary [§1.2.5](atrib-spec.md#125-informed_by) establishes for `informed_by` (optional, signed claim) and [§1.2.6](atrib-spec.md#126-provenance_token) for `provenance_token` (signed claim, genesis-only). The graph layer ([§3.1](atrib-spec.md#31-design-principles-and-rationale) "the graph records structure, not causality") declares the same boundary at the data-model level. A trace operation that walked both layers would conflate "what the agent said happened" with "what the substrate observed happened", the exact distinction this protocol's invariants exist to preserve.

**Alternatives considered.**

1. _Extend `/v1/trace/{record_hash}` with a `?include_chain_precedes=true` query parameter._ Rejected. The query parameter would let one endpoint return both layers, but the response shape would mix them in the same `edges[]` array. Consumers reading the response could not tell which edges were producer-claimed and which were substrate-derived without inspecting `edge.type`. The two-endpoint shape exposes the boundary at the protocol layer.

2. _Single `/v1/trace/{record_hash}` walking all four ancestor edge types._ Rejected for the same reason as alternative 1, with the additional cost that backward-compatibility for existing consumers expecting only producer-claimed edges would require a versioning shim.

3. _Leave the gap in place._ Rejected. The dashboard's "no ancestors" message, repeated across the majority of production records, made it look as though the substrate had failed to capture causal ordering. The substrate had captured it (in `chain_root`); the trace endpoint had simply not surfaced it. Codifying both operations resolves the apparent gap without inventing new edge types or modifying producer behavior.

**Consequences.**

- [§3.4](atrib-spec.md#34-query-api) gains [§3.4.5](atrib-spec.md#345-get-v1tracerecord_hash) and [§3.4.6](atrib-spec.md#346-get-v1chainrecord_hash) as new normative subsections. The existing `/v1/trace/{record_hash}` implementation in `services/graph-node/src/server.ts` is the reference for [§3.4.5](atrib-spec.md#345-get-v1tracerecord_hash); its current behavior aligns with the new specification, so the implementation requires no functional change beyond the documentation header and endpoint comment.
- `services/graph-node/src/server.ts` adds a new `/v1/chain/{record_hash}` handler walking CHAIN_PRECEDES backward from the starting record. The walk terminates at the session's genesis record (where `chain_root = SHA-256(context_id)`).
- `apps/dashboard/index.html` trace view renders both ancestor sections: "Provenance ancestors" (existing) and "Chain predecessors" (new), labeled so users can distinguish producer-claimed ancestry from substrate-derived ordering. The previous "no ancestors" message becomes "no provenance ancestors; see chain predecessors below" when one section is empty and the other has results.
- No producer behavior change. `@atrib/mcp` does NOT auto-populate `informed_by` for tool_call records; that would invent a causal claim the producer has no evidence for, violating the structure-vs-claims invariant. Producers continue to set `informed_by` only when they have evidence (e.g., the cognitive extractor reading transcripts).
- Future: a deeper extension of cognitive-primitive producers to set `informed_by` on observations based on transcript evidence is tracked as a follow-up under the existing [P008](#p008-referent-matched-revision-and-annotation-emission-from-the-cognitive-extractor) referent-matched emission pattern.

**Cross-references.**

- [§3.4.5](atrib-spec.md#345-get-v1tracerecord_hash) (provenance trace operation)
- [§3.4.6](atrib-spec.md#346-get-v1chainrecord_hash) (causal chain operation)
- [§3.1](atrib-spec.md#31-design-principles-and-rationale) (the structure-vs-claims principle this decision applies)
- [§3.2.3](atrib-spec.md#323-edge-types) (the edge-type taxonomy the two operations partition)
- [§3.2.4](atrib-spec.md#324-edge-derivation-rules) (CHAIN_PRECEDES derivation)
- [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records) (chain_root contract feeding causal chain)
- [§1.2.5](atrib-spec.md#125-informed_by) (informed_by feeding provenance trace)
- [§1.2.7](atrib-spec.md#127-annotates) (annotates feeding provenance trace)
- [§1.2.9](atrib-spec.md#129-revises) (revises feeding provenance trace)

---

## D069: Runtime integration patterns, first-class peers, no canonical path

**Date:** 2026-05-09

**Context:** A field study of 48 agent harnesses (22 in round 1, 26 in round 2, surveyed 2026-05-08) showed that ~97% of records in atrib's production substrate flow through Claude-Code-specific Layer-2 hooks (`atrib-tool-emit-helper.mjs` invoked by `atrib-mcp-hook.mjs` + `atrib-builtin-hook.mjs`). The substrate's portability claim, that atrib produces a verifiable record of agent actions regardless of which harness an agent runs in, was empirically narrow.

The narrowness was not a structural problem with the substrate; it was an integration-coverage problem. Six integration patterns across the surveyed harnesses cover every harness category with no significant residual:

- **Lifecycle hooks** (Claude Code, Cursor, OpenAI Codex CLI, Browser-Use, CrewAI hooks, Augment Code Auggie SDK, Pi/Earendil events API), stdin-JSON IPC contract, deny/allow/modify decisions on PreToolUse/PostToolUse boundaries.
- **In-process MCP middleware** (Goose, Continue, Cody, Claude Code MCP-served tools, opencode, Browserbase/Stagehand transitively), atrib mounted as an MCP server fronting upstream tools; per-call signing happens at the protocol boundary.
- **Callback / lifecycle handlers** (LangGraph BaseCallbackHandler, CrewAI tool_hooks, AutoGen InterventionHandler, Microsoft Agent Framework middleware, Anthropic Agent SDK HookCallback, smolagents step_callbacks, OpenAI Agents RunHooks/AgentHooks, Vercel AI tool wrapping, Flue setEventCallback, Google ADK community-extensions), SDK-native interception of tool invocation.
- **OpenInference SpanProcessor** (Vercel AI native, OpenAI Agents native, Claude Agent SDK Python instrumentation, smolagents via OpenInference, CrewAI optional, LangChain/LangGraph via OpenInference + LangSmith bridge, LlamaIndex, DSPy, MCP itself instrumented, Strands Agents OTel-native, Bedrock AgentCore via planned OTel integrations), atrib reads the openinference.tool.\* span attributes that already carry semantic LLM/agent conventions on top of OpenTelemetry. The OpenInference repo currently maintains 33 Python instrumentations + 9 JS packages.
- **Post-hoc API import + consumer re-sign** (Cursor Cloud Agents, Devin, Manus, Operator, Bolt/v0/Lovable), closed-loop runtimes that own the trace; the consumer pulls the vendor's session events via a public API, re-signs each step under the consumer's atrib key, and anchors to the public log. The signature attests to _the consumer's observation of what the vendor reported_, not to the vendor's truthfulness. Pattern #5b is a session-level fallback when a vendor's API returns only chat history or summary text, not structured per-step actions.
- **Streaming interceptor** (OpenAI Realtime API, future voice/multimodal harnesses, WebSocket-based agent runtimes), sits in the streaming protocol path, signs each tool-dispatch frame as it passes through, with concurrent-path signing to avoid breaking the streaming latency contract.

The original "wrap every MCP at zero per-server cost" framing positioned `@atrib/mcp-wrap` as the universal interception path. The Layer-2 hook architecture (May 4-5) showed this framing was too narrow: hooks intercept everything in hook-equipped harnesses; the wrapper intercepts MCP traffic specifically. Treating one of the five as canonical and the others as alternatives produced an integration-coverage gap that surfaced as the portability concern in dogfood.

**Decision.** Codify the six integration patterns as **first-class peers** in spec [§9](atrib-spec.md#9-runtime-integration-patterns). None is canonical. Each carries its own informative pattern documentation, conformance contract scope ([D048](#d048-plug-and-play-enforcement-contract-for-adapters) extended to per-pattern adapter conformance), and per-pattern reference implementation. A harness builder picks the pattern its runtime ergonomics support; multiple patterns can compose for one runtime when the runtime supports more than one (Claude Code supports both Lifecycle hooks AND In-process MCP middleware concurrently).

**The six patterns and their reference implementations:**

| Pattern                       | Reference implementation                                                                                                                                                                                                                                                                                  | Lives in                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Lifecycle hooks               | hook helper subprocessing the `atrib-emit` MCP                                                                                                                                                                                                                                                            | per-host hook scripts                                     |
| In-process MCP middleware     | `@atrib/mcp-wrap`                                                                                                                                                                                                                                                                                         | `packages/mcp-wrap/`                                      |
| Callback / lifecycle handlers | `@atrib/agent` framework adapters per [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow), [D024](#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private) | `packages/agent/src/adapters/`                            |
| OpenInference SpanProcessor   | `@atrib/openinference` (planned)                                                                                                                                                                                                                                                                          | new package                                               |
| Post-hoc API import           | per-runtime adapters (planned, deferred per [D-V4-43](#d-v4-43-tracker)); Cursor Cloud Agents recommended as first reference target                                                                                                                                                                       | likely `services/atrib-{runtime}-adapter/`                |
| Streaming interceptor         | not yet built; deferred until a streaming runtime integration target is selected                                                                                                                                                                                                                          | likely a transform-stream library or per-protocol adapter |

**The wrapper role narrowing.** `@atrib/mcp-wrap` retains its current implementation but its docs framing changes: from "wrap every MCP at zero per-server cost" (the original 2026-05-04 pitch) to "Pattern #2, in-process MCP middleware. Required for transaction records ([D052](#d052-cross-attestation-requirement-for-transaction-records)), preCallTransform ([D057](#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding)), payment-protocol cross-attestation, and any MCP-native host (Goose, Continue, Cody)." This re-frame is informative; no breaking changes to the wrapper API.

**Per-pattern conformance contract.** [D048](#d048-plug-and-play-enforcement-contract-for-adapters) established the conformance contract for adapters under what was at the time the dominant pattern (callback/lifecycle handlers in `@atrib/agent`). The contract extends pattern-by-pattern: the same observable behaviors (passthrough, `_meta` injection or equivalent, no caller mutation, response flow, idempotency, [§5.8](atrib-spec.md#58-degradation-contract) degradation) MUST hold for every pattern's reference implementation, with pattern-specific test surfaces. The lifecycle-hook test surface is end-to-end against a fake hook envelope; the OpenInference test surface is a fake SpanProcessor consuming canonical openinference attributes; the post-hoc API test surface is a fake vendor API returning canonical session events.

**Alternatives considered:**

- _Canonicalize one pattern as primary; treat others as fallbacks ([Approach A])._ Rejected: this is the framing the original wrapper pitch implicitly used and the framing the Layer-2 hook adoption broke. There is no single pattern that fits every harness category, the five categories surveyed each have ergonomic constraints (interactive vs batch, hook-equipped vs not, in-process vs hosted, structured-trace-API vs message-history-only) that exclude at least one of the other four. Canonicalizing one would orphan some category.

- _Ship a "universal adapter" abstraction layer that all five patterns implement ([Approach B])._ Considered. The unified abstraction would expose `AdapterContract { onToolCallPre, onToolCallPost, onSessionStart, onSessionEnd }` and each pattern would supply the surface. Rejected for atrib v1 because the cross-pattern interface drift (lifecycle hooks have deny/allow/modify, OpenInference has spans-not-events, post-hoc has no real-time, callback handlers vary across SDKs) would force lowest-common-denominator compromises that erode each pattern's strengths. Worth revisiting in a future ADR if cross-pattern compositions surface real friction.

- _Defer the codification until benchmarks land ([Approach C], the [D-V4-43](#d-v4-43-tracker) dogfood-first reading)._ Rejected for the spec section but accepted for the implementation work. The taxonomy itself is decided now (the field study made the categories explicit and durable), and codifying the patterns enables anyone, first or third party, to start an adapter against the spec contract without waiting for benchmarks. Deferring the spec codification while shipping new adapter implementations would re-create the pattern-fragmentation that drove this ADR. Adapter-build sequencing remains [D-V4-43](#d-v4-43-tracker)-aligned: prioritize adapters that extend dogfood (Phoenix/OpenInference + Browser-Use) over adapters that are integration-partner-flavored (Cursor + Codex + post-hoc API), aligned with [D-V4-43](#d-v4-43-tracker) sequencing.

**Consequences:**

- atrib-spec.md gains [§9](atrib-spec.md#9-runtime-integration-patterns) "Runtime Integration Patterns" as a new informative section after [§8](atrib-spec.md#8-privacy-postures). The section parallels [§7](atrib-spec.md#7-harness-integration-patterns) "Harness Integration Patterns", [§7](atrib-spec.md#7-harness-integration-patterns) covers the agent's view of atrib once mounted (session-start surfacing, recall tool, persisted mirror, reasoning chains, outcome verification); [§9](atrib-spec.md#9-runtime-integration-patterns) covers how a runtime mounts atrib in the first place. The two are orthogonal: a harness picks one [§9](atrib-spec.md#9-runtime-integration-patterns) integration pattern AND any subset of [§7](atrib-spec.md#7-harness-integration-patterns) consumption patterns.

- `packages/mcp-wrap/README.md` re-frames the wrapper as Pattern #2 (in-process MCP middleware). The "wrap every MCP at zero per-server cost" pitch is demoted to historical context. No functional changes.

- `packages/agent/README.md` re-frames its adapter table under Pattern #3 (callback / lifecycle handlers). Each existing adapter ([D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow), [D024](#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private)) is one Pattern #3 instance.

- A new package `@atrib/openinference` is planned for Pattern #4. The OpenInference span schema is the integration boundary; the package reads `openinference.tool.name`, `openinference.input.value`, `openinference.output.value`, etc., and constructs AtribRecord content from each tool span on `onEnd`.

- A reference implementation for Pattern #5 (post-hoc API import + operator re-sign) is deferred per [D-V4-43](#d-v4-43-tracker). The pattern is documented in [§9](atrib-spec.md#9-runtime-integration-patterns) so consumers can build their own; atrib's reference implementation lands when Devin or Operator API access becomes available + benchmarks unblock outward-facing work.

- [D048](#d048-plug-and-play-enforcement-contract-for-adapters) conformance contract scope extends pattern-by-pattern. The existing `packages/agent/test/conformance.test.ts` covers Pattern #3; per-pattern conformance test surfaces are tracked as follow-ons (one per shipped adapter).

- The runtime-adapter spec revival reframes the deferred [P002](#p002-agent-bridge-on-atrib-substrate) atrib-bridge prototype. [P002](#p002-agent-bridge-on-atrib-substrate)'s "proves substrate generalizes" goal is what [§9](atrib-spec.md#9-runtime-integration-patterns) makes structural. The atrib-bridge work continues as a Pattern #5 instance once a target runtime API is selected.

**Cross-references:**

- [§9](atrib-spec.md#9-runtime-integration-patterns) (the normative section this ADR introduces)
- [§7](atrib-spec.md#7-harness-integration-patterns) (orthogonal section: agent-side patterns once mounted)
- [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow), [D024](#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private) (existing Pattern #3 adapter ADRs)
- [D048](#d048-plug-and-play-enforcement-contract-for-adapters) (the conformance contract this ADR extends per-pattern)
- [D052](#d052-cross-attestation-requirement-for-transaction-records) (transaction records require Pattern #2 wrapper for cross-attestation)
- [D057](#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding) (preCallTransform requires Pattern #2 wrapper)
- A synthesized field study across 48 agent harnesses surveyed in early May 2026 drives the findings codified in this ADR

---

## D070: Record Body Archive Layer

**Date:** 2026-05-07. Updated 2026-06-01.

**Status:** Accepted.

**Extends:** [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), and [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks).

**Context.**

The atrib log commits to a record's hash, not its body ([§2.3](atrib-spec.md#23-log-entry-format), [§2.10](atrib-spec.md#210-what-the-log-stores-and-what-it-does-not)). This separation preserves the salted-commitment privacy posture ([§8.3](atrib-spec.md#83-salted-commitment-posture)) and bounds log storage cost. It also creates a verifiability gap: a verifier with only the public commitment cannot re-canonicalize the record and re-check its signature without obtaining the body from somewhere.

[D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) addresses the producer side, the producer-local mirror always carries the canonical body. But producer-local-only durability is brittle: if the producer's mirror is wiped, the body is unrecoverable forever. [§2.12](atrib-spec.md#212-record-body-archive-layer) introduces a separate Record Body Archive Layer to close this gap for records whose privacy posture admits public-body retrieval.

MCP/OAuth evidence made the product need concrete. The explorer can render `evidence[]`, but the public log lookup cannot return bodies or sidecar material without violating the commitment-only log boundary. A separate archive can serve bodies and verifier evidence for records whose producer deliberately opts in.

**Decision.** The Record Body Archive Layer is implemented as `services/archive-node`, a private deployable service separate from `log-node`.

1. The archive exposes `POST /v1/records`, `GET /v1/record/<record_hash_hex>`, `GET /v1/evidence/<record_hash_hex>`, and `GET /v1/retention`.
2. Submission is content-addressed and idempotent. The archive canonicalizes the supplied `record`, computes `record_hash`, verifies the record signature, and confirms the hash is committed in at least one trusted log before accepting.
3. The archive stores full signed record bodies, optional log proofs, optional `authorizationEvidence` verifier inputs, optional precomputed `evidence[]` result blocks, and optional `resolvedFacts`.
4. Retrieval returns the full record body plus log proofs, retention metadata, resolved facts, and verifier evidence result blocks.
5. The evidence projection endpoint returns only the record summary, resolved facts, and `evidence[]` blocks needed by the explorer action view.
6. Retention is explicit through `/v1/retention`; expired records return `410 Gone`, distinct from `404 Not Found`.
7. The public explorer queries `archive.atrib.dev/v1/evidence/<hash>` opportunistically and merges any returned `evidence[]` blocks into the action receipt. A missing archive body does not affect the log lookup view.

**Alternatives considered.**

- _Return bodies from `log-node`._ Rejected. That collapses the commitment log and body archive into one trust surface and weakens the privacy posture that motivated fixed log entries.
- _Make archive submission mandatory._ Rejected. Records using salted commitments or producer-local-only evidence must remain valid. Archive availability is a retrieval tier, not a record-validity rule.
- _Only store full bodies, not evidence projections._ Rejected. Explorer and lightweight verifier clients need a small evidence surface without fetching full bodies by default.
- _Accept any submitted body without log confirmation._ Rejected for production. That would let the archive become a store for uncommitted material. The reference service has an explicit dev-only bypass for isolated tests.

**Consequences.**

- atrib now has a production body/evidence API while keeping the public log commitment-only.
- Explorer action receipts can show MCP/OAuth or other verifier evidence when an archive body exists.
- The archive operator can suppress or expire bodies, but cannot fabricate them because every returned body must hash to a public log commitment.
- Full federation policy and signed retention checkpoints remain future hardening. The V1 service's content-addressing and retention manifest leave those additions compatible.

**Cross-references:**

- [§2.12](atrib-spec.md#212-record-body-archive-layer) (Record Body Archive Layer; the spec surface this ADR codifies)
- [§2.5.4](atrib-spec.md#254-point-lookup-endpoint-optional) (log point-lookup; no body; redirects callers to the archive layer)
- [§2.10](atrib-spec.md#210-what-the-log-stores-and-what-it-does-not) (log scope boundary)
- [§5.9](atrib-spec.md#59-local-mirror-conventions) (producer-local mirror; the other body-availability path)
- [§8.3](atrib-spec.md#83-salted-commitment-posture) (privacy posture that opts out of archive submission)
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) (two-tier private-local + public-canonical persistence on the producer side)
- [`services/archive-node/`](services/archive-node/), reference archive implementation.
- [`spec/conformance/2.12/`](spec/conformance/2.12/), archive API conformance corpus.

---

## D071: Spec writing conventions

**Date:** 2026-05-09

**Context:** The atrib specification grew from [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) through [D070](#d070-record-body-archive-layer) over six weeks of intensive spec work. Sections written across that stretch varied in their treatment of normative vs informative status, cross-reference style, conformance-corpus binding, and pattern-subsection layout. Drift across these dimensions creates two costs. First, readers integrating against the spec face inconsistent claims: a `MUST` in one section means "verifier rejects on violation," in another section it means "implementations should agree but no test vector enforces." Second, the spec maintenance contract erodes: if [§3](atrib-spec.md#3-graph-query-interface) patterns follow one template and [§9](atrib-spec.md#9-runtime-integration-patterns) patterns follow another, future sections have no clear template to copy.

The [§9](atrib-spec.md#9-runtime-integration-patterns) + [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path) work applied a consistent set of conventions across new spec material. Those conventions, applied informally, are the de facto standard. Without codification, future sections may drift away from them as new contributors adopt different defaults.

**Decision.** Adopt ten conventions as binding for new spec material and for substantive edits to existing spec material. Existing material that predates this ADR is grandfathered and migrated opportunistically, not by sweep.

The ten conventions:

1. **Section status declaration.** Each spec section MUST declare its status explicitly at the top with one of: `_This section is normative._` or `_This section is informative._`. Mixed sections SHOULD be split.

2. **RFC 2119 language for normative claims.** Normative claims MUST use RFC 2119 keywords (`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`) where the spec defines a verifier or implementation constraint. Informative prose MUST NOT use these keywords.

3. **Inline cross-references via markdown anchor links.** Cross-references to spec sections MUST use the form `[§N.M](atrib-spec.md#nm-anchor)`. Cross-references to ADRs MUST use the form `[Dxxx](DECISIONS.md#dxxx-slug)`. Bare `§N` or `Dxxx` references without anchor links are prohibited; `scripts/check-doc-sync.mjs` enforces this mechanically.

4. **Pattern subsection template.** Spec sections that enumerate patterns (currently [§7](atrib-spec.md#7-harness-integration-patterns) and [§9](atrib-spec.md#9-runtime-integration-patterns)) MUST use the consistent template: `Where it fits` / `How atrib mounts` (or equivalent integration verb) / `Causality formation` / `Reference implementation` / `Trade-offs`. The template provides reader predictability across patterns.

5. **Reference implementation status tags.** Every reference implementation cited in the spec MUST be tagged either as shipped (with package path) or planned (with sequencing note pointing at the ADR or tracker row that owns the build).

6. **Conformance corpus is jointly normative with Appendix A.** When a spec section ships a conformance corpus, the corpus and Appendix A test vectors are jointly normative; the spec body MUST declare which form is canonical for each case. Implementations conform when they pass both surfaces.

7. **Prose audit on every push.** Spec material MUST pass the Layer A regex catalog and Layer B semantic audit per [D049](#d049-layered-leak-defense-regex--llm-semantic--cloud-audit--style-guide) before any push. The audit bans non-public vocabulary that erodes the spec's public-facing voice.

8. **Sync triggers updated when sections change.** When a spec section is added, removed, or substantively changed, the `CLAUDE.md` sync-triggers table MUST gain a corresponding row naming the downstream surfaces (other spec sections, package READMEs, conformance corpora, scripts) the change propagates to.

9. **ADR template.** Every ADR in DECISIONS.md MUST include `Date`, `Context`, `Decision`, `Alternatives considered`, `Consequences`, `Cross-references` sections. Placeholder ADRs (forward-looking, awaiting the work that codifies the decision) MAY use a shorter form but MUST declare placeholder status explicitly.

10. **Architectural framing, not session narrative.** ADRs MUST be written in the architectural register: what the constraint is, why it holds, what it rejects. ADRs MUST NOT use first-person session narrative or incident-framing language. The history that produced the decision belongs elsewhere, not in the ADR record itself.

**Alternatives considered:**

- _Keep the conventions informal._ Considered. The argument: drift has not yet been a documented problem, so codification is premature optimization. Rejected because the [§9](atrib-spec.md#9-runtime-integration-patterns) + [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path) work was the first stretch of spec development where multiple convention dimensions interacted (status declaration + pattern subsection template + sync triggers + prose audit), and the conventions held only because they were applied consistently during that stretch. A future contributor with different defaults would silently drift, and the drift would be costly to repair after the fact.

- _Adopt some conventions but not others._ Considered. Specifically, codify the binding ones (RFC 2119, anchor links, prose audit, sync triggers) and leave the softer ones (pattern template, ADR template, status tags) informal. Rejected because partial codification creates ambiguity at the boundary: a reader cannot tell which conventions are binding without consulting both this ADR and an informal convention set elsewhere. Codifying all ten or none avoids the gray zone.

- _Codify in a separate `SPEC-STYLE.md` document instead of an ADR._ Considered. The argument: style guides typically live outside the decision log. Rejected because the conventions are decisions about how the spec is maintained, not just stylistic preferences. They belong in DECISIONS.md so that future ADRs can cite them and so that the sync-triggers contract applies to them like every other binding decision.

**Consequences:**

- New spec sections written after this ADR MUST follow all ten conventions. `scripts/check-doc-sync.mjs` enforces conventions 3 and 8 mechanically. `scripts/check-leaks.mjs` and `scripts/check-leaks-semantic.mjs` enforce convention 7. The other conventions are enforced by review.

- Existing spec sections predating this ADR are grandfathered. Substantive edits to those sections (more than a typo or small clarification) bring the section in scope; the editor migrates the section to convention compliance as part of the edit.

- Future ADRs follow convention 9 (template) and convention 10 (architectural framing). The convention-9 template matches the structure [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path) and [D070](#d070-record-body-archive-layer) use; no new structure is required.

- A new `CLAUDE.md` sync-triggers row is added for [D071](#d071-spec-writing-conventions) itself: when conventions are revised, this ADR is the canonical source; downstream surfaces include `scripts/check-doc-sync.mjs` (if mechanical enforcement extends), the spec sections currently following the conventions, and any documentation that referenced the prior informal status.

**Cross-references:**

- [D048](#d048-plug-and-play-enforcement-contract-for-adapters) (spec-side conformance contract for adapters; this ADR is the prose-side conformance contract for the spec itself)
- [D049](#d049-layered-leak-defense-regex--llm-semantic--cloud-audit--style-guide) (Layer-B prose audit; convention 7 inherits the existing audit pipeline)
- [D060](#d060-changelog-strategy--changesets-per-package--github-releases) (CHANGELOG voice; the same public-facing framing applies)
- [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path) (the most recent substantive ADR; first ADR to apply all ten conventions consistently)

---

## D072: Orphan handling, synthesize fresh, never inherit from mirror tail

**Date:** 2026-05-09

**Context:** `inheritChainContext` in `@atrib/mcp` resolves `{contextId, chainRoot}` for a producer about to sign a record. When the caller supplied no `callerContextId`, the prior implementation read the mirror tail and inherited BOTH the most-recent record's `context_id` AND its hash as the new record's `chain_root` (label: `'mirror-context-and-tail'`).

In production, runtime-side miswires were inevitable. A Layer-2 hook that failed to thread its host's session identifier through to the producer caused every tool call from that hook to land without a `callerContextId`. Each such record then absorbed the mirror tail's context, producing one pseudo-session that accumulated records across many real sessions: a single `context_id` carried 1500+ records spanning 6+ days of unrelated work. The orphan provenance was structurally unrecoverable: a downstream consumer reading the chain saw what looked like one continuous session, with no signal distinguishing real session continuation from orphan absorption.

The mirror-tail-inheritance fallback was meant to soften the case where a caller didn't manage chain state. The actual cost was higher than the convenience: it converted a recoverable runtime miswire into unrecoverable substrate-level pollution.

**Decision.** When `inheritChainContext` is called with no `callerContextId`, the producer MUST synthesize a fresh random `context_id` and a genesis `chain_root` for it. The result MUST be marked `inheritedFrom = 'fresh-orphan'` so consumers can distinguish "caller didn't pass context_id" from "caller passed context_id but no chain_root and the session is brand-new" (the latter remains `'fresh'`). The `'mirror-context-and-tail'` label is removed from the `ChainContext` union; producers MUST NOT consult the mirror tail for `context_id` inheritance.

The orphan record lands in its own isolated context. Multiple orphans from the same producer process land in DIFFERENT `context_id`s, since the synthesized value is per-invocation. Producers that want orphan clustering for forensic reasons MAY cache a per-process synthetic and reuse it; this is producer-side polish, not normative.

Recall, trace, and summarize MAY filter records produced under `inheritedFrom === 'fresh-orphan'` from default queries; consumers that want to see orphan provenance MAY surface them with an explicit flag. The substrate carries enough signal for either rendering.

**Alternatives considered:**

- _Keep the mirror-tail inheritance._ Rejected. The convenience of "the record finds a chain to attach to" is exactly the cost: it absorbs orphans silently. Convenience that erodes ground truth is a bad trade.

- _Refuse to sign records when caller passes no `context_id` (fail closed)._ Considered. This would force runtime-side correctness with the strongest possible signal. Rejected because it conflicts with the [§5.8](atrib-spec.md#58-degradation-contract) degradation contract: atrib failures MUST NOT affect the primary tool call. A producer that throws on missing `context_id` would either propagate to the host (violating the degradation contract) or be silently swallowed (worse). Synthesizing a fresh isolate honors the degradation contract while preserving orphan identifiability.

- _Per-process synthetic context_id (cluster all orphans from one process)._ Considered. This would make forensic clustering easier ("process X had N orphans during this period under context Y"). Rejected as the default because the per-call synthesis is simpler and has no process-state to manage; `mcp-wrap` and `atrib-emit` typically run as short-lived subprocesses where per-call and per-process degenerate to the same thing; producers that want clustering can cache a synthetic at their layer. Available as producer-side polish; not normative.

- _Sidecar tag on orphan records (`_local.fallback: 'orphan'`)._ Considered as a complement, not an alternative. The producer-side mirror sidecar (per [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)) MAY carry a `fallback` field marking the orphan provenance. This is non-normative producer convention; the signal consumers need is `inheritedFrom`, which is in the producer's resolved context (not the signed record itself).

**Consequences:**

- `packages/mcp/src/mirror.ts` `inheritChainContext` branch (3) collapses: always synthesize fresh, never read mirror tail. The `'mirror-context-and-tail'` label is removed from the `ChainContext` union; `'fresh-orphan'` is added.

- `packages/mcp/test/mirror.test.ts` updated: the test that asserted mirror-tail inheritance for the no-caller-context case now asserts orphan synthesis. The new test verifies that even when a mirror tail exists, the resolved context_id differs from the tail's.

- Layer-2 hook miswires remain the runtime-side fix path. This ADR does NOT relax the requirement that runtimes pass session identifiers properly; it changes what happens when they don't.

- Orphan detection becomes substrate-level: any consumer reading a producer's resolved context can identify `inheritedFrom === 'fresh-orphan'` and surface the orphan accordingly. Recall and trace MAY filter; the substrate-health surface SHOULD count orphans as a producer-side signal worth flagging.

- The 1500+-record pseudo-session that surfaced this footgun is historical, already on the public log. New records from the same producer-side miswire pattern, if any recur, will land in isolated contexts and will not pollute existing chains.

**Cross-references:**

- [D067](#d067-multi-producer-chain-composition-precedence-contract) (multi-producer chain composition precedence; this ADR governs the case upstream of [D067](#d067-multi-producer-chain-composition-precedence-contract)'s precedence cascade, when no `context_id` is supplied at all)
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) (local mirror sidecar; producer-side polish MAY add `fallback: 'orphan'` sidecar metadata)
- [§1.5.1](atrib-spec.md#151-context_id-the-session-anchor) (the session anchor; runtimes that don't produce OTel SHOULD generate a random 16-byte value and use its hex encoding as `context_id`)
- [§5.8](atrib-spec.md#58-degradation-contract) (degradation contract; honored by synthesizing rather than failing closed)
- [D071](#d071-spec-writing-conventions) (spec writing conventions; this ADR follows convention 9 template + convention 10 architectural framing)

---

## D073: `handoff` event_type byte (placeholder ADR)

**Date:** 2026-05-09

**Status:** Placeholder. The byte is reserved at the design level; full normative promotion follows the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar (five-indicator evaluation) when a producer demonstrably needs it. A multi-agent harness field study motivates the design but does not constitute production demand.

**Context:** Multi-agent orchestration platforms (OpenAI Agents SDK, Microsoft Agent Framework, AutoGen, LangGraph, CrewAI) routinely model an explicit "handoff", one agent transfers control to another with a structured envelope distinct from a tool call or transaction. atrib producers currently represent these as `tool_call` records whose `tool_name` happens to encode the handoff semantic ("transfer_to_planner", "delegate_to_executor"). Verifiers reasoning about cross-agent causality must inspect `tool_name` strings to recover the handoff structure, fragile, producer-dependent, and not enforceable.

A normative `handoff` event_type would let verifiers identify handoffs by byte rather than string match, enable structural validation (e.g., handoff records SHOULD reference the previous agent's chain tail via `informed_by` or carry the recipient agent's `creator_key` in content), and unblock multi-agent demos / benchmarks that want to count handoffs as a substrate-level metric.

**Decision (placeholder).** Reserve byte `0x07` for `handoff`. Full promotion happens via a future ADR that demonstrates:

1. **Adoption signal**: at least one producer (in atrib's own codebase or a partner integration) emits records that would benefit from the byte distinction.
2. **Demand signal**: a consumer (verifier, dashboard, benchmark harness) has a queryable use case that `tool_name` matching cannot serve.
3. **Schema clarity**: the content-payload conventions for handoffs are documented (recipient `creator_key`, originating session, optional capability narrowing).
4. **Conformance fixtures**: corpus cases under `spec/conformance/1.2.4/handoff/` cover canonical-form invariance, byte/URI duality, and the handoff-specific structural validation.
5. **Cross-package coordination**: the [D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04) sync-trigger checklist (URI table, byte mapping, package constants, log-node decoder, dashboard chip color, verify-loop validEventTypes set, metrics filter) is applied in lockstep.

Until that ADR lands, producers requiring handoff semantics SHOULD emit records under the extension URI `https://atrib.dev/v1/types/handoff` (event_type byte `0xFF` per [§2.3.1](atrib-spec.md#231-entry-serialization)) and document their content-payload conventions in their own README. The byte slot is reserved against accidental allocation to a different concept.

**Alternatives considered:**

- _Promote `handoff` to byte 0x07 immediately, before any producer needs it._ Rejected per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary): pre-emptive byte allocation accumulates normative debt for use cases that may never materialize. The `directory_anchor` promotion ([D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)) cleared the bar because the spec required the type and producers were already emitting it. handoff has not.
- _Document the convention in [§7](atrib-spec.md#7-harness-integration-patterns) instead of reserving a byte._ Considered. Rejected because [§7](atrib-spec.md#7-harness-integration-patterns) covers consumer-side patterns, not the producer-side event_type vocabulary. Reserving the byte is the protocol commitment; the harness integration narrative (when written) can reference this ADR.
- _Use [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #3 (callback handlers) to capture handoffs as ordinary tool calls without a new byte._ Considered as a transition path, not a long-term answer. Multi-agent verifiers need the byte distinction to count handoffs without parsing `tool_name` strings; Pattern #3 instrumentation can produce the records but doesn't solve the verifier-side query problem.

**Consequences:**

- Byte `0x07` is informally reserved at the design level. The reserved range in [§2.3.1](atrib-spec.md#231-entry-serialization) currently spans `0x07–0xFE`; this ADR notes the intent to allocate `0x07` to handoff when promotion lands, without tightening the range yet.
- Producers MAY emit handoff records under the extension URI in advance of normative promotion. They SHOULD document content-payload shape in their package README so a future normative ADR can adopt the convention rather than reinvent it.
- A multi-agent harness benchmark (when one runs against an OpenAI Agents or Microsoft Agent Framework subject task) is the natural source of adoption signal: the handoff records produced will inform the formal ADR.

**Cross-references:**

- [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) (the bar this placeholder defers to)
- [D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04) (precedent for full promotion; sync-trigger checklist)
- [§1.2.4](atrib-spec.md#124-event_type-values) (event_type URI table this ADR will eventually amend)
- [§2.3.1](atrib-spec.md#231-entry-serialization) (byte mapping table this ADR will eventually amend)
- [§9](atrib-spec.md#9-runtime-integration-patterns) (runtime integration patterns; multi-agent harnesses surface the handoff use case)
- [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash), parent-child agent representation; ships the producer-side `informed_by` baseline while keeping this ADR's substantive handoff promotion reserved for a future producer that needs it.

---

## D074: Git-trailer record-hash binding for repo-scoped agents

**Date:** 2026-05-09

**Context:** A class of agents (Aider, Cursor coding mode, Claude Code in code mode, future code-editing harnesses) operate by committing changes to a git repository. Their tool calls are atrib-signed, but the connection between an atrib record and the resulting git commit is implicit, a consumer reading a commit cannot verify which atrib record produced it without scanning the local mirror by timestamp. Conversely, an atrib record cannot reference the commit it produced because the commit hash is not known until after the commit lands.

Aider's existing convention writes a `Co-Authored-By` trailer naming the LLM that produced the commit. The convention is host-tooled, unsigned, and unverifiable. atrib has a stronger primitive: the `record_hash` of the tool_call (or transaction) that authored the commit, signed by the agent's `creator_key`, committed to the public log. Wiring `record_hash` into a git trailer gives cryptographic lineage between commit and atrib record at zero new storage cost.

**Decision.** Producers operating on git repositories MAY add an `Atrib-Record-Hash` git commit trailer naming the atrib `record_hash` of the tool_call (or transaction) that authored the commit. Format:

```
Atrib-Record-Hash: sha256:<64-hex>
Atrib-Creator-Key: <43-char-base64url>
```

The `Atrib-Creator-Key` trailer is OPTIONAL and provides quick verifier access to the signing identity without a graph lookup. Both trailers MUST appear in the trailer block (per `git interpret-trailers` conventions: separated from the body by a blank line, key:value form, no inline punctuation in keys).

Verification semantics:

1. Reader extracts the trailer values.
2. Reader queries the atrib log for the named `record_hash` (e.g., via `/v1/lookup/<hex>` on log-node).
3. Reader confirms the record's `event_type` is `tool_call` or `transaction`, and that the record's signature verifies against the (optionally trailer-supplied, otherwise log-derived) `creator_key`.
4. Reader OPTIONALLY confirms that the record's content references the commit-relevant action (file paths, command, etc.), this is a content-layer assertion outside the substrate's normative scope.

The substrate guarantees the record exists, was signed by the named creator, and is anchored in the public log. It does NOT guarantee the commit produced what the record describes, that requires content-layer reasoning (out of scope for atrib).

**Alternatives considered:**

- _Use the existing `Co-Authored-By` trailer with a synthetic email derived from `creator_key`._ Rejected. `Co-Authored-By` is a humans-and-bots field; overloading it with cryptographic identifiers conflates two different concerns and breaks tooling that parses the trailer for human attribution. Dedicated `Atrib-*` trailers are unambiguous.
- _Embed the `record_hash` in the commit message body._ Rejected. Body content is unstructured; trailers are structured (per `git interpret-trailers`) and tooling-friendly. Trailers also survive rebases that rewrite message bodies.
- _Use git notes (`refs/notes/atrib`) instead of trailers._ Considered. Notes have the advantage of post-hoc attachment without rewriting the commit, but the disadvantages of optional fetch (notes don't ship with `git fetch` by default), namespace contention, and weaker discoverability. Trailers are the lower-friction path; notes remain available as a complement when post-hoc attachment is needed (e.g., for historical commits).
- _Make trailers MUST rather than MAY._ Rejected. Not every agent operates on a repo; not every operator wants to leak `record_hash` into commit history. MAY preserves operator choice; producers that adopt the convention follow this format.

**Consequences:**

- The trailer format becomes a documented producer convention. Adapters in `@atrib/agent` for Aider, Claude Agent SDK code mode, and similar code-editing surfaces MAY emit the trailer when committing on the agent's behalf.
- A consumer-side helper (`@atrib/verify` `verifyCommitTrailer(commit, atribLog)`) MAY be built once at least one producer emits the trailer; deferred until adoption.
- The trailer format is forward-compatible with Sigstore commit signing: a commit may carry `gitsign`-style signature footers AND `Atrib-Record-Hash` trailers; the two layers verify orthogonally (Sigstore proves the human/CI signed the commit; atrib proves the agent's tool call corresponds to it).
- Spec [§7](atrib-spec.md#7-harness-integration-patterns) (harness integration patterns) gains an informative subsection when first producer adopts: documents the trailer convention as a Pattern #3 (callback handlers) extension for code-editing surfaces.

**Cross-references:**

- [§1.2](atrib-spec.md#12-record-format) (record format; `record_hash` is defined as the SHA-256 of the canonical record)
- [§2.5.4](atrib-spec.md#254-point-lookup-endpoint-optional) (point lookup endpoint; verifier path for retrieving the trailer-named record)
- [§7](atrib-spec.md#7-harness-integration-patterns) (harness integration patterns; future home of the producer-side documentation)
- [D031](#d031-reconcile-243-signed-note-divergence-from-c2sp) (Sigstore signed-note format; orthogonal commit-signing layer this ADR composes with)

---

## D076: Long-lived atrib-emit daemon (opt-in) + spawn-per-emit fallback

**Date:** 2026-05-10

**Promoted from:** P011 (long-lived atrib-emit vs spawn-per-hook fork model). The original deferred-decision entry is removed from the Pending decisions section by this ADR; see git history prior to this commit for the source text.

**Superseded for the hook path by [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess).** Hook-class producers sign in-process via `emitInProcess`, which removes the spawn cost this daemon existed to amortize. The daemon below remains valid only for a producer that genuinely cannot sign in-process.

**Context.**

The current producer architecture spawns a fresh `atrib-emit` subprocess per emit invocation. The hook script (or sign_record sidecar, or watcher emit call) creates a `StdioClientTransport`, which spawns `atrib-emit`, performs the JSON-RPC initialize handshake, calls the `emit` tool, and tears down. A 15-second inner timeout (`ATRIB_EMIT_TIMEOUT_MS`) bounds connect + tool-call latency; the wrapping subprocess.run timeout at 18s gives a 3-second margin for shutdown.

Two empirical findings make spawn-per-emit unviable as the only option:

1. **Burst-pressure failure (original P011 data, 2026-05-09):** 29 `[layer=sessionend] atrib-emit connect timed out after 15000ms` errors clustered in a 33-minute window. Under burst load (rapid session opens/closes during nested-session work), the per-spawn fork plus MCP handshake exceeds 15 seconds, dropping the sessionend annotations that would otherwise mark session boundaries.

2. **Steady-state spawn cost (replay measurement, 2026-05-10):** per-phase timing instrumentation in the producer-side sidecar revealed connect = 250–385ms, call = 73–134ms, close = 233–370ms, total = 557–1079ms per emit on a healthy system. Connect alone (subprocess spawn + MCP initialize) accounts for 30–40% of every emit's wall time. At watcher scale (96 commits processed in one nightly cron), this is ~27 seconds of pure spawn cost on every clean run, before any pathological timeout.

The 2026-05-10 nightly cascade (a downstream consumer emitting 30+ structurally-invalid annotations when the upstream watcher had silently failed) is unrelated to this decision, [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) orphan handling plus the consumer-side skip-when-orphaned guard plus the circuit-breaker discrimination already addressed it. P011 is the orthogonal question: even when nothing fails, spawn-per-emit imposes a fixed tax that scales linearly with emit volume and creates a sharp burst-pressure failure mode.

**Decision.** atrib-emit gains an opt-in long-lived daemon mode; producers (sign_record, hook scripts, watchers) prefer the daemon when reachable and fall back to spawn-per-emit when not. Spawn-per-emit remains the default to preserve operational simplicity for first-time users and isolated invocations.

Daemon shape:

1. **Boot:** `atrib-emit --daemon --socket <path>` runs as a single long-lived process bound to one creator key, listening on a Unix domain socket. The socket path is the lifecycle-coordination point; daemon owners (sync scripts, login shells, supervisor scripts) manage start/stop.

2. **Client opt-in:** clients check `ATRIB_EMIT_DAEMON_SOCKET=<path>`. If set AND the socket is reachable AND the JSON-RPC initialize succeeds within a short connect deadline (1s), the client uses the socket transport. Otherwise the client falls back to spawn-per-emit transparently. No client-side config change is required if the env var is unset, existing callers keep working unchanged.

3. **Wire format:** JSON-RPC over Unix socket carrying the same MCP tool-call envelope the stdio path uses. Reusing the wire format avoids divergent code in atrib-emit between the daemon and the per-spawn handler, both route through the same `handleEmit` in `services/atrib-emit/src/index.ts`.

4. **Single creator-key invariant:** one daemon serves one creator key (matching atrib-emit's existing "one key per process" design from the same file). Multi-creator setups run multiple daemons on distinct sockets, OR fall back to spawn-per-emit for the secondary creators. The daemon does NOT multiplex creator keys.

5. **Lifecycle and failure modes:** daemon crash → next client falls back to spawn-per-emit. Daemon hangs → client times out at the 1s connect deadline and falls back. Stale socket file → daemon unlinks-and-retries on boot. Daemon owner is responsible for graceful shutdown (SIGTERM handler drains the submission queue then exits).

**Alternatives considered:**

- _Mandate daemon mode (no spawn fallback)._ Rejected. Forces operators to manage daemon lifecycle for one-shot use cases (`atrib-emit < record.json` from a script, ad-hoc CLI invocations, CI). Spawn-per-emit's operational simplicity is genuine; the daemon is for hot paths.
- _Raise `ATRIB_EMIT_TIMEOUT_MS` to mask burst-pressure timeouts._ Rejected. Masks the symptom, wastes helper runtime on doomed waits, and doesn't address the steady-state spawn cost. Each retry forks again, worsening contention.
- _Per-conversation worker spawned by the first hook and reused for the session lifetime._ Rejected as the only mode (kept available implicitly via the daemon shape, a per-session daemon is a special case of `--socket` scoping). Per-conversation worker doesn't help cron / watcher / scheduled-producer use cases where there is no session.
- _Connection pooling on the client side without a daemon._ Rejected. The client (sign_record sidecar, hook script) is short-lived itself; pooling within a process gives no amortization across invocations.

**Consequences:**

- atrib-emit gains a `--daemon` mode and a Unix socket transport. The existing stdio transport is unchanged; both transports route through the same `handleEmit` path so behavior is byte-identical.
- The producer-side sidecar (sign_record.mjs and any future cousin) gains daemon-detection: if `ATRIB_EMIT_DAEMON_SOCKET` is set, connect via socket; else spawn. Failure to reach the daemon falls back silently, no caller-visible behavior change.
- Mirror file appends remain single-writer when the daemon owns the file (no contention). When clients fall back to spawn-per-emit, the spawn writes the mirror line directly (unchanged from the current path).
- The submission queue's retry budget (`MAX_WINDOW_MS = 30s`) lives in the daemon for daemon-mode emits, surviving across many tool calls. In spawn-per-emit, the queue dies with the subprocess and pending records are lost on transient log failures (current behavior, retained).
- Cron / scheduled producers can opt into daemon mode by booting one daemon at the start of a run and tearing it down at the end. Expected effect: ~27 seconds of spawn cost reclaimed per 96-emit run, sessionend-burst drop rate brought to zero in the windows where it matters.
- Layer 2 hook configurations may set `ATRIB_EMIT_DAEMON_SOCKET` in their environment if a per-session daemon is desired; this composes with [D075](#d075-compose-not-override-hook-config-layering) (compose-not-override hook config layering), the env-var binding is layer-compatible.
- Verifier-side behavior is unchanged. The wire format of signed records is identical regardless of daemon vs spawn; verification does not need to know.

**Migration plan:** four sequential workstreams.

- **Daemon mode.** Add `--daemon` and `--socket` flags to `services/atrib-emit/src/main.ts`. Add Unix socket server transport that delegates to the same `handleEmit`. Existing stdio path unchanged. Unit tests cover both transports.

- **Client-side opt-in.** Update sign_record-shaped sidecars to check `ATRIB_EMIT_DAEMON_SOCKET`, attempt socket connect with a 1s deadline, fall back to spawn on any failure. The producer-side timing instrumentation already shipped is the measurement surface.

- **Dogfood enablement.** Cron / scheduled producers boot one daemon at the start of the run, export `ATRIB_EMIT_DAEMON_SOCKET`, run all sub-producers (which transparently use the daemon), tear it down. Long-running interactive sessions may also boot a per-session daemon if the latency win is desired.

- **Measurement.** Compare per-emit timing before vs after dogfood enablement using the existing instrumentation. Acceptance criterion: median emit time drops from ~700ms to <100ms; sessionend-burst drop rate stays at zero across a 7-day observation window.

Spec amendments are not required for this ADR, the wire format is unchanged, and [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #1 (lifecycle hooks) and Pattern #2 (MCP middleware) are agnostic about how producers reach atrib-emit.

**Cross-references:**

- [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), orphan handling. Burst-pressure timeouts produce orphan-shaped fallouts; the daemon eliminates the burst pressure, complementing the downstream containment that handling provides.
- [D075](#d075-compose-not-override-hook-config-layering), compose-not-override hook config layering. Operators wiring `ATRIB_EMIT_DAEMON_SOCKET` env binding into hook configs do so under the compose recommendation.
- [§9](atrib-spec.md#9-runtime-integration-patterns), runtime integration patterns. This ADR is producer-side architecture; the patterns themselves are unaffected.
- Producer-side per-phase timing instrumentation, the empirical data behind the steady-state spawn cost finding above.

---

## D077: pass^k as the primary Track B reporting metric (k=3 default)

**Date:** 2026-05-10
**Status:** Accepted; promoted from P019 (the placeholder Pending decision queued from the 2026-05-10 evals landscape research). The promotion lands together with the actual reporting-metric specification, which becomes the canonical metric for any Track B Pattern 1 v2 first-run result and forward.

### Context

Track B is the comparative-experiment track that converts atrib's substrate-correctness claim ("we have shipped a verifiable agent action protocol") into the funding-grade behavior-impact claim ("agents that reason from a past they can prove are measurably better than agents that don't"). The first run was retracted in May 2026 with a NULL result; the redesigned Track B experiment design was originally specified with a 1-attempt-per-task paired comparison reporting raw success rate plus five secondary metrics M1-M5.

External evals landscape research from May 2026 identified pass^k as the field's converged primary reliability metric, codified by Anthropic's January 2026 "Demystifying Evals for AI Agents" essay. Quoted from that essay: pass@k (succeeds at least once across k attempts) inflates apparent agent capability and diverges sharply from pass^k (succeeds every time across k attempts) starting around k=10. For verifiability claims specifically, "succeeds reliably" matters more than "succeeds occasionally" - a substrate that occasionally helps an agent get the right answer is a thinner pitch than a substrate that reliably helps.

The original 1-attempt-per-task design implicitly reports pass@1, which is identical to pass^1, but loses the reliability signal entirely. Adopting pass^k as the primary metric requires running k attempts per task per arm.

### Decision

Track B Pattern 1 v2 (and subsequent Track B patterns) report pass^k as the primary reporting metric, with the following tiers:

- **k=3 default** for first-run Pattern 1 v2. Total runs become 60 (10 task instances × 2 arms × 3 attempts). At ~5-15 minutes per run on NIM Qwen 80B, total budget ~5-15 hours per arm or ~10-30 hours wall-clock; feasible in one focused day with parallelism.
- **k=5 stretch** for second-run scaling (the n=50 follow-on if first-run is positive).
- **k=10 reliability-grade** for any publication-grade or external-citation result. This tier produces the cleanest separation between "occasional success" and "reliable success" but requires 10× the compute of k=1.

The primary headline reporting metric becomes:

> **pass^k_delta = pass^k(treatment_arm) - pass^k(control_arm)**, in percentage points.

A run is **POSITIVE** if pass^k_delta ≥ 20 percentage points AND the secondary signed-rank test on per-pair (treatment - control) deltas reaches p ≤ 0.10 on at least one of M1 (mistake_rate) or M3 (wall_clock_seconds). The 5 secondary metrics M1-M5 from the original design remain reported as supplementary signal but are no longer the primary decision driver.

### Rationale

1. **Field consensus.** Anthropic's January 2026 essay is the most-cited eval-discipline reference essay as of mid-2026. The broader 2026 reporting consensus (Inspect AI, METR autonomy evaluations, recent OpenAI methodology) treats pass^k as the convergent primary metric. Reporting pass@k or raw success rate as the headline in 2026 is a known anti-pattern that signals methodological lag.
2. **Verifiability claim alignment.** atrib's locked positioning ("verifiable agent actions / every action becomes signed context for the next / agents that reason from a past they can prove") rests on the substrate being reliably useful, not occasionally lucky. pass^k operationalizes that constraint: the substrate must help on k=3 attempts, not just one. This is the right metric for the claim atrib is making.
3. **Funding-app credibility.** Applications citing pass@k or single-attempt success rates in 2026 will be discounted by reviewers familiar with the methodology consensus. Citing pass^k matches the field's expectations and pre-empts a class of dismissal vector.
4. **Cheap to adopt.** The decision itself is reporting; the only operational cost is running k attempts per task per arm instead of 1. At k=3 this is a 3× compute multiplier on a workload that costs $0 (NIM free tier). No infrastructure changes needed.
5. **Composes with end-state evaluation.** The original design's end-state evaluation methodology (per Anthropic Multi-agent Research System) is preserved unchanged. pass^k operates at the per-task aggregation level; end-state evaluation operates at the per-attempt level. They stack cleanly.

### Alternatives rejected

- **Keep pass@1 / single-attempt success rate.** Rejected as methodologically out-of-date. Inflates apparent capability; would not survive external review.
- **pass@k.** Rejected per the Anthropic essay's specific argument: pass@k diverges sharply from pass^k starting at k=10 and rewards inconsistent agents that occasionally get the right answer. Wrong shape for atrib's verifiability claim.
- **k=10 default for first run.** Rejected as too compute-heavy for the May 17 funding-app deadline window. k=10 reliability-grade is the right tier for publication; k=3 default is the right tier for first signal.
- **Custom multi-attempt aggregation** (e.g., weighted average of pass@1 + pass^3). Rejected as bespoke; loses the field-consensus advantage that motivates the adoption.

### Consequences

- **Track B Pattern 1 v2 first run runs 60 attempts (10 task instances × 2 arms × 3 attempts), not 20.** Total NIM compute is 3× the original budget but remains feasible within a single focused day with parallelism.
- **The Track B experiment design document (`track-b/experiment-design.md`) is updated** to reflect pass^k as the primary metric, k=3 default, and the multi-attempt run shape.
- **The decision rule changes** from "≥ 20% improvement on at least 2 of 5 paired metrics with M1 or M3 included" to "pass^k_delta ≥ 20 percentage points AND signed-rank p ≤ 0.10 on at least one of M1 or M3." M1-M5 remain reported as supplementary signal.
- **Per-run results documents** gain a new mandatory section: pass^k summary (treatment pass^k, control pass^k, delta in percentage points, by-attempt breakdown).
- **Subsequent Track B patterns (Patterns 2, 3, 4, 5)** inherit the same primary metric. The cross-pattern reporting consistency makes the eventual Suite B publishable benchmark (per the [P021](#p021-publish-a-behavior-impact-paired-benchmark-suite-as-an-atrib-artifact) Pending decision) easier to ship.
- **B1-B7 pilot subset** also adopts pass^k for the same reasons. The pilot will report pass^k_delta per benchmark.

### Cross-references

- P019 (retired upon promotion to this ADR) - the Pending decision this ADR promotes from. The P019 entry was removed from the Pending decisions section per the existing promotion convention ([D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) retired P011 the same way). The live entries in the Pending section now skip P019; [P018](#p018-adopt-inspect-ai-as-the-track-b-harness-baseline) and [P021](#p021-publish-a-behavior-impact-paired-benchmark-suite-as-an-atrib-artifact) remain in the eval framework subset, while [D101](#d101-substrate-wide-adversarial-conformance-corpus) owns the former P020 conformance-corpus workstream.
- [P018](#p018-adopt-inspect-ai-as-the-track-b-harness-baseline) - Inspect AI harness adoption. The harness pilot may not be done at first-Track-B-run time; pass^k spec is independent of the harness choice. Either Inspect AI or the bespoke fallback computes pass^k identically.
- [D101](#d101-substrate-wide-adversarial-conformance-corpus) - conformance corpus extension. Substrate-correctness eval; not affected by this metric change.
- [P021](#p021-publish-a-behavior-impact-paired-benchmark-suite-as-an-atrib-artifact) - Suite B publishable benchmark. Will use pass^k as primary metric per this ADR; quarterly snapshots report pass^k_delta per task class.

---

## D075: Compose-not-override hook config layering

**Date:** 2026-05-09

**Context:** atrib's Layer-2 producer surface (per [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #1, lifecycle hooks) is configured via the host runtime's hook-config file (Claude Code's `~/.claude/settings.json`, Cursor's settings, OpenAI Codex CLI's config). When multiple config layers are present (project-level + user-level + organization-level), the question of how they combine has two failure modes:

1. **Override semantics**: the highest-precedence layer fully replaces lower layers. Common default in many tools. Failure mode for atrib: a project-level config that wires a single dev-time hook silently disables the user-level atrib signing hook, producing unsigned records the operator believed were being signed. The orphan-handling fix in [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) makes this visible (orphans land in `fresh-orphan` isolates), but the upstream cause is the override.

2. **Naive concatenation**: every layer's hooks fire for every event. Failure mode: duplicate hook execution, double-signed records, race conditions on mirror-file appends.

OpenAI Codex CLI documents this concern explicitly in its config docs: "higher-precedence config layers do not replace lower-precedence hooks", Codex composes hook lists rather than overriding. The pattern produces correct behavior without forcing operators to maintain duplicate hook entries across layers.

**Decision.** atrib RECOMMENDS that producer-side hook configurations layer (project + user + organization) by **list-extension composition**, not override. When multiple config layers register hooks for the same lifecycle event:

1. Each layer's hook list is preserved in priority order (highest-precedence layer's hooks run first, then lower-precedence).
2. Hooks de-duplicate by **identity** (script path, command, or normalized invocation string), registering the same hook in two layers produces ONE invocation, not two.
3. A hook MAY be explicitly suppressed at a higher precedence layer via a `disable` directive (atrib does not specify the directive's wire format; the host runtime's config schema is authoritative).
4. Order within a single layer is preserved (the layer's author chose ordering deliberately).

This is a producer-side recommendation, not a normative spec constraint. atrib does not own the host's config schema; the recommendation guides operators wiring atrib hooks alongside other tooling and guides any future atrib-published `install-hooks` helper.

**Alternatives considered:**

- _Mandate override semantics so the highest-precedence layer is fully authoritative._ Rejected. Operators routinely want project-specific hooks IN ADDITION to their user-level atrib signing, override semantics force them to duplicate the atrib hook into every project config, a maintenance footgun.
- _Mandate concatenation without de-duplication._ Rejected. A user-level hook copied into a project config produces double-signing; double-signed records are valid (each signature is correct) but wasteful and confusing in logs.
- _Stay silent and let operators figure it out._ Rejected. The orphan absorption pathology that motivated [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) was downstream of operators discovering hook config interactions the hard way. A documented recommendation reduces the failure surface.

**Consequences:**

- atrib's documentation (`packages/mcp-wrap/README.md`, future `@atrib/install-hooks` helper) cites this ADR when describing how to wire hooks alongside other tooling.
- A reference hook installer that lives outside this repository follows the recommendation: when a project-level config exists, atrib hooks are appended to the existing list rather than replacing it.
- When a future runtime adapter (per [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #1) ships, its `install` step composes against existing config rather than overwriting.
- This ADR does NOT modify the host runtime's config schema. It documents atrib's expectation; runtimes that override hook lists will still produce orphans (visible per [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), addressable by config edits).

**Cross-references:**

- [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) (orphan handling; the failure mode that surfaces when this recommendation is violated)
- [§9](atrib-spec.md#9-runtime-integration-patterns) (runtime integration patterns; Pattern #1 lifecycle hooks are the surface this ADR governs)
- [D048](#d048-plug-and-play-enforcement-contract-for-adapters) (adapter conformance contract; the install step in any per-pattern adapter SHOULD honor the compose-not-override recommendation)

---

## D078: MCP servers honor `ATRIB_CONTEXT_ID` env as `context_id` default

**Date:** 2026-05-12

**Context.** The four atrib MCP servers (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`) all accept an optional `context_id` argument on at least one of their tools. Until this ADR, none of them consulted `process.env.ATRIB_CONTEXT_ID` when the caller omitted the argument. The env var was silently ignored. Inspect-style harnesses ([P018](#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) typically pass per-run scope into spawned MCP subprocesses via the env block, not via every tool-call argument. The mismatch broke [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail)'s per-arm context_id isolation in Pattern 1 v2's 60-run paired sweep: treatment-arm recall queries scoped by context_id returned wrong-arm records because the env var was a no-op and atrib-emit synthesized fresh orphan contexts instead of inheriting the harness's per-run id.

**Decision.** Each of the four servers reads `process.env.ATRIB_CONTEXT_ID` at tool-invocation time. When the value is a valid 32-hex string per spec [§1.2.3](atrib-spec.md#123-context_id) AND the caller did not supply `context_id` on the call, the env value is used as the effective `context_id`. Explicit caller arguments always win (explicit beats implicit). Invalid env values are ignored and the existing default behavior continues. The fallback is silent: the env value is treated as a caller-side default rather than a misconfiguration.

Per-server effect:

- **`@atrib/emit`.** The env-supplied `context_id` becomes the `callerContextId` passed to `inheritChainContext` (in `@atrib/mcp`'s mirror module). This converts a [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `fresh-orphan` path into a legitimate caller-supplied path, threading the harness's per-run id through to the signed record.
- **`@atrib/recall`.** The env value defaults the `context_id` filter on `recall_my_attribution_history`. Records signed under a different `context_id` are excluded from the result set, matching the per-arm isolation the harness wants.
- **`@atrib/trace`.** A new optional `context_id` argument on the `trace` tool defaults to the env var. The walker treats `informed_by` edges that cross into a different `context_id` as dangling references, keeping the walk inside the requested scope. Existing callers that omit both the env var and the argument continue to walk cross-context.
- **`@atrib/summarize`.** The env value defaults the `context_id` input on the `summarize` tool. The selection routine narrows to records sharing the scoped `context_id`.

**Alternatives considered.**

- _Plumb `ATRIB_CONTEXT_ID` into `@atrib/mcp`'s `inheritChainContext` directly._ Rejected for this ADR's scope. The producer-side mirror module already cascades through `ATRIB_CHAIN_TAIL_<context_id>` and mirror inheritance; adding a top-level env-var to that decision tree expands its surface and would require corresponding behavior in every other producer that uses the helper. Local server-level fallback keeps the change isolated to the four servers that need it.
- _Add a warning when the env var triggers the fallback._ Rejected. The env value functions as a declared caller-side default; surfacing a warning would conflate intentional configuration with a misconfiguration. Callers wanting visibility can inspect the response `context_id` directly.
- _Require an explicit argument from the harness._ Rejected. Inspect-style harnesses set per-run scope via the MCP subprocess env block; threading the argument through every tool call would require harness-side patching that defeats the substrate's "just works" promise.

**Consequences.**

- Pattern 1 v2's 60-run paired sweep can rely on per-arm context_id isolation by setting `ATRIB_CONTEXT_ID` once in each arm's env, with no further argument plumbing.
- The four servers now have a uniform env-var contract for context scoping. The convention is documented in each server's README (deferred to the next docs pass; this ADR is the source of truth).
- No spec change. The wire format of signed records is unchanged. `context_id` in records is identical regardless of whether the value originated from the argument or the env var.

**Cross-references.**

- [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), per-arm context_id isolation; this ADR closes the runtime gap that made the harness-side contract unenforceable.
- [P018](#p018-adopt-inspect-ai-as-the-track-b-harness-baseline), Inspect AI as the Track B harness baseline; the env-block scoping pattern is Inspect's idiomatic shape.
- [§1.2.3](atrib-spec.md#123-context_id), `context_id` format; the env value is validated against the same 32-hex regex as the argument.

---

## D079: The six core cognitive primitives, atrib's agent-facing surface

**Date:** 2026-05-13

**Context.** The atrib spec defines six normative `event_type` URIs ([§1.2.4](atrib-spec.md#124-event_type-values)): `tool_call`, `transaction`, `observation`, `directory_anchor`, `annotation`, `revision`. The first two are wrapper/middleware-emitted; the fourth is atrib-system-emitted; only `observation`, `annotation`, and `revision` are emittable by agents at decision time. Until this ADR, the agent-facing API was un-locked: `@atrib/emit` accepted any of those three event_types behind one polymorphic tool whose `content` field changed shape based on a string enum; the `@atrib/recall` family shipped five sibling tools; `@atrib/trace` and `@atrib/summarize` each shipped one tool. The surface totalled eight MCP tools with mixed semantic granularity.

Two empirical findings made the polymorphic shape a real risk for the Track B Pattern 1 experimental program:

1. Letta's LoCoMo benchmark ([blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)) showed agent-orchestrated filesystem-shaped primitives (`open`, `grep`, `semantic_search`) outperform specialized memory APIs. Letta's stated interpretation: post-training has made frontier models effective at filesystem-shaped tool surfaces, while specialized memory APIs with non-filesystem semantics underperform on the same tasks. A polymorphic `emit({event_type, content: {shape varies}})` has zero training-data analogue; a monomorphic `annotate({annotates, importance, summary})` reads as bash-like to the agent.
2. Anthropic's official position on the Memory Tool and Claude Code converges on the same principle: narrow tools with clear singular purpose, scaffold-introduced at session start, agent-orchestrated thereafter ([Anthropic 2026, _Effective context engineering for AI agents_](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

The decomposition test for whether two operations are the same primitive or different: do they have a different cognitive purpose the agent reasons about distinctly, a different required argument shape, or a different effect on the substrate graph? If any of those, they are different primitives.

**Decision.** The atrib agent-facing cognitive surface started as **exactly six primitives**. Each is a monomorphic MCP tool with one narrow purpose and one input schema. Each is a verb the agent reasons about as a discrete cognitive operation. The set is not extensible without a follow-on ADR.

**2026-05-29 amendment:** [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) promotes `atrib-verify` as primitive #7 after two independent Pattern 3 receiving flows required counterparty evidence verification before follow-up work. The surface is now seven primitives: three writes and four reads.

| #   | Primitive         | Spec event_type      | Read/write | Input shape                                                                                             | Graph effect                                                       | One-line purpose                                                                                                  |
| --- | ----------------- | -------------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `atrib-emit`      | `observation` (0x03) | write      | `{what, why_noted?, topics?, informed_by?[]}`                                                           | New OBSERVATION node; INFORMED_BY edges if `informed_by` populated | Record the present moment: a noting, a hypothesis, a conclusion drawn from prior records.                         |
| 2   | `atrib-annotate`  | `annotation` (0x05)  | write      | `{annotates, importance, summary, topics?}`                                                             | New ANNOTATION node + ANNOTATES edge to `annotates`                | Mark a past record's importance / meaning without superseding it.                                                 |
| 3   | `atrib-revise`    | `revision` (0x06)    | write      | `{revises, prior_position, new_position, reason}`                                                       | New REVISION node + REVISES edge to `revises`                      | Supersede a prior position with a stated reason. The prior remains in the graph; the revision records the change. |
| 4   | `atrib-recall`    | (read)               | read       | filters (`event_type`, `topics`, time range, content query, `min_importance`, etc.)                     | None (read-only)                                                   | Find prior records. The query-shape variants ([§3.3](atrib-spec.md)) live behind one verb.                        |
| 5   | `atrib-trace`     | (read)               | read       | `{record_hash, depth, context_id?}`                                                                     | None (read-only)                                                   | Walk INFORMED_BY backward from a record to surface its causal lineage.                                            |
| 6   | `atrib-summarize` | (read)               | read       | `{context_id, max_records, focus}`                                                                      | None (read-only)                                                   | Condense N records into a narrative digest.                                                                       |
| 7   | `atrib-verify`    | (read)               | read       | `{packet?, records?, required_record_hashes?, trusted_creator_keys?, allowed_context_ids?, require_*?}` | None (read-only)                                                   | Verify counterparty handoff evidence before using accepted hashes in `informed_by`.                               |

**Each primitive must meet the bash standard:**

- _One thing._ If a primitive has an enum field that changes the shape of another field, that's two primitives glued together. Each verb gets its own MCP package and Zod schema with required fields specific to that verb.
- _Narrow input._ `atrib-annotate` REQUIRES `annotates`; the schema rejects a call without it. `atrib-revise` REQUIRES `revises`. The agent cannot misuse one for the other.
- _Composable output._ Write primitives return `record_hash`; read primitives return record arrays. The output of `atrib-recall` is the input of `atrib-trace` and `atrib-annotate`. The output of `atrib-trace` is the input of `atrib-summarize`.
- _Discoverable._ Each primitive lives at `@atrib/<verb>` on npm, or a similarly named package where the library name is already taken. Future tools learn the verbs by reading seven READMEs, not one polymorphic dispatch table.
- _Stable._ The set is **closed at seven** for atrib v1 after [D106](#d106-verify-is-promoted-to-cognitive-primitive-7). Extension event_types ([D035](#d035-extensible-event_type-vocabulary-via-uri-typing)) may be added by consumers in their own namespaces but DO NOT add new primitives to atrib's normative agent surface; consumers wanting a new verb mint their own MCP package.

**Three orthogonal cardinalities (do not conflate):**

The "six" in this ADR is the agent-facing tool surface. It is not the same number as the spec's event_types, and it is not the same set as what appears on the explorer's graph node categories. Three cardinalities at play:

1. **Six spec event_types** ([§1.2.4](atrib-spec.md#124-event_type-values)): `tool_call`, `transaction`, `observation`, `directory_anchor`, `annotation`, `revision`. Every signed atrib record carries one of these. The explorer surfaces all six as graph node categories.
2. **Three agent-emittable event_types**: `observation`, `annotation`, `revision`. Only these are reachable from an agent-facing MCP tool at decision time; the other three (`tool_call`, `transaction`, `directory_anchor`) land in the graph through middleware or atrib-system, not through agent action.
3. **Seven cognitive primitives** (this ADR amended by [D106](#d106-verify-is-promoted-to-cognitive-primitive-7)): three writes (`atrib-emit`, `atrib-annotate`, `atrib-revise`) corresponding one-to-one with the three agent-emittable event_types, plus four reads (`atrib-recall`, `atrib-trace`, `atrib-summarize`, `atrib-verify`) that query or check the graph and evidence without producing event_types.

| Spec event_type           | Surfaces on explorer | Who signs it                     | Agent primitive (this ADR)?            |
| ------------------------- | -------------------- | -------------------------------- | -------------------------------------- |
| `tool_call` (0x01)        | ✓                    | Wrapper / MCP middleware (auto)  | No, middleware-emitted                 |
| `transaction` (0x02)      | ✓                    | Commerce detector + counterparty | No, middleware-emitted, cross-attested |
| `observation` (0x03)      | ✓                    | Agent via `atrib-emit`           | **Yes, primitive #1**                  |
| `directory_anchor` (0x04) | ✓                    | atrib-system directory service   | No, system-emitted                     |
| `annotation` (0x05)       | ✓                    | Agent via `atrib-annotate`       | **Yes, primitive #2**                  |
| `revision` (0x06)         | ✓                    | Agent via `atrib-revise`         | **Yes, primitive #3**                  |

The reads (`recall`, `trace`, `summarize`, `verify`) do not appear in the event_type table because they do not produce records. They consume the substrate the writes (and middleware) accumulate.

**What is NOT a primitive (by deliberate choice):**

- `tool_call` and `transaction` event_types: emitted by middleware / SDK, not by the agent at decision time. The agent doesn't reach for a tool to record these; the wrapper handles it.
- `directory_anchor`: emitted by atrib-system directory services. Not an agent verb.
- "decision" as a distinct primitive: the spec carries no `decision` event_type. The cognitive operation called "decision" in colloquial usage is an `observation` with structured `informed_by` (the agent declares which prior records shaped the conclusion). One primitive (`atrib-emit`), two usage patterns (empty `informed_by` = perception; populated `informed_by` = conclusion). Conflating these into separate primitives would multiply verbs without a graph-semantic justification.
- Polymorphic dispatch (one tool, switch on event_type): rejected for the reasons above (Letta finding + bash-standard).

**Implementation layering (package dependency shape):**

The seven primitives correspond to MCP packages, but the packages are not flat-equal in their dependency graph. The correct layering is:

```
@atrib/mcp                                        (signing primitives, chain composition,
                                                   canonical-form serialization, the libc-equivalent)
   ↑              ↑
@atrib/emit       @atrib/recall, /trace, /summarize, /verify-mcp
                                                        (canonical write tool; read tools)
   ↑      ↑
@atrib/annotate  @atrib/revise                          (specialized forms that narrow emit's schema)
```

`@atrib/emit` is the canonical record-signing tool: it owns key resolution, the build-and-sign composition, and JSONL mirror writing. `@atrib/annotate` and `@atrib/revise` are specialized forms, each depends on `@atrib/emit`, imports its key-loading and mirror-writing helpers, and exposes a narrow Zod schema that constrains input to the specialized event_type's shape. The four read packages do not sign records. `@atrib/recall`, `@atrib/trace`, and `@atrib/summarize` depend on `@atrib/mcp`; `@atrib/verify-mcp` depends on `@atrib/verify` for the cryptographic checks and `@atrib/mcp` for read-primitive instrumentation. This layering matches the IS-A relationship (annotate IS a constrained emit) without breaking the bash-standard for the agent-facing surface (each MCP tool remains monomorphic with one purpose). When the signing pipeline evolves ([D072](#d072-orphan-handling-synthesize-fresh-never-inherit-from-mirror-tail), [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default), future cross-attestation), only `@atrib/emit` changes; annotate and revise inherit the fix automatically.

**Alternatives considered.**

- _Keep the polymorphic `@atrib/emit` as the sole write primitive._ Rejected. One tool with three content shapes selected by an enum is harder for the agent to reason about than three tools each with one fixed shape. The Letta finding and bash analogy both push against polymorphism at the agent surface.
- _Ship eight primitives (split `atrib-recall` into the five sibling tools)._ Rejected for the agent surface. The recall family's five physical tools (`recall_my_attribution_history`, `recall_walk`, `recall_annotations`, `recall_revisions`, `recall_by_content`) are query-shape variants of one verb the agent reasons about as "find prior records". Letta's leaderboard finding ([Letta leaderboard blog](https://www.letta.com/blog/letta-leaderboard)) is that weaker models over-use specialized memory tools when fewer tools are needed; collapsing the recall family to one verb is the lower-tool-count direction. The five physical tools may consolidate behind a unified `@atrib/recall` MCP in a future ADR; until then, the scaffold teaches them as one verb with shape variants.
- _Ship a seventh write primitive by splitting `observation` into `atrib-observe` + `atrib-decide`._ Rejected. The cognitive distinction between passive noticing and active concluding is captured by `informed_by` being empty vs. populated, not by separate event_types. The spec made this choice ([D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) explicitly distinguishes annotation from observation by the presence of a referent, NOT by activity-level); adding a `decision` event_type to the spec just to split the primitive would be design churn without a graph-semantic justification.
- _Ship five primitives (collapse `annotate` and `revise` back into `emit`)._ Rejected. annotation and revision have **required** referent fields (`annotates`, `revises`) and add **different edge types** to the graph (ANNOTATES vs REVISES per [§3.2.4](atrib-spec.md#324-edge-derivation-rules)). They fail the boundary-drawing test for "same primitive": different required args AND different graph effects.

**Consequences.**

- Paired-arm experimental designs that test consume-side vs producer-side surfaces (e.g. Track B's Pattern 1) originally used the six-primitives surface as the agent-facing tool set; the canonical control vs treatment arm differentiator was the **read trio** (`recall`, `trace`, `summarize`), control mounted the three write verbs, treatment mounted all six. After [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), new Pattern 3 evaluations include `atrib-verify` when the receiving agent handles counterparty evidence.
- Two new MCP packages ship in the atrib v0.x release cycle: `@atrib/annotate` and `@atrib/revise`. Each is a thin wrapper around `@atrib/mcp`'s signing primitives with a narrow Zod schema that enforces the required referent field. The polymorphic `@atrib/emit` remains published for backward-compatibility but the agent-facing scaffold steers `event_type=annotation/revision` calls toward the dedicated tools.
- The `@atrib/recall` family's sibling tools are conceptually consolidated under one verb; a future ADR may consolidate them physically.
- Documentation in atrib's CLAUDE.md, the spec's [§7](atrib-spec.md#7-harness-integration-patterns), and each MCP package's README references this ADR as the canonical statement of the agent-facing surface. Anything that adds a verb or splits an existing one is a spec-level change subject to [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).
- Future write primitives require: (a) a new spec event_type promoted from extension namespace per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary), (b) passing the boundary-drawing test (different cognitive purpose, different required args, different graph effect), and (c) a follow-on ADR that updates this surface. Future read primitives follow [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion)'s extension-first rule and still need a follow-on ADR.

**Cross-references.**

- [§1.2.4](atrib-spec.md#124-event_type-values), normative event_type URI set; this ADR commits to which of those are agent-facing primitives.
- [§3.2.4](atrib-spec.md#324-edge-derivation-rules), graph edge derivation rules; ANNOTATES and REVISES edges are what make `annotate` and `revise` distinct from `emit`.
- [D035](#d035-extensible-event_type-vocabulary-via-uri-typing), extensible event_type vocabulary; extension event_types do not add primitives to atrib's normative surface.
- [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary), bar for promoting extension to normative; write primitive promotions start here.
- [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05), annotation event_type promotion; underlies `atrib-annotate`.
- [D059](#d059-promote-revision-to-atrib-normative-event_type-byte-0x06), revision event_type promotion; underlies `atrib-revise`.
- [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default), env-honoring across MCP servers; the seven primitives inherit this contract.
- [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion), primitive lifecycle (extension-first, promotion-via-gates); how the surface grows when production scope requires it.
- [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), follow-on amendment that promotes `atrib-verify`.

---

## D080: Primitive lifecycle, extensions first, dedicated MCPs upon promotion

**Date:** 2026-05-13

**Context.** [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) locked the atrib agent-facing surface at six primitives (`atrib-emit`, `atrib-annotate`, `atrib-revise`, `atrib-recall`, `atrib-trace`, `atrib-summarize`) and committed to "closed at six for v1". But the project will continue to discover operations that LOOK primitive-like at varying capability levels: some are full cognitive verbs that deserve their own tool; others are query-shape variants or strength settings on an existing primitive; some are theoretical until a routine production use case materializes. Without a stated lifecycle policy, every such operation triggers an ad-hoc "is this a new primitive?" debate, and the answer drifts session-to-session.

The worked-example tension that triggered this ADR was `verify`. `@atrib/verify` exists as a published package and provides signature + canonical-form + chain + log-inclusion verification. Should it be cognitive primitive #7? Three single-agent use cases stand out: (1) local-mirror gap fill, fetch a record_hash from log.atrib.dev when local mirror lacks it; (2) integrity audit, re-verify recent records against the public log's fresh root; (3) external record_hash relay, a user pastes a hash, agent should fetch + verify. Cases 1 and 2 are single-agent scope; case 3 trends multi-agent.

The boundary-drawing test in [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) (different cognitive purpose AND different required args AND different graph effect) is necessary but not sufficient. An operation that PASSES the boundary test might still belong as an extension on an existing primitive if its use case is rare, derivative, or theoretical. The boundary test answers "could this be a primitive?". The lifecycle policy answers "should it be one NOW?".

**Decision.** Cognitive operations that pass the [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) boundary test enter the agent-facing surface in one of two postures:

1. **Extension**: added as an optional parameter or shape variant on the closest existing primitive. The agent's tool surface count does not grow. Examples: `recall.origin: 'local' | 'remote' | 'both'`, `recall.verify_strength: 'signature' | 'inclusion'`. The primitive's narrow purpose is preserved; the variant is a setting on the same verb.

2. **Dedicated primitive (new MCP)**, added as a new MCP package and a new agent-facing tool, with [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) amended to list it. The surface grows by one. Reserved for operations that appear in production flows and that agents reach for as a discrete mental operation.

**The default posture is extension.** Promotion to dedicated primitive requires ALL of the following acceptance gates:

| #   | Gate                                                                                                                                                                                                                                                                                                                  | Why it gates                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Production use case that changes behavior.** Not theoretical. There is at least one shipped agent flow where this operation is called regularly and where its absence would degrade the agent's behavior.                                                                                                           | Avoids surface bloat from speculative primitives. The boundary test alone admits too many candidates.                                                                                      |
| 2   | **Spec event_type either exists or is being promoted.** For write operations: the new primitive corresponds to a spec event_type. For read operations: the operation has a graph effect or read pattern documented in [§3](atrib-spec.md#3-graph-query-interface) that the existing read trio cannot express cleanly. | Anchors the agent-facing surface to atrib's normative protocol. Primitives without spec backing are app-layer features, not protocol-layer ones.                                           |
| 3   | **Cognitive distinctness in agent reasoning.** When agents (or operators reading agent transcripts) describe what the agent did, the operation has its own name in natural language, not "a kind of recall" or "a flavor of emit".                                                                                    | The bash-standard test from [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface). Each primitive earns its name by being how the agent thinks about the operation. |
| 4   | **[D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) amendment + new MCP package shipped together.** Promotion is not adopted piecemeal; the ADR text, the package source, and the changeset for the package version arrive in one commit.                                                  | Keeps the canonical-decision record and the implementation in lockstep. Without this, the surface is documented in one place and shipped in another.                                       |

When some gates are met but not all, the operation lives as an **extension** on the closest existing primitive. The extension is documented in [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s "Recall family shape variants" subsection (or the equivalent for the host primitive) and in the relevant MCP package's README. The extension MAY be the first step in the operation's eventual promotion to a dedicated primitive; staying as an extension is also a valid permanent posture.

**Worked example: `verify`.**

- Gate 1 (production use case): NOT MET in current single-agent scope. The three single-agent use cases (mirror gap, integrity audit, external relay) are real but rare; recall-with-`origin: 'remote'` covers them. They become necessary in Pattern 3 multi-agent scope, where agents routinely receive record_hashes from counterparties and must verify before acting.
- Gate 2 (spec backing): PARTIAL. `@atrib/verify` package exists and the verification operation is normative ([§1.4](atrib-spec.md#14-signing-and-verification), [§2.6](atrib-spec.md)). But it produces no graph effect; it's a read-side property of records that recall already exercises internally.
- Gate 3 (cognitive distinctness): WEAK in single-agent ("verify my own record" reads as a redundant recall); STRONG in multi-agent ("verify this claim from agent B" reads as a discrete cognitive operation distinct from looking up your own past).
- Gate 4 (paired shipping): N/A, the extension is the current posture.

**Current posture for `verify` after [D106](#d106-verify-is-promoted-to-cognitive-primitive-7):** dedicated primitive. Pattern 3 receiving flows made verification-before-linking necessary, so `@atrib/verify-mcp` now wraps the existing `@atrib/verify` package as `atrib-verify`.

**Promotion trigger for `verify`**: gates 1 and 3 strengthen to "MET" when Pattern 3 multi-agent flows ship and agents-receiving-counterparty-claims becomes a routine path. [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) records that this trigger fired on 2026-05-29 through two independent flows: a private continuation packet and a Cloudflare Agent transaction packet.

**Alternatives considered.**

- _Open the surface; admit any operation that passes the boundary test._ Rejected. The Letta finding cited in [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) (agent selection accuracy degrades past ~5-7 tools) makes surface bloat a real cost. Without acceptance gates, the primitive count drifts upward over project history without a forcing function for restraint.
- _Close the surface permanently at six; no future primitives._ Rejected. The cognitive operations atrib will need to express will grow as multi-agent flows, payment protocols, and new event_types ship. A hard cap at six would force eventual workarounds (parameter-stuffing, polymorphic dispatch) that [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) explicitly rejected for the writes.
- _Use the spec event_type promotion bar ([D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)) as the sole gate._ Rejected. Spec event_type promotion is a record-layer commitment (what the validator accepts, what the graph derivation rules cover). Cognitive primitive promotion is an agent-surface commitment (what the agent reaches for as a discrete tool). They overlap (primitive #2 atrib-annotate corresponds to event_type promotion [D058](#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), but they are not identical: read primitives like `recall` and `trace` have no event_type; capability-only operations like `verify` have spec backing but no event_type. Each layer needs its own promotion bar.

**Consequences.**

- The agent-facing surface count grows by zero unless a candidate operation passes all four gates. Until then, candidates live as extensions on existing primitives or are deferred entirely.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s closed posture remains intact in practice. [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) shows the path: the surface CAN grow, but only when the gates are met and the implementation ships with the ADR amendment.
- The `verify` operation has a documented current home (recall extensions) and a documented promotion path (Pattern 3 multi-agent activation). The ad-hoc "should this be a primitive?" debate is resolved.
- Future primitive candidates (potential names that have appeared in discussion: `subscribe`, `notify`, `cite`, `propose`, `delegate`) all enter through this lifecycle. None are added without an ADR.

**Substrate vs orchestration: where this ADR DOESN'T apply.**

atrib's primitives are all substrate operations, they produce signed records (write side) or query the resulting graph (read side). Operations that are external side-effects with NO graph effect are orchestration-layer concerns, not candidates for atrib primitives. They are captured INDIRECTLY by the wrapper's auto-signing of `tool_call` records when the agent invokes the relevant tool, but they do not warrant dedicated atrib MCPs. Examples that DO NOT meet this ADR's gates regardless of use-case load:

- **`notify`** (ping operator via push/slack/email/etc.), produces no signed record of its own; the act-of-notifying is captured via auto-signed `tool_call` when the agent invokes the notification tool. The channel itself is below atrib's layer.
- **`delegate`** (hand off work to another agent), produces no graph node distinct from the tool_calls it triggers; multi-agent coordination has its own protocols (A2A, MCP composition) and atrib captures it via the resulting signed records.
- **`wait` / `sleep` / `commit_payment`**, orchestration mechanics; substrate records the agent's intention via tool_call but the operations themselves are not substrate verbs.

The test: if the candidate operation would land in the graph as anything other than a `tool_call` auto-emission, it's a substrate primitive candidate (subject to this ADR's gates). If it would only land as a `tool_call`, it's orchestration.

**Cross-references.**

- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), the primitive surface this ADR's lifecycle governs.
- [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary), record-layer (spec event_type) promotion bar; complementary to but distinct from this ADR's surface-layer bar.
- [§1.4](atrib-spec.md#14-signing-and-verification) + [§2.6](atrib-spec.md), verification as a normative protocol operation; the substrate atrib-verify's package draws on.
- [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), the first completed promotion under this lifecycle.

---

## D081: In-process emit for hook-class producers (emitInProcess)

**Date:** 2026-05-22

**Superseded later the same day by [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape).** [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) preserves the in-process signing thesis (which is right) and replaces the _distribution_ shape (npm-install `@atrib/emit` inside the hook source directory) with a globally-installed CLI binary that the hook spawns. The empirical failure mode that motivated [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape): a `node_modules/` under the hook source dir triggers Claude Code's hook subsystem to silently drop hooks while files are mutating, producing record-emission gaps. The byte-identicality and bounded-key-resolution claims of this ADR all carry over to [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape); only the integration shape changes.

**Context.** A dogfood audit of the producer surface (prompted by Mario Zechner's "what if you don't need MCP" argument) found two coupled failures. The practice gap: across 14 days of the local mirror, the cognitive event types (observation / annotation / revision) were produced almost entirely by post-hoc session-end extractor batches and cron, not by deliberate in-session `atrib-emit` calls. The mechanism gap: the `atrib-emit` MCP server logged roughly 190 `connect timed out after 15000ms` failures per 24h, all tagged `[layer=sessionend]`, all `key=no-env`.

Root cause of the mechanism gap: a hook-class producer (the Claude Code lifecycle and PostToolUse hooks) signs a record by spawning the `atrib-emit` binary as an MCP subprocess over a `StdioClientTransport`, then running the JSON-RPC initialize handshake. In a headless context with no `ATRIB_PRIVATE_KEY` in the environment, `atrib-emit`'s `resolveKey` falls through to a synchronous, unbounded `spawnSync('security', ...)` Keychain call. A locked login Keychain in that context blocks, which stalls the MCP init handshake, which trips the caller's 15s connect timeout. Spawn-per-emit re-pays this on every cold spawn.

The deeper issue: an MCP server is a heavy transport for a capability the caller already has in-process. A hook is itself a short-lived Node process; it can sign a record by calling a function. The MCP stdio handshake and the cold-start it implies exist only because the hook reached for the binary instead of the library. [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) proposed a long-lived daemon to keep that subprocess warm; [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) was never implemented. A daemon optimizes a subprocess hop that, for the hook path, should not exist.

**Decision.** Hook-class producers, the producers that already run inside a short-lived Node process (the Claude Code lifecycle and PostToolUse hooks, watchers, batch jobs), sign in-process rather than spawning the `atrib-emit` binary over an MCP transport. Two changes land in `@atrib/emit`:

- **`emitInProcess()`**: a new public entrypoint that packages the recipe the [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) public-helpers block documents (`resolveKey`, `createSubmissionQueue`, `handleEmit`) and flushes the submission queue before returning, since a hook process exits immediately after. It routes through the same `handleEmit` as `createAtribEmitServer`, so records are byte-identical regardless of whether they were signed by the MCP server, the wrapper, or in-process.
- **Bounded key resolution**: `keys.ts` wraps its `security` and `op` spawns in a timeout (`ATRIB_KEYCHAIN_TIMEOUT_MS` default 3s, `ATRIB_OP_TIMEOUT_MS` default 10s) and short-circuits the second Keychain service on a timeout. Key resolution can no longer hang; in the worst case it returns null within a few seconds and the caller reaches the [§5.8](atrib-spec.md#58-degradation-contract) pass-through path.

The `atrib-emit` MCP server is retained unchanged as part of the interactive agent-facing surface ([D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s cognitive primitives, amended by [D106](#d106-verify-is-promoted-to-cognitive-primitive-7)). For an agent in a live session the server process is warm, and MCP is the right discovery mechanism: the tools appear in the agent's tool list without a separate README. This ADR narrows which producers use the MCP transport, not the transport's existence.

**Relationship to [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback).** [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback)'s daemon was motivated by exactly the failure this ADR addresses; its text cites bringing the "sessionend-burst drop rate" to zero and amortizing per-run spawn cost. In-process signing removes that cost without a daemon: there is no subprocess, no socket lifecycle, no crash-recovery surface. [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) is therefore superseded for the hook path. It is not revoked: a long-lived daemon may still be the right answer for a producer that genuinely cannot sign in-process (a non-Node producer, or a cross-process coordination need at multi-host scale). For hook-class producers, this ADR is the chosen path.

**Alternatives considered.**

- _Implement the [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) daemon._ Rejected for the hook path. It keeps the MCP/JSON-RPC machinery and adds daemon lifecycle: socket management, crash recovery, stale-socket cleanup, a SIGTERM drain. In-process signing has none of that surface. The daemon is the MCP-preserving fix; the dogfood log indicates the MCP-eliminating fix is strictly fewer moving parts on this path.
- _Reimplement the emit flow inside the hook script._ Rejected. Replicating `handleEmit` (key resolution, multi-producer chain composition via `inheritChainContext`, signing, mirror write, submission) in a standalone `.mjs` would create a second signing implementation that drifts from `atrib-emit`. `emitInProcess` keeps a single `handleEmit` path; the hook is a thin caller.
- _Leave the hook on spawn-per-emit and only bound the timeout._ Rejected as the complete fix, kept as defense in depth. The bounded-timeout change ships regardless, since it also protects the MCP server's own `resolveKey`. But on its own it converts a 15s hang into a roughly 3s fall-through that still drops the record. In-process signing removes the failure mode rather than shortening it.

**Consequences.**

- `@atrib/emit` gains `emitInProcess` and `EmitInProcessOptions` as stable public exports, and `keys.ts` gains two tunable timeout envs. Both ship in the next `@atrib/emit` release.
- The hook-side rewrite (the lifecycle and PostToolUse helper calling `emitInProcess` instead of spawning the binary) lands in the operator's hook repo and is gated on that release: the helper can only safely go in-process once the published `@atrib/emit` contains both the bounded key resolution and `emitInProcess`. Until then the hooks stay on the spawn path.
- The immediate `[layer=sessionend]` timeout cluster was removed independently, in the hook repo, by making the lifecycle hook exit when a session signed no records of its own (it had been annotating non-agentic `claude` invocations such as the nightly `claude plugin update` cron). That fix is live; the in-process rewrite is the structural follow-up.
- The practice gap (deliberate in-session emit) is downstream of the mechanism gap: a primitive that fails roughly 190 times a day cannot become a habit. Making emit reliable in-process is the precondition; the practice is expected to follow, not to be separately engineered.
- No spec change. Records signed in-process are byte-identical to MCP-server-signed and wrapper-signed records; `handleEmit` is the single path.

**Cross-references.**

- [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), the daemon ADR this supersedes for the hook path.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), the six-primitive MCP surface, retained as the interactive surface; its public-helpers block is the recipe `emitInProcess` packages.
- [§5.8](atrib-spec.md#58-degradation-contract), the degradation contract; bounded key resolution falls through to pass-through instead of hanging.
- [D067](#d067-multi-producer-chain-composition-precedence-contract), multi-producer chain composition; `emitInProcess` inherits it unchanged because it routes through `handleEmit`.

---

## D082: CLI binary distribution of emitInProcess (supersedes [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess)'s integration shape)

**Date:** 2026-05-22

**Context.** [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) introduced `emitInProcess()` as the right primitive for hook-class producers, then proposed importing it directly from `@atrib/emit` inside the host's hook helper. Making the import resolve required a local `package.json` and `node_modules/` in the hook source directory.

In production that arrangement produced a new failure mode the audit caught the same day. Claude Code's hook subsystem watches the hook source files and, while their containing directory was mutating (running `pnpm install`, regenerating symlinks, or refreshing the lockfile after a published `@atrib/emit` release), silently dropped PostToolUse and SessionEnd hook execution for roughly 29 minutes of active work. The user surfaced the gap by reading the live log via `explore.atrib.dev` (no records for two-plus hours despite continuous tool calls). A parallel installation event explained the cluster of misses. The mechanism was specific to the hook directory being a writable npm workspace; nothing about the import call itself was wrong.

The deeper observation: a hook source directory is, from Claude Code's perspective, a _configuration surface_. Configuration surfaces should not also be npm install targets. Mixing the two couples the agent's signing reliability to the operator's package-management cadence.

**Decision.** Ship `@atrib/emit` with a second binary, `atrib-emit-cli`, that wraps `emitInProcess` over a stdin/stdout JSON contract. The operator installs the package globally (`npm install -g @atrib/emit`), which lands the binary on `$PATH`. The hook helper spawns the binary instead of importing the library. Three properties survive from [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess):

- **In-process signing**: the binary is itself a short-lived Node process that calls `emitInProcess`. Records are byte-identical to MCP-server-signed and middleware-signed records ([§1.3](atrib-spec.md#13-canonical-serialization), [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)). The transport changed; the canonical form did not.
- **Bounded key resolution**: the `keys.ts` timeouts from [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) still apply, because the binary uses the same `resolveKey` path.
- **Hook-safe exit semantics**: the binary always exits 0 and writes its result as JSON to stdout, so the hook helper can route failures to a log line without disturbing the agent's tool call.

The hook source directory drops `package.json`, `node_modules/`, and the `@atrib/emit` runtime dependency. The helper becomes a small shell-out: build the envelope, spawn `atrib-emit-cli`, log the JSON it returns. The atrib-emit MCP server remains the interactive surface ([D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) primitives), unchanged.

**Alternatives considered.**

- _Keep the [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) in-place import._ Rejected. The failure mode is intrinsic to mixing an npm workspace with a Claude Code hook source directory; no amount of careful install sequencing fixes it because the operator cannot serialize all package mutations with hook firings. The CLI binary moves the install target to a global location, where mutations do not touch hook source.
- _Implement the [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) daemon now._ Rejected for the second time. A daemon would solve the same observed-failure surface, but at the cost of a long-running socket, crash-recovery logic, stale-pid handling, and SIGTERM drain. The spawn-per-emit CLI needs none of that. The CLI is fewer moving parts than the daemon and fewer than the in-place import. [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) stays parked for producers that genuinely cannot sign in-process.
- _Distribute the helper itself from `@atrib/emit`._ Rejected for this revision. The helper carries operator-specific conventions (envelope shape, log-path layout, auto-detect-`informed_by` scan kept in sync with `@atrib/mcp/refs.ts`) that belong in the operator's repo, not in the public package. The CLI surface is narrow and stable; the helper is host-specific glue.
- _Use `npx @atrib/emit` per call._ Rejected. `npx` resolves through the network on cache miss and pays a much heavier spawn cost than a globally-installed binary. The CLI shim under `/opt/homebrew/bin` (or equivalent) costs roughly 50ms to spawn cold; `npx` costs many hundreds of milliseconds when its cache is incomplete and adds a network dependency.

**Consequences.**

- `@atrib/emit` adds an `atrib-emit-cli` `bin` entry and a `dist/cli.js` shipped from `src/cli.ts`. The CLI's contract: read a JSON envelope from stdin (`event_type`, `content`, optional `context_id`, `informed_by`, `annotates`, `revises`), call `emitInProcess`, write the result JSON to stdout, log diagnostics to stderr, exit 0. The contract is the same shape the [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) helper already used internally; only the boundary moves.
- Operators install `@atrib/emit` globally on machines that run Claude Code hooks. The package's README documents `npm install -g @atrib/emit` as the supported install path for the hook use case (the existing `mcp-emit` binary continues to work for the interactive MCP surface; both ship from the same package).
- Host hook-source directories no longer declare a `package.json`. Existing `node_modules/` in legacy clones is one cleanup pass during the migration; subsequent clones never reproduce it.
- [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess)'s primary code change (`emitInProcess` in `src/index.ts`) remains shipped and exported. The CLI is a thin caller, not a replacement.
- No spec change. Same canonical form, same chain composition rules, same degradation contract.

**Cross-references.**

- [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess), the in-process-emit ADR this supersedes the integration shape of.
- [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), the daemon ADR; still rejected for the hook path. Still available for producers that genuinely cannot sign in-process.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), the six-primitive MCP interactive surface, unchanged.
- [§5.8](atrib-spec.md#58-degradation-contract), degradation contract; the CLI returns a non-fatal warning on flush-deadline expiry instead of throwing.

---

## D083: Harness session-id discovery extends [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for cognitive-primitive MCP servers

**Date:** 2026-05-22

**Context.** [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) made the four cognitive-primitive MCP servers (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`) honor `process.env.ATRIB_CONTEXT_ID` as a default when the caller omits `context_id`. That covers Inspect-style harnesses that explicitly thread per-run scope into spawned MCP children via the env block. It does NOT cover the steady-state Claude Code case: at session start Claude Code spawns MCP server children from `~/.claude.json` config; the env block is static and the operator does not typically set `ATRIB_CONTEXT_ID` per session. The substrate-health analysis 2026-05-22 surfaced the consequence empirically: ten fresh-orphan singleton chains in twenty-four hours from agent-initiated `atrib-annotate` calls under Claude Code, each producing a signed-but-uncomposable record because the MCP child had no parent env that knew the session's context_id.

The handoff pointed to threading per-session context_id into MCP server env blocks. But static env blocks cannot hold per-session values, and operator-machine-local wrapper scripts violate the harness-agnostic abstraction: they hard-code one harness's session-id env var in a host-machine script that does not travel with the published packages. The structural shape is to make the cognitive-primitive MCP servers discover session-id env vars exposed by registered harnesses, the same way W3C trace-context propagates `traceparent` without each receiver hard-coding sender identities.

**Decision.** Each of the four servers reads from a shared `resolveEnvContextId()` helper in `@atrib/mcp`. The helper applies a fixed precedence:

1. `ATRIB_CONTEXT_ID` if set and a valid 32-hex string ([D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) intent: explicit operator/harness declaration).
2. First valid match against `KNOWN_HARNESS_DISCOVERIES`, a static registry of `{ envVar, parse }` entries with per-harness derivation rules. The initial registry contains `CLAUDE_CODE_SESSION_ID` (UUID; dashes stripped + lowercased to produce a 32-hex context_id matching any companion PostToolUse hook's envelope-path derivation).
3. `undefined`, signaling the caller's existing resolution chain (`inheritChainContext`, mirror tail, synthetic genesis) should proceed.

Invalid values at any precedence level silently fall through. Harness env vars represent declared session scope, not misconfiguration; surfacing a warning would conflate intentional propagation with operator error.

Adding a new harness is a single registry entry. Per the spec's harness-agnostic abstraction, the registry is the public surface; consumers do not import per-harness logic.

**Per-server effect (extending [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)).**

- **`@atrib/emit`.** `handleEmit` now consults `resolveEnvContextId()` in place of the inline `ATRIB_CONTEXT_ID` lookup. The resolved value becomes `callerContextId` for `inheritChainContext`. Annotation and revision records produced via `@atrib/annotate` and `@atrib/revise` inherit the behavior transparently, since both delegate to `handleEmit` per [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s package layering.
- **`@atrib/recall`.** Module-init `ATRIB_CONTEXT_ID_DEFAULT` now calls `resolveEnvContextId()`. Recall queries default to scoping by the session's context_id when no `context_id` argument is passed.
- **`@atrib/trace`.** The per-call default for the `context_id` argument now reads `resolveEnvContextId()`. Trace walks scope to the session's context_id when neither the argument nor `ATRIB_CONTEXT_ID` is set.
- **`@atrib/summarize`.** The per-call `effectiveContextId` resolution now reads `resolveEnvContextId()`. Summaries default to the session's context_id when neither argument nor `ATRIB_CONTEXT_ID` is set.

**Alternatives considered.**

- _Operator-machine wrapper script (`spawn-mcp-with-context.sh` in `~/.atrib/bin/`)._ Rejected. Reversible and immediate, but operator-machine-local: every new operator re-derives the same orphan problem; the fix does not travel with the published `@atrib/emit` package. Hard-codes one harness's env var name in a host-machine script that violates the harness-agnostic abstraction. Composes poorly when a second harness joins; would require sibling wrappers per harness in operator config.
- _Hard-coded `CLAUDE_CODE_SESSION_ID` lookup inside each server's index.ts._ Rejected. Bypasses the registry pattern. Each server's lookup logic would diverge over time as harness rules evolve. Forces every new harness to touch every server.
- _Spec edit promoting harness-discovery to a normative requirement._ Rejected for this ADR. The signed-record wire format is unchanged. Discovery is a server-side default-resolution behavior, not a record-format obligation. A future spec section may codify the discovery registry as part of [§9](atrib-spec.md#9-integration-patterns), but per [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)'s precedent of "no spec change for runtime env-var behavior," this ADR stops at the package level.
- _Warning when harness discovery triggers the fallback._ Rejected. The fallback is silent by parallel construction with [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default). Callers wanting visibility can inspect the response `context_id` directly.

**Consequences.**

- The ten-orphan-singleton-per-24h class disappears for Claude Code MCP children once `@atrib/emit@0.14.0`, `@atrib/recall@0.5.0`, `@atrib/trace@0.4.0`, `@atrib/summarize@0.4.0`, and `@atrib/mcp@0.8.0` are globally installed. The fix lands per package, not per machine.
- Adding a new harness is a one-line registry entry in `packages/mcp/src/harness-context.ts`. Future [§9](atrib-spec.md#9-integration-patterns) integration patterns that land harness-aware context discovery should reference this ADR and add the registry entry as their implementation step.
- Test files that exercise the env-default path now run in environments where harness env vars may leak from the parent process (e.g. `vitest run` under Claude Code). `@atrib/recall`'s and `@atrib/summarize`'s test setup files now clear `CLAUDE_CODE_SESSION_ID` and `ATRIB_CONTEXT_ID` before module evaluation so the baseline matches the documented unset-env behavior.
- No spec change. The wire format of signed records is unchanged; the only behavior change is at default-resolution time.
- Compatible with [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) by extension: explicit `ATRIB_CONTEXT_ID` continues to win.

**Cross-references.**

- [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default), MCP servers honor `ATRIB_CONTEXT_ID` env; this ADR is its harness-aware extension.
- [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), per-arm context_id isolation; closing the steady-state orphan path for Claude Code aligns with the same intent.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), package layering; annotation and revision inherit via `handleEmit` delegation.
- [P013](#p013-new-runtime-integration-pattern---hosted-runtime-adapter-sign-events-stored-by-hosted-runtimes-like-anthropic-managed-agents), forward pattern for hosted-runtime adapters; future entries in the discovery registry should reference each pattern's ADR.
- [§1.2.3](atrib-spec.md#123-context_id), `context_id` format; harness-derived values are validated against the same 32-hex regex.

**Update 2026-05-23 (v2): file-fallback for startup-spawn harnesses.**

The original [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) (above; "v1") closed the orphan-singleton class for harnesses that spawn MCP children with the per-session env in scope (e.g. per-run Inspect arms). It did NOT close it for harnesses that spawn MCP children ONCE at process startup, before any session exists. Claude Code is the canonical example: the MCP server children listed in `~/.claude.json` are spawned at Claude Code launch; the per-session `CLAUDE_CODE_SESSION_ID` env var is created later, per conversation, and never propagates to the already-running children.

The 2026-05-22 ship was empirically verified only via the `atrib-emit-cli` binary path (hook subprocess inherits the per-session env from Claude Code's hook execution context). The in-process MCP child path was not exercised; a post-restart verification on 2026-05-23 found every agent-initiated `mcp__atrib-emit__emit` / `mcp__atrib-annotate__atrib-annotate` / `mcp__atrib-revise__atrib-revise` call landing under a synthesized orphan context_id. Historical mirror inspection of `atrib-emit-claude-code.jsonl` found 74 distinct orphan context_ids across 4587 producer-labeled records, roughly one per Claude Code process lifetime; none linked to actual session chains.

**Structural premise of v2.** The harness has a session-aware writer surface (the SessionStart hook) that DOES have per-session env in scope. The MCP child has no such surface, but can read a file. Move per-session state through a state file the writer maintains and the reader consults.

**Decision (v2 additive).** Extend `HarnessDiscovery` with an optional `fallbackFile?: () => string` thunk returning a per-instance state file path. Extend `resolveEnvContextId`'s precedence to try the file when the env var is unset or invalid:

1. `ATRIB_CONTEXT_ID` env (unchanged from [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)).
2. For each `KNOWN_HARNESS_DISCOVERIES` entry, in order:
   2a. `discovery.envVar` in env ([D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v1; per-session-spawn harnesses).
   2b. `discovery.fallbackFile()` readable + parseable ([D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2; startup-spawn harnesses).
3. `undefined` (unchanged).

File semantics:

- Maximum 128 bytes per read (rejects oversized garbage without parsing).
- Trimmed whitespace before `parse()`.
- All read failures silent: never throws, returns the same shape as "neither set" (parallel construction with v1's silent-fallback discipline).

Claude Code entry's `fallbackFile` thunk returns `~/.claude/state/active-session-id-${process.ppid}`. Per-PPID keying isolates concurrent Claude Code instances: each Claude Code's SessionStart hook and MCP children share the same `process.ppid` (Claude Code itself), so writer + reader resolve to the same file. Different Claude Code instances get different keys, no collision.

Writer responsibility lives in the operator's hook layer, not in `@atrib/mcp`. The reference writer is a SessionStart hook that reads `CLAUDE_CODE_SESSION_ID` from its env (Claude Code provides it to hook subprocesses), takes `process.ppid` (Claude Code's PID), and writes the file atomically (temp file + rename, mode 0600) on every session start. Other harnesses adopt the convention by adding their own writer + their own discovery entry; the public surface is the `HarnessDiscovery` interface.

**Alternatives considered (v2).**

- _MCP protocol extension for per-call session context._ Rejected. Not under atrib's control; Anthropic-side change with indefinite timeline.
- _Re-spawn MCP children per session._ Rejected. Architecturally violates MCP's "child = per-process" semantics; would force every MCP server to handle session lifecycle.
- _Agent threads `context_id` on every MCP call._ Rejected. Defeats [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)'s no-config goal; it relies on manual discipline that drifts over time. Workaround for now, not a structural fix.
- _Global state file (`~/.claude/state/active-session-id`) instead of per-PPID._ Rejected. Two concurrent Claude Code instances would overwrite each other's session ids; the second-most-recent reader would see the wrong session.
- _State file content = pre-derived 32-hex._ Rejected. The `parse()` function strips dashes + lowercases anyway. Writing the raw UUID lets the file remain operator-readable as a UUID, easier to debug.

**Consequences (v2).**

- The orphan-singleton class is closed for in-process Claude Code MCP children once `@atrib/mcp@0.9.0` ships AND the operator's SessionStart hook is updated AND Claude Code restarts. Library-side fix lands per package; writer-side fix lands per host.
- The 74 historical orphan context_ids in `atrib-emit-claude-code.jsonl` from past sessions stay orphaned. Records are immutable; future sessions get correct context_ids; old ones don't.
- Other startup-spawn harnesses (Cursor, Cline, similar) can adopt the file-fallback convention by extending their registry entry with a `fallbackFile` thunk and shipping a matching writer in their host integration. No additional spec change.
- A single Claude Code instance serving multiple sessions in sequence (e.g. via `/clear`) overwrites the state file each time. In-process MCP children read the most-recent session id, so cognitive primitive calls in a prior session within the same Claude Code instance would land under the newer session's context_id once the new SessionStart fires. The agent MUST thread `context_id` explicitly if disambiguating across sessions-within-instance matters. Acceptable because Claude Code today serves one active session per instance at a time; this constraint is documented here for the multi-session-future case.
- The `HarnessDiscovery` interface change is backward-compatible: `fallbackFile` is optional; existing registry entries without it keep the v1 env-only behavior.
- Consequence claim from [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v1 ("the ten-orphan-singleton-per-24h class disappears for Claude Code MCP children once `@atrib/mcp@0.8.0` is globally installed") was overstated: the env-only fix only closed the class for harnesses that spawn MCP children per-session. v2 actually closes it for Claude Code.

**Cross-references (v2).**

- [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v1 (above), original env-only shape.
- [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), orphan handling; v2 closes the empirical orphan path for in-process MCP children.
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), mirror sidecar shape; the producer label (`_local.producer`) already distinguishes hook-source vs MCP-child-source records, making the orphan-vs-correct-context split visible post-fix.

## D084: Read-primitive instrumentation for empirical loop-closure measurement

**Date:** 2026-05-23

**Context.** The 2026-05-23 substrate audit looked at whether the cognitive loop the [atrib SKILL](skills/atrib/SKILL.md) prescribes (surfacing → read → write referencing the surfaced record → next-session surfacing of new write) actually closes in interactive Claude Code sessions. The only data on hand was the PreToolUse decision-guidance hook's `fires.jsonl` (Surface 5, shipped 2026-05-22 as the "substrate-minimum" baseline). That file captures what records the host surfaced at each tool-call moment, but not what the agent did with them. Cross-referencing fires against the signed-record mirror gave a loose temporal-correlation answer ("did any cognitive write happen within ten minutes of a fire?") but no causal one ("did a write reference any of the fire's top-k record hashes?").

The handoff queued a "4th-pillar broadening" of three additional instrumentation surfaces plus a unified analyzer so the loop-closure question could be answered with all signals correlated rather than inferred from one source. Those four surfaces are this ADR's scope: Surface 6 (read primitives), Surface 7 (SessionStart), Surface 8 (cli-spawn transport), Surface 9 (the analyzer joining all four pillars + the signed-record mirror).

**Decision.** Each instrumentation surface writes its own per-event jsonl file under `~/.atrib/state/`, owned by the producer that generates the event. The analyzer reads all five sources and never writes (it only reports). Path conventions:

- `~/.atrib/state/decision-guidance/fires.jsonl` — Surface 5, pre-existing (the substrate-minimum hook's per-fire log).
- `~/.atrib/state/read-primitives/calls.jsonl` — Surface 6, written by the read-primitive MCP servers (`@atrib/recall` family, `@atrib/trace`, `@atrib/summarize`) via the `logReadPrimitiveCall` helper shipped in `@atrib/mcp@0.10.0`.
- `~/.atrib/state/session-start/surfaces.jsonl` — Surface 7, written by the host's SessionStart hook on every session boot.
- `~/.atrib/state/cli-spawn/calls.jsonl` — Surface 8, written by the host's `atrib-tool-emit-helper` after each cli-spawn fires.
- `~/.atrib/records/*.jsonl` — the signed-record mirror per [§5.9](atrib-spec.md#59-local-mirror-conventions), unchanged.

Wire schemas are stable. Each entry carries a session-scoped key (`session_id` as 32-hex per [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)) so the analyzer can join across sources without per-format conversion. Silent-failure per [§5.8](atrib-spec.md#58-degradation-contract) governs every writer: instrumentation MUST NOT block the primary path of any tool call or hook fire.

The unified analyzer (an `analyze-substrate.mjs` script that lives in the host integration's hook layer, not on npm) reports five questions per run:

1. Does PreToolUse surfacing drive reads? (fires top-k record-hash intersected with subsequent read-primitive sample-result-hashes)
2. Does reading drive writes? (read sample-result-hashes intersected with subsequent write `informed_by` entries)
3. Does SessionStart surfacing drive reads in the same session?
4. Per-session totals across fires + reads + writes + writes-carrying-informed_by + informed_by-intersecting-surfaced.
5. Cli-spawn transport health (p50/p90/p95 elapsed, error-class breakdown, cli-bin-source distribution).

The Surface 6 helper exports two functions from `@atrib/mcp`: `logReadPrimitiveCall(primitive, args, handler, extractHashes)` wraps any read-primitive MCP handler with timing + query-shape + sampled-hash logging; `extractRecordHashesFromMcpResult(result)` is the default extractor that deep-walks an MCP tool response for `sha256:<64-hex>` references. Caller-supplied extractors override when a tighter path exists.

`@atrib/recall`'s compact-mode response now always includes `record_hash`. The analyzer needs the primary key to correlate, and callers chaining other primitives (`recall_walk`, `recall_annotations`, `recall_revisions`, `trace`) previously had to fall back to verbose mode just to obtain the hash. Compact response is approximately seventy bytes larger per record. That cost is worth paying for a response that is actually chainable.

**Alternatives considered.**

- _In-band logging via signed observation records (one observation per read call)._ Rejected. Would inflate the public Merkle log with per-call records that have no defensible business meaning. The signed log is for the agent's reasoning, not for transport telemetry. Surface 6 stays out-of-band.
- _Single combined `~/.atrib/state/events.jsonl` with a `surface:` discriminator._ Rejected. Surfaces have different cadences and different writers; combining them creates coordination between producers that today have none. The five-file split keeps each producer's writer independent.
- _Computing record-hash on the analyzer side via JCS canonicalization of mirror records._ Rejected for Surface 9 v1. Requires linking `@atrib/mcp` into a hook-layer script and re-canonicalizing the entire mirror per analyzer run. The signed records' `informed_by` field already carries full record-hash strings; the analyzer uses those directly and does not need to compute hashes itself for the correlations defined above.
- _Aggregating per-call jsonl rows into pre-rolled metrics at write time._ Rejected. Pre-rolling forces a fixed metric set into the writer side; the analyzer's question set evolves faster than the metric definitions and would otherwise drift. Raw per-event jsonl plus a versioned analyzer is the simpler shape.

**Consequences.**

- The cognitive loop the SKILL prescribes becomes measurable. Before Surface 6, "are agents reading?" was answered by counting tool-use entries across all Claude Code transcripts (twelve lifetime reads against six thousand transcripts), but with no causal link to the records that were surfaced. After Surface 6 plus the analyzer, an interactive session that calls `mcp__atrib-recall__*` against a surfaced record-hash produces a measurable causal entry.
- Surface 7's `block_byte_counts` map gives a stable per-block byte budget for the SessionStart hook. The labels are pinned by `SURFACE_7_BLOCK_NAMES` so analyzer consumers can target specific blocks (e.g. "how much byte share did pending-work signals take?") without parsing prose headings.
- Surface 8's structured per-call jsonl is additive to the pre-existing text log in `~/.atrib/logs/mcp-signer.log`. The text log continues to write unchanged for tail-grep tooling; the jsonl is for analyzer joins.
- Historical cli-spawn coverage starts from the Surface 8 ship date. The text log holds older data; a one-shot backfill script would grep it into the new jsonl format if retrospective analysis ever needs the long tail. Not done at ship time.
- The Surface 6 wrapper is silent-failure: a write error in the instrumentation finally-block is swallowed, and the wrapped handler's result (or thrown error) propagates unchanged. This is the same posture [§5.8](atrib-spec.md#58-degradation-contract) applies to all atrib failure paths.
- `@atrib/recall`'s compact response carries one new field (`record_hash`). Schema is additive; existing callers continue to work, and new callers gain the primary key without paying the verbose-mode cost.

**Cross-references.**

- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), the cognitive primitives the loop is built on.
- [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), the session-id resolution Surface 6 uses to populate `session_id` in its jsonl.
- [§5.8](atrib-spec.md#58-degradation-contract), the silent-failure contract.
- [§5.9](atrib-spec.md#59-local-mirror-conventions), the mirror that Surface 9 reads as its primary write source.
- The host-side surfaces (7, 8, 9) live in the host integration's hook layer (not on npm; operator-side). No spec change. The wire format of signed records is unchanged.

---

## D085: Recall calibration defaults: survey-grounded rationale

**Date:** 2026-05-23

**Context.** The Layer 1 v2 ship (PR #70 + PR #73, 2026-05-23 PM) introduced Park et al.-style weighted-sum scoring for `rank_by='relevance'` in `@atrib/recall`. Specific defaults landed in source: `ATRIB_RECALL_ALPHA=0.3` (recency weight), `ATRIB_RECALL_BETA=0.3` (importance weight), `ATRIB_RECALL_GAMMA=0.4` (BM25-relevance weight), `ATRIB_RECALL_TAU_DAYS=7` (exponential-decay time constant), `ATRIB_RECALL_NOISE_FLOOR=0.15` (anti-noise threshold that returns empty + `quality:below_threshold`), plus per-tool `limit=25` default in `recall_my_attribution_history` and `k=10` in `recall_by_content`. The numbers were picked by feel during Layer 1 v2 design. The operator surfaced the concern: we are making opinionated choices in the dark, with no precedent and no way of knowing if we are informed.

This ADR codifies the rationale for each calibration choice against a 2026-05-23 two-axis survey: published agent-memory research (Park et al. 2023, MemGPT/Letta, A-MEM, MemoryBank, SCM, Mem0, LangMem, RAGAS, LoCoMo) and OSS implementations (LangChain `TimeWeightedVectorStoreRetriever`, LlamaIndex postprocessors, CrewAI composite scorer, mem0 scoring, Haystack BM25, Letta, AutoGen, OpenAI Agents SDK). Both surveys required URL citation per claim.

**Decision.** Keep `ALPHA=0.3`, `BETA=0.3`, `GAMMA=0.4`, `TAU_DAYS=7`, `NOISE_FLOOR=0.15`. Change `recall_my_attribution_history` default `limit` from 25 to 10 to match field convergence. The noise-floor-returns-empty behavior is retained as a deliberate atrib protocol innovation with no peer precedent.

**Survey findings, by calibration.**

| Choice                                                        | Field anchor                                                                                                                                                                                                                                                                                                                                                                     | Verdict                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weighted-sum scoring shape                                    | Park et al. 2023 is the only paper using this shape; weights all `=1.0` in the original. Repeated across CrewAI, LangChain, LlamaIndex, mem0 in OSS. A-MEM and Letta use pure vector similarity (no composition).                                                                                                                                                                | Defensible. The shape is the mainstream choice when systems compose multiple signals at all.                                                                                                                                                                                                                                                            |
| `ALPHA=0.3` (recency)                                         | CrewAI's [`recency_weight=0.3`](https://github.com/crewAIInc/crewAI/blob/e787b569d0c4108a76b9ddc134daa3de96b294da/lib/crewai/src/crewai/memory/types.py#L149-L178) is the only normalized-weights peer in either survey. Park used unnormalized `1.0/1.0/1.0`. LangChain + LlamaIndex use implicit `1.0` (additive, silent scale coupling).                                      | Defensible. Real convergence with CrewAI, not coincidence.                                                                                                                                                                                                                                                                                              |
| `BETA=0.3` (importance), `GAMMA=0.4` (relevance)              | CrewAI uses `semantic=0.5, importance=0.2` (different split). No other peer publishes normalized weights for these signals.                                                                                                                                                                                                                                                      | Defensible-as-deliberate. Annotation-derived importance is a sparse signal in atrib (most records carry none); raising `BETA` would amplify noise from the few annotated records. Relevance is BM25-textual (not embedding-semantic like CrewAI's), so a lower `GAMMA=0.4` versus CrewAI's `semantic=0.5` reflects BM25's known weaker signal strength. |
| `TAU_DAYS=7` (exponential decay)                              | Park et al. `0.995/hour` produces half-life ~5.75 days, the only paper anchor. OSS range: LangChain ~3 days, LlamaIndex ~1 hour (likely degenerate / copy-paste error), CrewAI 30 days. atrib's 7-day tau produces half-life `tau * ln(2) = 4.85 days`.                                                                                                                          | Defensible. Sits inside the plausible field range, within ~1 day of Park's empirical anchor. atrib is the only system using the cleaner `exp(-t/tau)` form rather than `base^t`.                                                                                                                                                                        |
| `NOISE_FLOOR=0.15` (return empty + `quality:below_threshold`) | **No precedent in either survey.** No published paper or OSS implementation returns empty with a quality signal. mem0 has a `threshold` parameter that filters candidates one-by-one but returns whatever's left (could be zero, but no quality flag). CrewAI's confidence thresholds gate LLM exploration depth, not return-empty. Everyone else returns top-K unconditionally. | Novel. Defensible as a deliberate atrib protocol innovation: trust-the-absence lowers hallucination risk from low-confidence context. The `alpha * 0.5 = 0.15` derivation is internally consistent. Empirically un-validated by atrib's own gold-standard sweep (queued).                                                                               |
| `limit=25` default on `recall_my_attribution_history`         | Field convergence on `top_k=10` (Haystack, AutoGen, mem0, Letta). Outliers: LangChain `k=4`, LlamaIndex `k=1`.                                                                                                                                                                                                                                                                   | Out of step. Changed to 10 in this ADR's commit. Reduces default token weight in agent context windows. `recall_by_content` already defaults `k=10`.                                                                                                                                                                                                    |

**Alternatives considered.**

- _Align all weights with CrewAI exactly (0.5 semantic, 0.3 recency, 0.2 importance)._ Rejected. atrib's relevance is BM25 (textual), not embedding similarity, so the signal strength differs from CrewAI's `semantic`. Importance in atrib is sparser than CrewAI's per-memory operator-assigned score, warranting a higher `BETA` to give annotated records meaningful lift. The shared `recency=0.3` is the convergence point; the rest of the split is atrib-specific by design.
- _Drop the noise floor and return top-K always (the field convention)._ Rejected. Trust-the-absence is a deliberate atrib product principle. Returning low-confidence top-K when the best candidate is recency-only noise creates hallucination risk in downstream agent reasoning. Keeping the empty-return path costs little and gives callers a structured signal they can act on.
- _Bump `NOISE_FLOOR` to `alpha=0.3` so the threshold actually fires on active mirrors with constant fresh tool-call activity._ Deferred to the queued gold-standard sweep. The current `0.15` floor fires the stale-mirror empty case correctly per design comment; it does not fire the active-mirror nonsense-query case (best record's recency alone produces `alpha * 1.0 = 0.3`, above the 0.15 floor). Whether the threshold's intent should be widened to catch the second case is an empirical question the sweep should answer, not a feel-based bump.
- _Keep `limit=25` default._ Rejected. Field convergence on 10 is consistent enough across Haystack, AutoGen, mem0, and Letta that the divergence is unjustified. Token cost in agent context windows scales with the limit; defaulting smaller is the safer choice when callers can always override.

**Consequences.**

- `recall_my_attribution_history` returns 10 records by default instead of 25. Schema description updated. Existing callers passing explicit `limit=N` are unaffected; callers relying on default see fewer records. Token weight in agent context drops by ~60% per default-recall call.
- Source comments at `services/atrib-recall/src/index.ts` lines ~78-110 now cite the field anchors per calibration. Comments make the informed-bet framing legible to future readers.
- `services/atrib-recall/README.md` gains the survey-grounded rationale and the novel-in-field framing for the noise floor.
- The noise-floor-returns-empty pattern is now an atrib-claimed protocol innovation rather than implicit convention. Downstream users (`@atrib/agent`, harness integrations) can rely on the structured signal as part of the recall contract.
- A gold-standard eval set + parameter sweep remains queued. Until that work lands, the defaults here are informed-bet priors, not measured constants.
- The change is a minor bump to `@atrib/recall` (default behavior change to a public API surface). `0.9.0 -> 0.10.0`.

**Cross-references.**

- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface): the cognitive primitive surface the recall API belongs to.
- [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement): the Surface 6 instrumentation that will feed the queued gold-standard sweep with real-workload data.
- `services/atrib-recall/README.md`: customer-facing reference for the calibration defaults and the novel-in-field noise-floor behavior.
- Survey citations: see the inline GitHub permalink in the `ALPHA=0.3` row above. The full two surveys (research papers + OSS source) were one-shot research artifacts; their cited URLs live in the session trace, not as separate checked-in research files.

## D086: BM25 corpus extended from annotations to per-event_type record content

**Date:** 2026-05-24

**Context.** The Layer 1 v2 ship ([D085](#d085-recall-calibration-defaults-survey-grounded-rationale), PR #79, 2026-05-23) settled the recall scoring weights but inherited a deeper structural choice from earlier work: the BM25 corpus was built only from annotation summaries + topics (`indexableTextFromAnnotation` in `services/atrib-recall/src/scoring.ts`), never from the actual record content body. Records with no annotation pointing at them contributed an empty token list to the BM25 index, so `recall_by_content(query="X")` could find them only if a separate `atrib-annotate` call had attached a summary.

Empirically against the operator's 2026-05-24 mirror (14,363 records), this meant near-zero records were searchable by content: the agent's `atrib-emit({what: "decided X because Y"})` records were structurally invisible to `recall_by_content` unless the operator separately annotated them. Audit found no design rationale — annotation-only indexing was a latent gap from atrib originally being a verifiable-attribution protocol (signed records for auditors) where annotations were the primary curated surface, with agent-memory features layered on later without revisiting the corpus shape.

Comparable production memory systems (Mem0, memGPT/Letta, LangMem, Zep, OpenAI ChatGPT Memory) all index record CONTENT, not just curator-applied metadata. atrib's annotation-only indexing was an outlier that worked against the agent-memory use case.

**Decision.** Extend the BM25 indexable corpus from `annotation summary + topics only` to `per-event_type record content + annotation summary + topics (when present)`. Lift the per-event_type extraction to `@atrib/mcp` as a normative protocol-level contract so producers and consumers round-trip via the same shape definition. Re-clamp BM25 contribution to [0, 1] in the parkScore call site so the documented Park-component bound is honored. Recalibrate `ATRIB_RECALL_NOISE_FLOOR` from 0.15 → 0.6 to track the corpus shift.

**Shipped surfaces.**

| Surface                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mcp/src/content-shapes.ts` (new)                       | Per-event_type type defs (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + `extractIndexableText(eventTypeUri, content, opts?)` dispatch. Generic recursive string-walk fallback for extension URIs (depth-capped at 4, field-length-capped via `DEFAULT_FIELD_CAP=2048`). 28 new unit tests in `packages/mcp/test/content-shapes.test.ts`. |
| `services/atrib-recall/src/scoring.ts`                           | New `indexableTokensForRecord(loaded, annotation?)` builds tokens from `@atrib/mcp` `extractIndexableText` of the sidecar content, then concats annotation summary+topics when present. `indexableTextFromAnnotation` retained for callers that only have annotation data. 9 new integration tests in `services/atrib-recall/test/scoring.test.ts`.                                                                           |
| `services/atrib-recall/src/index.ts`                             | Both BM25 corpus-build call sites (`rankByRelevance` line ~533, `recall_by_content` line ~1295) switched from `indexableTextFromAnnotation` to `indexableTokensForRecord`. `rankByRelevance` parkScore site now clamps `rel = Math.min(rawBm25, 1)` to honor the [0, 1] Park-component bound.                                                                                                                                 |
| `ATRIB_RECALL_NOISE_FLOOR` default                               | 0.15 → 0.6. The prior floor was effectively a no-op against the new corpus (every record passes recency-only baseline of 0.3). New floor sits between the recent+annotated-only baseline (~0.55) and the empirical real-query minimum (0.6985) observed against the operator's mirror.                                                                                                                                        |
| `services/atrib-recall/test/layer1-filters.test.ts`              | Existing `rank_by='relevance'` tests updated to use future timestamps (recency clamps to exactly 1.0) + critical annotations so fixtures clear the new floor organically. The dedicated noise-floor suppression test's assertion updated from `< 0.15` to `< 0.6`.                                                                                                                                                            |
| `services/atrib-recall/scripts/calibration-sweep-d086.mjs` (new) | Empirical sweep against the local mirror; reports top_park distributions for real vs nonsense queries. Reproducible derivation evidence for the new floor.                                                                                                                                                                                                                                                                    |

**Survey findings, by calibration choice (deltas from [D085](#d085-recall-calibration-defaults-survey-grounded-rationale)).**

| Choice                          | Pre-ship status                                                                                                                                    | Post-ship derivation                                                                                                 | Verdict                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BM25 corpus shape               | Annotation summary + topics only (sparse, ~99% records produce empty tokens)                                                                       | Per-event_type record content via `@atrib/mcp` `extractIndexableText` + annotation augment when present              | Mainstream alignment: Mem0/memGPT/LangMem/Zep all index record content. atrib was the outlier.                                                                                                                                                                                                                                                                    |
| BM25 clamp                      | None (raw unbounded score fed into parkScore; documented [0,1] bound honored accidentally because annotation-only corpus rarely produced big hits) | `rel = Math.min(rawBm25, 1)` at the parkScore call site                                                              | Restores documented invariant. Lossy at the saturated end but preserves ordering for the records that actually exceed the cap.                                                                                                                                                                                                                                    |
| NOISE_FLOOR                     | 0.15 (= `alpha * 0.5`, derived as "recency-only median-aged baseline")                                                                             | 0.6 (sits between recent+annotated-only baseline 0.55 and empirical real-query min 0.6985 against 2026-05-24 mirror) | Prior floor is a no-op against the new corpus (everything passes). New floor catches the "active mirror, no meaningful relevance" case while preserving real queries. Tight ~0.01 empirical gap means the value is informed-bet, not measured; gold-standard sweep (queued in [D085](#d085-recall-calibration-defaults-survey-grounded-rationale)) will validate. |
| ALPHA / BETA / GAMMA / TAU_DAYS | Unchanged from [D085](#d085-recall-calibration-defaults-survey-grounded-rationale)                                                                 | Unchanged                                                                                                            | Weight calibration is independent of corpus shape. With BM25 now firing routinely, GAMMA=0.4 ceiling is small relative to recency+importance baseline; deferred to the queued sweep.                                                                                                                                                                              |

**Extension URIs.** A first-class design concern. Extension event_type URIs (non-normative, minted by third parties in their own namespaces per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)) cannot have shape-aware extractors at protocol level — the protocol can't dictate what a third-party event_type carries. This ADR provides three layered paths for extension URI indexing:

1. **Generic recursive string-walk (default, no producer cooperation required).** Extension URI content is best-effort indexed via `extractExtensionText` in `content-shapes.ts`: recursive walk up to `MAX_WALK_DEPTH=4`, all primitive string values concatenated, each capped at `DEFAULT_FIELD_CAP=2048`. Works for any content shape; lossy because there's no per-field weighting and the walker indiscriminately includes non-content strings (timestamps, IDs, metadata). The depth cap bounds work on adversarial inputs.
2. **Annotation as the bridge (existing primitive).** Extension producers can call `atrib-annotate` on their important records; the annotation summary + topics are indexed alongside the generic walk and act as a curator-quality lift. No new mechanism required; uses the same primitive operator-driven curation flows already use.
3. **Producer-declared shape descriptors (future).** Out of scope here. An extension URI could in principle register a shape contract with the protocol so consumers look up the right per-field extractor by URI; this would require a protocol-level shape registry mechanism. Open question whether the demand justifies the additional surface area.

The recommendation in `services/atrib-recall/README.md` is: **extension URI producers SHOULD adopt one of the recognizable normative-shape field names (`what`, `why_noted`, `summary`, `description`, `topics`) so the generic walker picks them up naturally, OR call `atrib-annotate` on important records to lift them via the curator path.** The generic walker is the path of least resistance; the explicit guidance prevents extension producers from silently assuming they get normative-event_type indexing fidelity.

**Round-trip contract.** Per the [§1.2](atrib-spec.md#12-record-format) decision that `AtribRecord` is structural-only (no `content` field; content lives in the [D062](#d062-local-mirror-sidecar-two-tier-private-local--public-canonical-persistence) sidecar at `_local.content`), `extractIndexableText` operates on the sidecar payload. Producers (`@atrib/emit`, `@atrib/mcp` wrapper, `@atrib/annotate`, `@atrib/revise`, payment-protocol adapters) write content matching the normative shape definitions in `@atrib/mcp/content-shapes`; consumers (`@atrib/recall`, future audit tools, third-party clients in other languages) read content via the same shape contract. This codifies what was previously implicit (shapes documented as Zod schema descriptions inside `services/atrib-emit`, with no shared type surface).

**Alternatives considered.**

- _Auto-annotate on emit._ Have `@atrib/emit` auto-derive an annotation `summary` from `content.what` so the existing annotation-only corpus becomes non-empty. Rejected: hides what's happening (every emit silently creates a second signed record), couples emit semantics to indexing strategy, and only fixes observation shape (tool_call records still need their own treatment). Per-event_type extraction is the cleaner separation.
- _Layer 2 sqlite-vec sidecar (semantic embedding search)._ The natural production-memory parity move. Deferred: irrelevant to evaluate until the content corpus exists at all (this ADR is the prerequisite). The roadmap entry stays; shipping here unblocks evaluating whether Layer 2 is necessary on top of a proper BM25 corpus.
- _Drop the noise floor entirely and return top-K always._ The mainstream field convention ([D085](#d085-recall-calibration-defaults-survey-grounded-rationale) survey: every comparable system does this). Rejected for the same reasons as in [D085](#d085-recall-calibration-defaults-survey-grounded-rationale): trust-the-absence is a deliberate atrib product principle, lowering hallucination risk from low-confidence context. The threshold behavior is retained; only the constant is rebased.
- _Normalize BM25 by sum-of-idf or by max-per-query._ More principled bounding than the simple `min(rel, 1)` clamp. Deferred: a single-line clamp is enough to preserve the [0, 1] invariant here; a normalization scheme is a refinement worth piloting alongside the queued gold-standard sweep.

**Consequences.**

- `recall_by_content` becomes useful as designed: agents can find their own past emits without requiring a separate annotation pass. Closes the structural gap surfaced during a 2026-05-24 controlled-experiment design pass, where annotation-only indexing meant the substrate-equipped condition's second iteration had nothing to find even when the first iteration emitted.
- Behavior change for callers: queries that previously returned empty (no annotation in corpus) now may return records. Token weight in agent context windows increases proportionally; callers using the existing `limit` parameter (default 10 for `recall_by_content` and `recall_my_attribution_history` per [D085](#d085-recall-calibration-defaults-survey-grounded-rationale)) are unaffected.
- New `@atrib/mcp` exports (`extractIndexableText`, the six per-event_type extractors, `DEFAULT_FIELD_CAP`, content-shape type definitions). Additive; no removals.
- `@atrib/recall` v0.11.0 (minor bump); `@atrib/mcp` v0.11.0 (minor bump). Both are additive: existing API unchanged.
- The noise-floor recalibration is the only behavior change visible at the recall response shape. Callers depending on the 0.15 default to NOT trip suppression (i.e. relying on permissive behavior) will see more `quality:below_threshold` responses. The env var still overrides for callers that want to retain prior behavior.

**Cross-references.**

- [D085](#d085-recall-calibration-defaults-survey-grounded-rationale): the calibration ADR this one extends. [D085](#d085-recall-calibration-defaults-survey-grounded-rationale) set the weights; this ADR ships the corpus.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface): the six primitives whose round-trip indexing this ADR makes work end-to-end.
- [§1.2](atrib-spec.md#12-record-format): the structural-only AtribRecord decision that puts content in the sidecar.
- [§8.3](atrib-spec.md#83-salted-commitment-posture): the salted-commitment privacy posture this ADR does NOT touch (content stays in the local mirror; the public log still commits hashes only).
- [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary): the extension-URI promotion bar that gates whether a third-party event_type ever gets normative shape-aware extraction.
- `services/atrib-recall/scripts/calibration-sweep-d086.mjs`: reproducible empirical evidence for the new floor.

---

## D087: Signed diagnostic outcome + causal trace replay as canonical repair pattern

**Date:** 2026-05-25

**Context.** The first clean behavior-impact repair result (P0, 2026-05-25) showed that when a harness signs an implementation record, signs a diagnostic outcome record that is causally linked to that implementation via `informed_by`, and surfaces both through `atrib-recall`, a later agent step improves versus the same setup without recall. The next locked result (P1, 2026-05-25) narrowed the read surface from whole-session recall to `atrib-trace` rooted at the diagnostic record; the improvement survived. The important correction during P1 was consumer semantics: the model initially traced the right records but sometimes preserved old implementation behavior over the diagnostic expected/actual failures. Adding a generic repair rule ("diagnostic outcome evidence overrides the implementation ancestor it evaluates") made the result stable.

**Decision.** Formalize "signed diagnostic outcome + causal trace replay" as the canonical atrib usage pattern for repair/refinement tasks. The pattern is:

1. Sign the implementation/action record.
2. Sign a diagnostic/evaluator `tool_call` record whose `informed_by` references the implementation/action record.
3. Put actionable diagnostic detail in the [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror body: suite id, pass/fail counts, per-case input, expected, actual, and diagnostic/error text.
4. In the next repair/refinement step, consume the evidence with `atrib-trace` from the diagnostic record hash, bounded by depth and scoped by context_id when appropriate.
5. Interpret conflicts using a generic consumer rule: diagnostic outcome fields describe how the ancestor behaved under evaluation, so expected/actual deltas are the repair target when the task is repair/refinement.

This is a pattern-level decision, not a wire-format change. Diagnostic outcomes use the existing `tool_call` event type with `tool_name`, `args_hash`, `result_hash`, [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror content, and `informed_by`. The graph remains structural; no new edge type or weighting rule is introduced.

**Alternatives considered.**

- _Dedicated diagnostic event_type._ Rejected for now. The current need is consumer interpretation of an evaluator tool_call, not new graph derivation. Promotion would need a distinct cognitive purpose and graph effect per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).
- _Whole-session recall as the canonical pattern._ Rejected as too broad. P0 proved recall can work, but P1 showed the more precise primitive is a causal trace rooted at the diagnostic record.
- _Rely on spontaneous agent use of the six primitives._ Rejected as the next proof step. Empirical read/write primitive adoption is near zero in current agent runs, so the durable pattern must work through harness-mediated consumption before testing how much agency can be handed back.
- _Treat diagnostic precedence as task-specific prompt magic._ Rejected. The rule is generic evidence semantics for repair/refinement tasks: an outcome record evaluates its `informed_by` ancestor.

**Consequences.**

- `@atrib/trace` and `@atrib/recall` need to preserve signed tool fields (`tool_name`, `args_hash`, `result_hash`, `informed_by`) and optionally surface [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror content so agents can act on diagnostic detail without confusing commitment hashes for records.
- Harnesses testing behavior impact should prefer trace-rooted diagnostic replay over broad transcript summaries, because the independent variable is clearer: the agent consumed a signed diagnostic chain.
- The next behavior-impact experiments should be ablations around this pattern: full trace + precedence semantics, diagnostic-only trace, implementation-only trace, and full trace without the precedence rule.
- This pattern strengthens the inward-facing value proposition without claiming spontaneous cognitive-primitive adoption yet. It says the substrate improves behavior when a harness writes and replays signed diagnostic evidence correctly.

**Cross-references.**

- [§7.7](atrib-spec.md#77-signed-diagnostic-outcome--causal-trace-replay), the informative spec pattern.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), especially `atrib-trace` as the causal replay primitive.
- [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement), instrumentation for measuring whether reads happen and which hashes were returned.
- [D086](#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content), sidecar content extraction that makes diagnostic bodies legible to read primitives.

---

## D088: AP2 v0.2 transaction hook is the successful receipt

**Date:** 2026-05-27

**Context.** A May 2026 review of FIDO's Verifiable Intent / AP2 framing and the current `google-agentic-commerce/AP2` repository found that atrib's AP2 model had drifted. [D017](#d017-ap2-v01-uses-a2a-dataparts-not-w3c-verifiable-credentials) was correct for AP2 v0.1: a `parts[].data["ap2.mandates.PaymentMandate"]` A2A DataPart was the best available close signal. AP2 v0.2 now separates authorization from outcome more clearly. Checkout Mandates and Payment Mandates authorize the agent action. Checkout Receipts and Payment Receipts are verifier-signed outcomes.

That distinction matters for atrib because `transaction` is the [§4.6](atrib-spec.md#46-the-calculation-algorithm) closing event. Treating a mandate as the transaction closes the attribution chain before the merchant, payment processor, or verifier has accepted the action. It also blurs AP2's own evidence model: mandates answer "was the agent authorized?", while receipts answer "what did the verifier decide?"

**Decision.** For current AP2 integrations, atrib detects transactions from successful AP2 receipts, not mandate-only payloads.

The AP2 detector now treats these as `protocol: 'AP2'` transaction signals:

1. A decoded Payment Receipt object with `status: "Success"` and the required AP2 payment receipt fields.
2. A decoded Checkout Receipt object with `status: "Success"` and the required AP2 checkout receipt fields.
3. An AP2 sample result envelope with `status: "success"` plus a compact signed `payment_receipt` or `checkout_receipt` JWT field.

The detector does not decode signed receipt JWTs on the hot path. Header/payload verification and richer receipt extraction belong in a higher-fidelity AP2 adapter or verifier path, not in the low-latency transaction detector.

The detector MUST NOT treat AP2 mandate-only payloads as transaction events. This includes v0.2 SD-JWT `vct` values such as `mandate.payment.1`, `mandate.checkout.1`, `mandate.payment.open.1`, and `mandate.checkout.open.1`.

The older AP2 v0.1 DataPart path remains a compatibility fallback. The legacy W3C VC fallback for research forks also remains, but it is not the current AP2 signal.

**Alternatives considered.**

- _Keep `PaymentMandate` as the AP2 transaction hook._ Rejected. It preserves compatibility but closes the chain at authorization time, before verifier acceptance.
- _Decode and verify AP2 receipt JWTs inside `detectTransaction`._ Rejected. The detector should stay a shape detector. Verification needs keys, issuer policy, and error reporting that do not belong on the middleware critical path.
- _Require both Checkout Receipt and Payment Receipt before detecting._ Considered. AP2 completion normally returns both, but deployed tool surfaces may expose one before the other. A successful Payment Receipt is enough to prove payment outcome. A successful Checkout Receipt is enough for checkout acceptance where payment processing is already upstream of the returned result. Higher-fidelity settlement tooling can require both when available.
- _Remove the v0.1 DataPart fallback immediately._ Rejected. Existing integrations and fixtures still use the v0.1 shape. Keeping the fallback is additive and does not weaken the v0.2 rule because v0.2 mandate `vct` payloads are explicitly rejected.

**Consequences.**

- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402) now documents AP2 v0.2 receipts as the primary hook, with v0.1 DataPart and legacy VC fallbacks separated.
- `@atrib/agent` gained AP2 v0.2 receipt fixtures and tests for successful receipt objects, signed receipt result envelopes, mandate-only rejection, and error receipt rejection.
- [PRIOR-ART.md](PRIOR-ART.md) now describes AP2 as a receipt-based hook rather than a PaymentMandate hook.
- The attribution graph remains structural. This decision changes which AP2 observable shape produces a `transaction` node; it does not add an AP2-specific edge type.
- Cross-attestation remains a separate requirement per [D052](#d052-cross-attestation-requirement-for-transaction-records). AP2 receipts can supply counterparty evidence, but the transaction record still needs the `signers` array when the multi-signer path is implemented.

**Cross-references.**

- [D017](#d017-ap2-v01-uses-a2a-dataparts-not-w3c-verifiable-credentials), the older AP2 v0.1 detector decision that remains as a fallback.
- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402), updated AP2 hook text.
- [D052](#d052-cross-attestation-requirement-for-transaction-records), transaction records require multiple signers.

---

## D089: AP2 / Verifiable Intent evidence checks live in @atrib/verify

**Date:** 2026-05-27

**Context.** [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) deliberately kept the AP2 transaction detector conservative. The detector fires on successful CheckoutReceipt or PaymentReceipt shapes, keeps the AP2 v0.1 DataPart fallback, and does not decode mandates or receipt JWTs in the middleware path.

That leaves a second verifier question: after a transaction is detected, what evidence should a merchant, auditor, or settlement tool check to decide whether the AP2 action was authorized by Verifiable Intent and accepted by the AP2 verifier?

FIDO's Verifiable Intent framing and the current AP2 v0.2 documents point to an SD-JWT delegation chain, not a WebAuthn assertion payload. The relevant verifier evidence is: L1 issuer credential, L2 user mandate, optional L3 agent mandate, `sd_hash` links, disclosure digests, `cnf.jwk` delegation keys, AP2 checkout/payment hash binding, and successful AP2 receipts.

**Decision.** Add `verifyAp2ViEvidence()` to `@atrib/verify` as a local AP2 / Verifiable Intent evidence checker. It is off the transaction detector path and returns a result object with `valid`, `transactionAccepted`, AP2 receipt checks, VI credential checks, warnings, and errors.

The checker performs these validations when the evidence is present:

1. AP2 receipt success and required-field checks for PaymentReceipt and CheckoutReceipt.
2. AP2 receipt `reference` binding against supplied closed-mandate serializations or explicit closed-mandate hashes.
3. VI SD-JWT parsing for L1, L2, L3 payment, and L3 checkout credentials.
4. ES256 signature checks. L1 uses caller-supplied trusted issuer keys. L2 uses the user key from L1 `cnf.jwk`. L3 uses the agent key delegated in L2 open mandates.
5. `sd_hash` checks from L2 to L1 and from L3 to the supplied parent presentation.
6. Disclosure digest checks against `_sd` and `delegate_payload`.
7. Autonomous-mode delegation checks: open checkout and open payment mandates must bind the same agent key.
8. Final checkout/payment binding: CheckoutMandate `checkout_hash` must match `checkout_jwt`, and PaymentMandate `transaction_id` must match the checkout hash.

The default signature policy is `require`. Missing keys or invalid signatures fail the evidence result, but the function still returns normally per the degradation contract. Callers that only want structural triage can pass `signaturePolicy: "best-effort"`.

**Alternatives considered.**

- _Extend `detectTransaction()` to decode and verify VI/AP2 evidence._ Rejected. It would put issuer-key lookup, JOSE parsing, and dispute-grade error reporting on the middleware critical path.
- _Add a new package for AP2 / VI._ Rejected. The work is verifier-side evidence checking, and `@atrib/verify` already owns merchant and auditor verification surfaces.
- _Treat VI as WebAuthn-specific evidence._ Rejected. Verifiable Intent may be bootstrapped by FIDO credentials, but the AP2-visible evidence format is an SD-JWT mandate chain.
- _Only check AP2 receipts and leave VI for a future adapter._ Rejected. That would leave the authorization half of AP2 unmodeled and repeat the [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) split without closing it.

**Consequences.**

- `@atrib/agent` stays conservative: AP2 mandates remain authorization evidence, not transaction close signals.
- `@atrib/verify` gains a first AP2 / VI evidence surface without changing settlement calculation or graph derivation.
- AP2 / VI fixtures under `packages/agent/test/fixtures/ap2/` now include signed VI immediate evidence and an autonomous split-agent failure case.
- `@atrib/verify` tests cover signed immediate evidence, autonomous `cnf.jwk` mismatch rejection, and malformed-evidence degradation.
- `@atrib/integration` adds an AP2 / VI e2e test that runs `detectTransaction()` and `verifyAp2ViEvidence()` together, proving the detector and verifier paths compose without coupling them.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), the detector boundary this ADR extends.
- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402), AP2 transaction hook and verifier evidence guidance.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), `@atrib/verify` AP2 / VI evidence surface.
- [D052](#d052-cross-attestation-requirement-for-transaction-records), transaction records still require multiple signers.

---

## D090: AP2 receipt JWT verification uses jose in @atrib/verify

**Date:** 2026-05-27

**Supersedes:** P028, removed from Pending decisions when this ADR codified the decision.

**Context.** [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) kept AP2 receipt JWT decoding out of `detectTransaction()`. [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify) added verifier-side AP2 / VI evidence checks, but the first implementation accepted decoded receipt objects only. That left signed AP2 receipt JWTs in a split state: `@atrib/agent` could detect their presence as a transaction signal, while `@atrib/verify` could not yet verify their issuer signature or extract their payload.

**Decision.** Add `verifyAp2ViEvidenceAsync()` to `@atrib/verify` for compact AP2 receipt JWT verification. The existing synchronous `verifyAp2ViEvidence()` remains the decoded-object path. The async path verifies signed CheckoutReceipt and PaymentReceipt JWTs with `jose`, then feeds the decoded payload into the same AP2 receipt checks from [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify).

Receipt JWT verification accepts caller-supplied trust roots through `receiptJwtIssuers`. Each issuer can provide:

1. local `jwks` keys;
2. a `jwksUrl`;
3. a verifier `metadataUrl` whose JSON carries inline `jwks` or a `jwks_uri`.

The verifier enforces ES256, issuer matching when `issuer` is configured, optional audience matching, AP2 receipt required fields, and `reference` binding to the closed mandate serialization or explicit closed-mandate hash. The default `receiptJwtPolicy` is `require`, so invalid receipt JWTs make `valid` false. `receiptJwtPolicy: "best-effort"` converts receipt JWT failures to warnings for callers that already have decoded receipt objects and only want advisory signature status.

**Alternatives considered.**

- _Change `verifyAp2ViEvidence()` to become async._ Rejected. Existing callers and tests use the synchronous decoded-object verifier. A separate async function keeps the hot local path stable and names the network-capable path clearly.
- _Keep using Node crypto directly for receipt JWTs._ Rejected. `jose` already handles compact JWT parsing, JOSE header validation, JWKS key selection, remote JWKS, claim checks, and ES256 verification. Reimplementing that surface would create avoidable protocol drift.
- _Allow untrusted issuer discovery from the JWT `iss` claim alone._ Rejected. The verifier must start from a caller-supplied trust root. A signed receipt from an unknown issuer is still untrusted.

**Consequences.**

- `@atrib/verify` now declares `jose` as a direct dependency.
- AP2 receipt JWT verification remains off the transaction detector path.
- `verifyAp2ViEvidenceAsync()` can verify local JWKS keys and verifier metadata with inline `jwks` or `jwks_uri`.
- The result shape now carries optional per-receipt `jwt` status: `verified`, `issuer`, `kid`, `alg`, `jwksSource`, and an error code when verification fails.
- Tests cover successful local JWKS verification, verifier metadata resolution, `jwks_uri` resolution, wrong-key rejection, audience mismatch, expiry, tampered payloads, and best-effort decoded receipt fallback.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 receipt detection boundary.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), decoded-object AP2 / VI evidence checks.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), updated verifier surface.

---

## D091: AP2 / VI SD-JWT conformance uses OpenWallet sd-jwt-js

**Date:** 2026-05-28

**Supersedes:** P029, removed from Pending decisions when this ADR codified the decision.

**Context.** [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify) shipped a deliberately small Verifiable Intent parser inside `@atrib/verify`. It parsed compact SD-JWT strings, checked ES256 signatures, checked AP2 `sd_hash` and disclosure links, and validated the AP2 mandate chain. That was enough for local AP2 evidence checks, but it was not a credible long-term SD-JWT / SD-JWT VC conformance surface.

The P029 audit called for a vetted SD-JWT implementation inside `@atrib/verify`, while preserving [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt)'s boundary: `@atrib/agent` detects AP2 receipts by shape, and verifier-side evidence checks stay off the middleware critical path.

**Decision.** `@atrib/verify` now uses OpenWallet Foundation `sd-jwt-js` packages for async AP2 / Verifiable Intent credential conformance:

1. `@sd-jwt/core` for issuer-signed SD-JWT verification.
2. `@sd-jwt/sd-jwt-vc` for SD-JWT VC profile verification.

The synchronous `verifyAp2ViEvidence()` path remains the decoded-object verifier from [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify). The async `verifyAp2ViEvidenceAsync()` path now performs AP2 receipt JWT verification from [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), then verifies VI credentials with the SD-JWT library. Each VI credential result carries `sdJwtConformance: { status, profile, reason? }`.

The default `sdJwtConformancePolicy` is `require`. Invalid SD-JWT / VC conformance makes the evidence result invalid. Callers can pass `sdJwtConformancePolicy: "best-effort"` to treat conformance failures as warnings, or `"off"` to skip the async conformance layer.

The default conformance profile is `sd-jwt-vc`. Callers may pass `sdJwtConformanceProfile: "sd-jwt"` to run the core SD-JWT profile instead.

`sdJwtVc.loadTypeMetadata` is opt-in. The verifier does not make implicit VCT metadata or status-list network calls. Callers that need VC type metadata or status checks must supply `sdJwtVc.vctFetcher` or `sdJwtVc.statusListFetcher`; otherwise those checks fail under `require` and warn under `best-effort`.

**Important implementation boundary.** OpenWallet `sd-jwt-js` verifies signatures and registered time claims, and can unpack claims, but it does not fail merely because a presented disclosure is unmatched by the issuer payload. AP2 / VI verification treats that as invalid evidence. `@atrib/verify` therefore keeps the AP2-side disclosure digest reference guard (`_sd` or `delegate_payload`) as part of conformance instead of delegating the entire evidence decision to the library.

**Alternatives considered.**

- _Keep the local parser as the only conformance layer._ Rejected. Local parsing is useful for AP2-specific evidence extraction, but maintaining the whole SD-JWT / SD-JWT VC surface by hand would create protocol drift.
- _Move SD-JWT verification into `detectTransaction()`._ Rejected. It would put issuer-key lookup, SD-JWT parsing, VC status checks, and failure reporting on the middleware path that [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) intentionally kept shape-only.
- _Let the SD-JWT library make default network calls for VC status and VCT metadata._ Rejected. Verifier callers should supply trust roots and fetchers explicitly. Hidden network fetches would be surprising and harder to test.
- _Replace AP2-specific digest and mandate checks with the library result._ Rejected. AP2 uses profile-specific fields such as `delegate_payload`, checkout/payment hash binding, and delegated `cnf.jwk` chains. Those checks remain atrib verifier responsibilities.

**Consequences.**

- `@atrib/verify` declares `@sd-jwt/core` and `@sd-jwt/sd-jwt-vc` as direct dependencies.
- `verifyAp2ViEvidenceAsync()` now verifies VI SD-JWT / VC credentials by default when VI credentials are present.
- `verifyAp2ViEvidence()` remains synchronous and marks `sdJwtConformance` as `not_checked` with reason `async_required`.
- `@atrib/integration` runs AP2 receipt detection plus async AP2 / VI evidence verification across the package boundary.
- [D092](#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence) adds the next verifier layer: typed AP2 mandate constraint evaluation.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 receipt detection boundary.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), first AP2 / VI evidence checker.
- [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), AP2 receipt JWT verification.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), updated AP2 / VI verifier surface.

---

## D092: AP2 / VI mandate constraints are typed verifier evidence

**Date:** 2026-05-28

**Supersedes:** P030, removed from Pending decisions when this ADR codified the decision.

**Context.** [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js) made AP2 / Verifiable Intent credential conformance credible, but it still did not answer whether an autonomous purchase stayed inside the user's disclosed mandate constraints.

AP2 v0.2 defines typed constraints on open Checkout Mandates and Payment Mandates. Checkout constraints cover allowed merchants and line items. Payment constraints cover amount range, allowed payees, allowed payment instruments, allowed PISPs, recurrence, budget, reference, and execution date. These are verifier-side evidence checks. They do not change graph derivation or settlement calculation.

**Decision.** `@atrib/verify` now includes typed AP2 / VI constraint evaluation.

1. `evaluateAp2ViConstraints()` is exported for direct use with decoded mandate material.
2. `verifyAp2ViEvidence()` runs the evaluator after parsing VI credentials and stores the result at `vi.constraints`.
3. `constraintPolicy` defaults to `require`. Failed, unresolved, or unsupported disclosed constraints make the evidence result invalid. `constraintPolicy: "best-effort"` turns those findings into warnings. `constraintPolicy: "off"` skips constraint evaluation and returns `status: "not_checked"`.

The first supported AP2 constraint set is deliberately typed:

- `checkout.allowed_merchants`
- `checkout.line_items`
- `payment.amount_range`
- `payment.allowed_payees`
- `payment.allowed_payment_instruments`
- `payment.allowed_pisps`
- `payment.execution_date`

For compatibility with the earlier synthetic fixture naming, the evaluator also accepts the same type names with a leading `mandate.` prefix.

Payment amounts use AP2's integer minor-unit `payment_amount.amount` field. The evaluator does not use floating point totals for payment bounds. Checkout line item evaluation uses a deterministic max-flow check so overlapping acceptable-item sets do not depend on greedy ordering.

The evaluator resolves selectively disclosed `{ "...": digest }` references when the referenced disclosure is present in the submitted VI presentation. Missing target data is reported as `unresolved`, not passed. Unknown constraint types are `unsupported`. Recurrence, budget, and payment reference constraints remain unsupported until the verifier has the needed history and open-checkout hash material.

**Alternatives considered.**

- _Keep constraints out of `@atrib/verify`._ Rejected. AP2's autonomous safety claim depends on deterministic constraint checks, and `@atrib/verify` already owns AP2 evidence evaluation.
- _Introduce a generic policy language now._ Rejected. AP2 already defines typed fields with payment-specific semantics. A generic layer would add abstraction before the first concrete checks are stable.
- _Treat missing constraint evidence as pass._ Rejected. If the verifier cannot see the final checkout, payment mandate, or disclosed allowed list, it cannot prove the purchase stayed inside the user's bounds.
- _Evaluate all AP2 constraint types immediately._ Rejected. Recurrence and budget need presentation history. Payment reference needs a settled interpretation of the open-checkout mandate hash material. Reporting those cases as unsupported is more honest than guessing.

**Consequences.**

- AP2 autonomous evidence now has a distinct `vi.constraints` block with `status` and per-constraint checks.
- `@atrib/verify` can reject amount, merchant, payee, instrument, PISP, execution-window, and line-item violations without adding AP2-specific graph edges.
- `packages/agent/test/fixtures/ap2/vi_autonomous_constraints_decoded.json` records a deterministic decoded constraint case. [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus) adds the broader signed autonomous fixture corpus and negative matrix.
- `@atrib/integration` keeps the AP2 detector and verifier paths composed while confirming immediate-mode evidence has no open constraints to evaluate.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 receipt detection boundary.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), first AP2 / VI evidence checker.
- [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), SD-JWT / VC conformance layer.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), updated AP2 / VI verifier surface.

---

## D093: AP2 / VI fixtures are the local verifier corpus

**Date:** 2026-05-28

**Supersedes:** P031, removed from Pending decisions when this ADR codified the decision.

**Context.** [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), and [D092](#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence) gave `@atrib/verify` a credible AP2 / VI evidence surface. The remaining gap was fixture quality. The repo had signed immediate evidence, one autonomous split-agent failure, and a decoded constraint case, but not a complete signed autonomous success path or a named negative matrix.

**Decision.** `packages/agent/test/fixtures/ap2/` is the canonical local AP2 / VI evidence corpus for detector and verifier tests.

The corpus now includes:

1. `generate-vi-fixtures.mjs`, a deterministic generator with static test-only P-256 keys.
2. `vi_autonomous_success_evidence.json`, a signed autonomous AP2 / VI success case with L1 issuer credential, L2 open checkout/payment mandates, L3 closed checkout/payment mandates, successful AP2 checkout and payment receipts, final hash bindings, and seven passing typed constraints.
3. `vi_autonomous_negative_matrix.json`, a named mutation matrix applied to the success fixture. It covers tampered L2 signature, tampered L3 signature, disclosure digest mismatch, `sd_hash` mismatch, wrong L3 agent key, wrong checkout hash, wrong transaction id, wrong receipt reference, expired credential, and missing issuer key.

`@atrib/agent`, `@atrib/verify`, and `@atrib/integration` all consume the corpus. The agent test proves detection still fires only on successful AP2 receipts. The verifier tests prove the positive autonomous case and each negative matrix entry. The integration test proves AP2 receipt detection and async AP2 / VI verification compose across package boundaries for immediate and autonomous flows.

**Alternatives considered.**

- _Generate negative fixtures as full duplicated JSON files._ Rejected. Duplicating four compact SD-JWT strings for every negative case makes the corpus hard to audit. A named mutation matrix keeps the base evidence readable while still making each failure case explicit.
- _Keep autonomous negative cases only in test code._ Rejected. The case names and expected verifier failures should live with the AP2 fixture corpus, not be hidden in one test file.
- _Depend on live AP2 services for autonomous coverage._ Rejected for the default path. P034 remains the live interop workstream. The local verifier corpus must stay deterministic.

**Consequences.**

- AP2 / VI local coverage now includes signed immediate success, signed autonomous success, autonomous split-agent failure, decoded constraint replay, and ten named autonomous negative cases.
- Fixture provenance is explicit. Reference-derived AP2 and a2a-x402 examples remain separate from synthetic VI verifier fixtures.
- This is application-level crypto regression coverage, not full cryptographic conformance infrastructure. It exercises real signing, verification, disclosure, hash-binding, JWKS, and SD-JWT / VC libraries through AP2-shaped evidence, but it does not replace pinned adversarial corpora for JOSE, ES256, SD-JWT, JWKS, and clock-boundary behavior.
- Future AP2 verifier work should extend this corpus before adding live interop dependencies.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 receipt detector boundary.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), first AP2 / VI verifier surface.
- [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), SD-JWT / VC conformance layer.
- [D092](#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), mandate constraint evaluation.
- [`packages/agent/test/fixtures/ap2/README.md`](packages/agent/test/fixtures/ap2/README.md), fixture provenance and corpus inventory.

---

## D094: AP2 / VI evidence attaches to verifier results as a tiered block

**Date:** 2026-05-28

**Supersedes:** P032, removed from Pending decisions when this ADR codified the decision.

**Context.** [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), [D092](#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), and [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus) made AP2 / VI evidence verification credible as a standalone checker. The remaining integration gap was the standard verifier path: callers using `verifyRecord()` or `AtribVerifier.verify()` still had to call `verifyAp2ViEvidenceAsync()` separately and stitch the results together themselves.

**Decision.** `@atrib/verify` accepts caller-supplied AP2 / Verifiable Intent evidence in the standard verification APIs and attaches the async evidence result as `ap2_vi_evidence`.

1. `verifyRecord(record, { ap2ViEvidence, ap2ViEvidenceOptions })` runs AP2 / VI evidence verification only for transaction records and stores the result at `result.ap2_vi_evidence`.
2. `AtribVerifier.verify(recommendation, { ap2ViEvidence, ap2ViEvidenceOptions })` runs the same evidence check for the recommendation's transaction and stores the result at `result.ap2_vi_evidence`.
3. Evidence remains tiered. A record can have `valid: true` and `ap2_vi_evidence.valid: false`. The base `valid` bit continues to mean the atrib record or recommendation verified according to its existing signature and calculation rules. AP2 / VI evidence status lives in the evidence block.

The verifier never fetches AP2 / VI evidence implicitly. The caller supplies the bundle because atrib records commit to transaction payload hashes, not full AP2 receipt bodies or VI credential presentations.

**Alternatives considered.**

- _Make AP2 / VI evidence failures flip `verifyRecord().valid`._ Rejected. That would blur record cryptographic validity with external authorization evidence. It would also make AP2 evidence mandatory for every transaction record, including non-AP2 protocols.
- _Keep AP2 / VI evidence as a standalone helper only._ Rejected. The helper remains useful, but verifier callers need one result object that carries both the atrib verification state and the AP2 / VI evidence state.
- _Auto-fetch evidence from receipts or hashes._ Rejected. There is no normative archive for full AP2 / VI evidence yet. Fetching would add network policy, privacy, and trust-root questions to a verifier surface that currently runs on caller-supplied material.

**Consequences.**

- `RecordVerificationResult` and settlement `VerificationResult` now have an optional `ap2_vi_evidence` block.
- `valid`, `signatureOk`, `cross_attestation`, and `calcMatch` semantics remain unchanged.
- `@atrib/verify` tests cover valid AP2 / VI evidence, invalid AP2 / VI evidence that stays tiered from record validity, and recommendation verification with attached AP2 / VI evidence.
- [D098](#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) later codifies that AP2 receipt signatures remain external evidence, not [D052](#d052-cross-attestation-requirement-for-transaction-records) `signers[]`, until an AP2 participant signs the atrib record bytes.

**Cross-references.**

- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 receipt detector boundary.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), decoded AP2 / VI evidence checker.
- [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), AP2 receipt JWT verification.
- [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), SD-JWT / VC conformance layer.
- [D092](#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), mandate constraint evaluation.
- [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus), local AP2 / VI verifier corpus.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), AP2 / VI evidence verifier surface.

---

## D095: AP2 Path 2 content_id uses a stable receipt identity ladder

**Date:** 2026-05-28

**Supersedes:** P033, removed from Pending decisions when this ADR codified the decision.

**Context.** [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) made successful AP2 CheckoutReceipt and PaymentReceipt artifacts the v0.2 transaction signal. Path 2 agent-side transaction emission still derived `content_id` from the MCP server URL plus `"checkout"` for AP2. That fallback works, but it groups distinct AP2 payments served through the same tool endpoint under the same transaction identity.

**Decision.** `@atrib/agent` now lets AP2 detection return a protocol-specific `contentId` when stable AP2 fields are present.

The ladder is:

1. Decoded PaymentReceipt: hash canonical `{ protocol: "AP2", version: 1, source: "payment_receipt", fields: { iss, reference, payment_id, psp_confirmation_id, network_confirmation_id } }`.
2. Compact `payment_receipt` JWT: hash canonical `{ protocol: "AP2", version: 1, source: "payment_receipt_jwt", fields: { jwt_hash } }`, where `jwt_hash` is `sha256:` plus the SHA-256 of the compact JWT string.
3. Decoded CheckoutReceipt: hash canonical `{ protocol: "AP2", version: 1, source: "checkout_receipt", fields: { iss, reference, order_id } }`.
4. Compact `checkout_receipt` JWT: same JWT-hash pattern with `source: "checkout_receipt_jwt"`.
5. Legacy AP2 v0.1 PaymentMandate and legacy VC PaymentMandate fallbacks: hash canonical `{ protocol: "AP2", version: 1, source: "legacy_payment_mandate", fields: { mandate_hash } }`, where `mandate_hash` is the SHA-256 of the canonical mandate object.
6. a2a-x402 successful receipts, reported as AP2 by [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), use `{ protocol: "AP2", version: 1, source: "a2a_x402_receipt", fields: { transaction, network?, payer? } }` when a transaction id is present.

When none of those fields are present, Path 2 keeps the previous generic fallback: MCP server URL plus `"checkout"` for AP2. The detector still does not verify AP2 JWT signatures or decode compact JWTs. It only hashes the compact token string when that is the stable identifier available on the response.

**Alternatives considered.**

- _Always use the MCP server URL fallback._ Rejected. It collapses distinct AP2 payments through one endpoint.
- _Decode compact receipt JWTs in `detectTransaction()`._ Rejected. [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt) keeps decoding and signature checks in `@atrib/verify`, off the detector path.
- _Use raw receipt fields directly in the signed record._ Rejected. The signed record needs only the `content_id` commitment. Full AP2 receipt bodies belong in caller-supplied verifier evidence per [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block).

**Consequences.**

- Two agents that observe the same decoded AP2 receipt derive the same Path 2 transaction `content_id` when the receipt exposes the same stable fields.
- Distinct payment receipts no longer collapse to one AP2 `content_id` merely because they came from the same MCP server URL.
- `TransactionDetection` now carries optional `contentId`. Existing generic fallback behavior remains unchanged for ACP, UCP, x402, MPP, heuristic detection, and AP2 responses without stable identity fields.
- Tests cover decoded AP2 receipts, compact receipt JWTs, legacy PaymentMandate fallback, middleware Path 2 emission using the AP2-specific `contentId`, and the cross-package AP2 / VI e2e fixture path.

**Cross-references.**

- [§1.2.2](atrib-spec.md#122-content_id-derivation), base `content_id` derivation.
- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402), AP2 detection and identity ladder.
- [§5.4.5](atrib-spec.md#545-transaction-detection), Path 2 transaction emission.
- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), AP2 v0.2 receipt hook.
- [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), verifier-side evidence attachment.

---

## D096: AP2 / VI crypto conformance uses a pinned offline corpus

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P041, removed from Pending decisions when this ADR codified the decision.

**Context.** [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus) made `packages/agent/test/fixtures/ap2/` the local AP2 / Verifiable Intent evidence corpus. That corpus exercises real `jose`, OpenWallet `sd-jwt-js`, and Node ES256 verification paths through AP2-shaped evidence, but it is application-level regression coverage. It did not pin the adversarial crypto edge behavior a verifier boundary needs.

The audit behind P041 called out specific gaps: JOSE `alg` confusion, missing or duplicate `kid`, unsupported JWK metadata, unexpected `crit`, malformed compact JWTs, receipt clock boundaries, metadata precedence, issuer-key cache isolation, duplicate SD-JWT disclosures, duplicate disclosure digest references, unused disclosures, unsupported `_sd_alg`, and VI credential clock boundaries.

**Decision.** Add a pinned, offline AP2 / VI crypto conformance corpus under `spec/conformance/ap2-vi-crypto/` and a reference test at `packages/verify/test/ap2-vi-crypto-conformance.test.ts`.

The corpus is a manifest of named cases. The reference test generates deterministic local P-256 fixture keys from fixed seeds, signs compact AP2 receipt JWTs and VI SD-JWT mutations locally, and fails static-JWKS cases if they attempt network access. Metadata cases may fetch only the URLs named by the case.

The verifier now treats the following as named evidence failures:

- Receipt JWT header failures: unsupported `alg`, unexpected `crit`, missing `kid`, malformed compact JWTs.
- JWKS failures: empty key set, duplicate `kid`, wrong curve, unsupported `alg`, `use`, or `key_ops`.
- Receipt clock failures: future `iat` outside configured skew, plus existing `nbf` / `exp` handling through `jose`.
- Metadata behavior: inline `jwks` takes precedence over `jwks_uri`; issuer key selection is isolated by issuer even when `kid` values collide.
- VI SD-JWT structure failures: duplicate disclosure digests, duplicate `_sd` / `delegate_payload` digest references, unsupported `_sd_alg`, unused disclosures, and future `nbf`.

**Alternatives considered.**

- _Leave coverage inside the AP2 fixture directory._ Rejected. `packages/agent/test/fixtures/ap2/` remains the AP2-shaped evidence corpus. `spec/conformance/ap2-vi-crypto/` is the implementation-independent contract for verifier crypto edge behavior.
- _Depend only on upstream library test suites._ Rejected. `jose` and OpenWallet should own their primitives, but atrib owns how AP2 / VI evidence is admitted, rejected, named, and kept off the detector path.
- _Fetch adversarial vectors at test time._ Rejected. The default CI path must not silently skip if a network fetch fails. External corpus refreshes can be generator work; the committed corpus must run offline.
- _Implement every Wycheproof-style ES256 edge now._ Rejected as too broad for this AP2 / VI increment. [D096](#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus) locks atrib's AP2 verifier boundary; [D101](#d101-substrate-wide-adversarial-conformance-corpus) owns the broader adversarial conformance workstream.

**Consequences.**

- The default package test path now exercises AP2 / VI crypto edge behavior through the same verifier API callers use.
- `verifyAp2ViEvidenceAsync()` reports stable, named failure codes for AP2 receipt JWT and VI SD-JWT edge cases instead of collapsing all local verifier-policy failures into a generic invalid result.
- Network access is explicit in AP2 metadata tests and forbidden in static-JWKS cases.
- [D097](#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness) later codifies live AP2 artifact interop, and [D098](#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) later codifies AP2-to-[D052](#d052-cross-attestation-requirement-for-transaction-records) cross-attestation boundaries. This ADR is offline crypto conformance, not live AP2 interoperability or AP2 cross-attestation.

**Cross-references.**

- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), verifier-side AP2 / VI evidence checks.
- [`spec/conformance/ap2-vi-crypto/README.md`](spec/conformance/ap2-vi-crypto/README.md), corpus scope and reference test.
- [`packages/verify/test/ap2-vi-crypto-conformance.test.ts`](packages/verify/test/ap2-vi-crypto-conformance.test.ts), reference implementation.
- [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), decoded AP2 / VI evidence checks.
- [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), receipt JWT verification.
- [D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), SD-JWT / VC conformance.
- [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus), AP2 / VI fixture corpus.

---

## D097: AP2 live interop uses an opt-in reference artifact harness

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P034, removed from Pending decisions when this ADR codified the decision.

**Context.** The public `google-agentic-commerce/AP2` repository now ships v0.2 schemas, a Python SDK, receipt wrapper code, and runnable sample scenarios. Those samples are the right source for live AP2 interoperability, but their full flows require external credentials, multiple local services, and in some cases a browser or trigger endpoint. Making that a default CI gate would make atrib's offline test path depend on Google API keys and local demo orchestration.

P034 called for a live or containerized AP2 interop harness that runs an AP2 checkout / payment flow, captures receipts and VI credentials, emits an atrib transaction record, and verifies AP2 / VI evidence end to end. The local fixture corpus and [D096](#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus) crypto corpus cover deterministic default CI; they do not prove compatibility with artifacts emitted by the AP2 reference samples.

**Decision.** `@atrib/integration` now owns an opt-in AP2 reference artifact harness.

The harness lives at `packages/integration/src/ap2-live-interop.ts` with a runnable script at `packages/integration/scripts/ap2-live-interop.ts`. It accepts:

- an AP2 result artifact via `ATRIB_AP2_INTEROP_RESULT_JSON`;
- an AP2 / VI evidence bundle via `ATRIB_AP2_INTEROP_EVIDENCE_JSON`;
- optional `ATRIB_AP2_INTEROP_COMMAND`, run before the artifacts are read, so an operator can launch a reference scenario or capture step;
- optional `ATRIB_AP2_INTEROP_NOW_SECONDS` for deterministic verifier clocking;
- optional `ATRIB_AP2_INTEROP_ALLOW_DETECTION_ONLY=1` for smoke checks that intentionally omit VI evidence.

The default path requires both transaction detection and AP2 / VI evidence verification to pass. Detection still uses `detectTransaction()` and stays shape-only. Evidence verification still uses `verifyAp2ViEvidenceAsync()` and stays off the middleware critical path.

**Follow-up update (2026-05-29).** The integration package now includes an official AP2 SDK receipt-artifact path. `packages/integration/scripts/generate-ap2-reference-receipts.py` imports `ap2.sdk.receipt_wrapper.ReceiptClient` and `ap2.sdk.jwt_helper.create_jwt` from a local `google-agentic-commerce/AP2` checkout, mints compact payment and checkout receipt JWTs, verifies them with the AP2 SDK, and writes fixture artifacts under `packages/integration/test/fixtures/ap2-reference/`.

Default CI still does not launch AP2 services or require Google credentials. The new fixture test feeds those AP2 SDK receipt JWTs through `detectTransaction()`, `verifyAp2ViEvidenceAsync()`, and a counterparty-signed atrib transaction record. This proves the artifact contract against the official receipt wrapper while keeping full scenario runs opt-in.

**Second follow-up update (2026-05-29).** The integration package now includes a combined AP2 / Verifiable Intent upstream reference path. `packages/integration/scripts/generate-ap2-vi-reference-evidence.py` imports the official AP2 Python SDK and the public `agent-intent/verifiable-intent` Python reference implementation from local checkouts. It builds L1, L2, and split L3 VI credentials with the VI reference library, verifies the merchant and payment-network chains with the VI verifier, mints compact AP2 receipt JWTs with the AP2 SDK, verifies those receipts with the AP2 receipt client, and writes fixture artifacts under `packages/integration/test/fixtures/ap2-vi-reference/`.

This also tightened `@atrib/verify` around real VI payload shapes. The constraint evaluator now accepts AP2 / VI checkout JWT payloads whose purchased items live under `cart.items[].sku`, and it evaluates `mandate.payment.reference` against the open checkout mandate disclosure digest plus the existing final checkout-payment binding check. Default CI still stays offline and credential-free, but it now tests a fixture generated by upstream AP2 and VI code rather than only atrib-authored VI fixtures.

**Third follow-up update (2026-05-29).** The integration package now includes a Google AP2 sample extractor. `packages/integration/scripts/extract-google-ap2-sample-artifacts.ts` reads captured A2A function-response events from the official human-not-present card sample plus the sample `.temp-db`, extracts the successful `complete_checkout` receipt, reads the full delegated checkout and payment mandate chains, adds the sample merchant public JWK as the AP2 receipt trust root, and emits the same `ap2-result.json`, `ap2-vi-evidence.json`, and `atrib-transaction-record.json` live interop files. The committed fixture uses split JWT and SD-JWT encodings that the extractor rejoins at runtime. Real official sample output can stay in its raw compact form.

This removes the manual step where operators copied compact JWT segments out of full `open~~closed` mandate chains. The AP2 merchant receipt signature remains external evidence. The generated atrib transaction record still uses local Ed25519 agent and counterparty signers unless a real AP2 participant supplies an atrib signer for the same transaction bytes.

**Alternatives considered.**

- _Run the AP2 sample stack in default CI._ Rejected. The Python sample flows require external credentials and long-running services. Default atrib CI must stay offline and deterministic.
- _Add another synthetic fixture and call it interop._ Rejected. Synthetic fixtures are already covered by [D093](#d093-ap2--vi-fixtures-are-the-local-verifier-corpus) and [D096](#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus). P034 is about accepting artifacts from a real AP2 participant or reference run.
- _Hard-code one AP2 sample scenario path._ Rejected. The AP2 repo has card, x402, human-present, human-not-present, Python, Go, and Android samples. An artifact contract composes with all of them and is less fragile than one scenario-specific wrapper.
- _Let the harness verify only detection._ Rejected as the default. Detection-only is allowed for smoke checks, but the P034 end-to-end claim requires AP2 / VI evidence when the full bundle is available.

**Consequences.**

- Default CI now tests the harness contract with fixture artifacts, but does not launch live AP2 services.
- Operators can run `pnpm --filter @atrib/integration ap2-live-interop` after an AP2 sample emits artifacts, or can supply `ATRIB_AP2_INTEROP_COMMAND` to produce those artifacts first.
- Operators can run `pnpm --filter @atrib/integration ap2-google-sample-extract` after the Google sample emits captured A2A events and `.temp-db` files. The extractor writes the standard live interop contract.
- Live AP2 artifacts that drift from atrib's receipt detector or verifier boundary fail with named harness errors: `ap2_transaction_not_detected`, `ap2_vi_evidence_missing`, or `ap2_vi_evidence_invalid`.
- [D098](#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) keeps AP2 receipt signatures as external evidence until an AP2 participant signs the atrib transaction record bytes.

**Cross-references.**

- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402), AP2 receipt detection boundary.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), AP2 / VI evidence verification.
- [D088](#d088-ap2-v02-transaction-hook-is-the-successful-receipt), detector stays receipt-shaped and off crypto work.
- [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), verifier evidence stays tiered.
- [D096](#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus), offline crypto conformance.
- [`packages/integration/test/google-ap2-sample-extract.test.ts`](packages/integration/test/google-ap2-sample-extract.test.ts), Google AP2 sample extraction coverage.

---

## D098: AP2 receipts stay external evidence for cross-attestation

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P035, removed from Pending decisions when this ADR codified the decision.

**Context.** [D052](#d052-cross-attestation-requirement-for-transaction-records) requires transaction records to carry at least two verified `signers[]` entries. Each signer signs the same atrib transaction record bytes: the JCS form with `signers: []` and the top-level `signature` field omitted.

AP2 receipt JWT signatures prove that an AP2 verifier, merchant, or payment party accepted a checkout or payment result under AP2's receipt format. They do not prove that party signed the atrib transaction record. Treating a receipt JWT as a [D052](#d052-cross-attestation-requirement-for-transaction-records) signer would conflate external transaction evidence with atrib co-signing.

The producer-side gap was still real. `@atrib/agent` Path 2 transaction records used the legacy single-signer top-level `signature` field, so [D052](#d052-cross-attestation-requirement-for-transaction-records)-aware verifiers surfaced `signers_count: 0` even when the agent had enough key material to sign the cross-attestation bytes itself.

**Decision.** `@atrib/mcp` now exports `signTransactionRecord(record, privateKey, counterpartySigners?)`.

The helper signs the [D052](#d052-cross-attestation-requirement-for-transaction-records) canonical transaction bytes with the agent's Ed25519 key and returns a transaction-shaped record with:

- `signature: ""`, because the top-level transaction signature is informational when `signers[]` is present;
- `signers[0]` set to the agent's `{ creator_key, signature }`;
- any caller-supplied `counterpartySigners` appended after the agent signer, assuming they already signed the same canonical bytes.

`@atrib/agent` Path 2 transaction emission now uses `signTransactionRecord()` for every protocol, including AP2. For AP2, receipt JWTs and Verifiable Intent credentials remain `ap2_vi_evidence` verifier inputs. They are not converted into `signers[]`.

**Alternatives considered.**

- _Treat AP2 receipt JWT signatures as [D052](#d052-cross-attestation-requirement-for-transaction-records) signers._ Rejected. The signature algorithm, signing input, and semantic claim are different. This would create a false cross-attestation signal.
- _Keep Path 2 on legacy top-level signatures until counterparty signing exists._ Rejected. The agent can already sign the [D052](#d052-cross-attestation-requirement-for-transaction-records) canonical bytes. Emitting a one-signer `signers[]` record is more honest and makes future counterparty merge code smaller.
- _Require live AP2 co-signing now._ Rejected. Current public AP2 receipts do not define an atrib-record co-signing exchange. The first true counterparty signer needs AP2 participant support or a merchant adapter that signs the atrib canonical bytes.

**Consequences.**

- Path 2 transaction records now surface `cross_attestation.signers_count: 1`, `signers_valid: 1`, and `missing: true` until a counterparty signer is supplied.
- Transaction records that use `signers[]` are only base-valid when a signer entry matching the top-level `creator_key` verifies over the [D052](#d052-cross-attestation-requirement-for-transaction-records) bytes. Unrelated valid signers do not validate the creator's record.
- AP2 receipt evidence can make `ap2_vi_evidence.valid: true` while `cross_attestation.missing` remains true. Those are different trust layers.
- Future AP2 or merchant adapters can request a counterparty signature over `canonicalCrossAttestationInput(record)` and pass it into `signTransactionRecord()` without changing verifier semantics.
- [D052](#d052-cross-attestation-requirement-for-transaction-records) remains strict: the verifier does not count receipt JWTs toward the two-signer minimum.

**Cross-references.**

- [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), transaction cross-attestation bytes and signer minimum.
- [§5.4.5](atrib-spec.md#545-transaction-detection), Path 2 agent-side transaction emission.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), AP2 / VI evidence stays verifier-side.
- [D052](#d052-cross-attestation-requirement-for-transaction-records), transaction records require multiple signers.
- [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), AP2 / VI evidence does not alter base record validity.

---

## D099: Explicit emit records commit local content through default args_hash

**Date:** 2026-05-28

**Status:** Accepted

**Context.** The P17 dogfood diagnostic run exposed a bad edge in explicit emits. Two different `atrib-emit-cli` diagnostics signed in the same millisecond with the same context and chain root could produce the same signed record because their semantic content lived only in the local `_local` sidecar. The public record committed to the event kind through `content_id`, but not to the local body. That meant a local mirror could contain two different bodies that pointed at the same `record_hash`. For diagnostic replay, that is not good enough: a downstream agent must be able to check that the body it is using matches the signed evidence.

The same run also exposed a direct-CLI ergonomics gap: when `ATRIB_MIRROR_FILE` was unset, the CLI submitted records but skipped local mirroring. Those records were public-log evidence but not useful to recall, trace, or the P17 corpus builder.

**Decision.** `@atrib/emit` now computes `args_hash = sha256(JCS(content))` when a caller omits `argsHash`. A caller-supplied `argsHash` still wins. Full content remains local in the mirror sidecar; the public record carries only the hash commitment. This keeps `content_id` as the kind identifier from [§1.2.2](atrib-spec.md#122-content_id), while using the existing [§8.3](atrib-spec.md#83-salted-commitment-posture) commitment field to bind the signed record to the local body.

Direct `atrib-emit-cli` also defaults its mirror path to `~/.atrib/records/atrib-emit-${ATRIB_AGENT:-claude-code}.jsonl` when `ATRIB_MIRROR_FILE` is unset. Operators can still override the path explicitly.

**Alternatives considered.**

- _Change `content_id` to include the body._ Rejected. `content_id` identifies the action kind. Making it body-specific would break the existing grouping semantics for observations, annotations, revisions, and tool calls.
- _Put `content` directly in the signed record._ Rejected. The public log is commitment-first. Many explicit emits carry private reasoning, file paths, or customer context that should stay in the local mirror or a future archive layer.
- _Require every caller to pass `argsHash`._ Rejected. The CLI and MCP tool are used by agents and hooks. The safe default should be body commitment, with explicit override for callers that already have a salted or precomputed commitment.
- _Rely on timestamp uniqueness._ Rejected. The observed failure happened precisely because two emits could share timestamp, context, event kind, and chain root.
- _Only fix the mirror default._ Rejected. Mirroring preserves bodies, but it does not make those bodies replay-checkable against the signed record.

**Consequences.**

- Same-millisecond explicit emits with different local bodies no longer collapse to the same signed record.
- P17 diagnostic rows can check local body replay by comparing `sha256(JCS(_local.content))` with `record.args_hash`.
- Existing records without `args_hash` remain valid, but they are weaker diagnostic evidence because the local body is sidecar-only.
- The byte-identical transport claim still holds: MCP-server and CLI emits with the same input produce the same canonical record fields.
- Direct CLI use becomes useful to recall and trace by default because local mirroring no longer depends on an env var.

**Cross-references.**

- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), local sidecar persistence.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), explicit cognitive primitives.
- [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), CLI distribution.
- [D087](#d087-signed-diagnostic-outcome--causal-trace-replay), signed diagnostic outcome and replay.
- [§1.2.2](atrib-spec.md#122-content_id), `content_id`.
- [§8.3](atrib-spec.md#83-salted-commitment-posture), content commitments.

---

## D100: MCP middleware can sign without log submission

**Date:** 2026-05-28

**Status:** Accepted

**Context.** `@atrib/mcp` used a missing `logEndpoint` to mean "use the public atrib log." That default is correct for normal middleware hosts, but it creates a bad test and local-mirror edge: a host may want records signed and persisted through `onRecord` while refusing outbound log writes. The Cloudflare approval-trace Worker test hit this edge. Its direct helper treated an empty `ATRIB_LOG_ENDPOINT` as no log, while the middleware converted the same absence into the production default. CI then depended on remote network timing while it was supposed to be an offline Worker proof.

**Decision.** `@atrib/mcp` now accepts `logSubmission: 'disabled'`. In that mode, the middleware still signs successful tool calls, writes outbound atrib context, updates autoChain state, and invokes `onRecord`. It swaps the submission queue for a no-op queue: `submit()` does nothing, `flush()` resolves, and `getProof()` returns `undefined`.

The default remains `logSubmission: 'enabled'`, and `logEndpoint` keeps its existing default of `https://log.atrib.dev/v1/entries` when submission is enabled.

**Alternatives considered.**

- _Treat an empty `logEndpoint` string as disabled._ Rejected. It overloads a malformed URL with a policy choice and makes configuration mistakes harder to see.
- _Keep tests on the public log and only raise timeouts._ Rejected. Offline tests should not depend on public network writes. A timeout bump would hide the wrong dependency.
- _Add a worker-local fake log endpoint for the Cloudflare test._ Rejected after verification. Durable Object outbound fetches to the test hostname did not route back through the Worker in Miniflare, so this still produced remote fetch failures.
- _Disable attribution entirely in tests by omitting `creatorKey`._ Rejected. The test's point is to verify signatures, context, and local mirror records.

**Consequences.**

- Offline test suites can exercise signing and local mirror behavior without public-log traffic.
- Local-mirror-only hosts have an explicit configuration for private or staged environments.
- `getProof()` remains empty in no-log mode. Verifiers that need inclusion proofs must run with submission enabled or attach proof bundles from another log path.
- Existing integrations are unchanged unless they opt into `logSubmission: 'disabled'`.

**Cross-references.**

- [§5.3.1](atrib-spec.md#531-server-side-middleware-for-mcp-servers), MCP middleware init options.
- [§5.3.5](atrib-spec.md#535-log-submission), non-blocking log submission.
- [§5.8](atrib-spec.md#58-degradation-contract), failures must not affect the primary tool path.
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), local sidecar persistence.

---

## D101: Substrate-wide adversarial conformance corpus

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P020, removed from Pending decisions when this ADR codified the decision.

**Context.** P020 captured a real gap in the substrate-correctness story. atrib had strong per-feature tests and several spec corpora, but the adversarial surface was split across local unit tests, a live Wycheproof fetch that skipped when the network was unavailable, and endpoint-specific graph fixtures. A third-party implementer could not replay one clear corpus that covered edge derivation, malformed signed inputs, multi-producer chain races, and cross-attestation boundary cases.

**Decision.** Promote P020 into a substrate-wide conformance workstream with four shipped surfaces.

First, add a full [§3.2.4](atrib-spec.md#324-edge-derivation-rules) graph corpus at `spec/conformance/3.2.4/`, generated by `packages/log-dev/scripts/generate-conformance-3.2.4.ts` and consumed by `services/graph-node/test/conformance-3.2.4.test.ts`. It pins exact edge sets for all nine edge types, full pairwise SESSION_PRECEDES, full pairwise SESSION_PARALLEL, and dangling producer-declared references. Add `services/graph-node/test/edge-derivation-properties.test.ts` for generated property checks over ordered records, equal timestamps, linear chains, compact mode, and input-order invariance.

Second, add `spec/conformance/1.4/adversarial-vectors.json`, generated by `packages/log-dev/scripts/generate-conformance-1.4-adversarial.ts` and consumed by `packages/mcp/test/signing-adversarial-corpus.test.ts`. The vectors pin bit-flipped signatures, truncated signatures, wrong creator keys, malformed context IDs, invalid event_type URIs, and JCS optional-field ordering. The live Wycheproof Ed25519 fetch remains an upstream compatibility check, but this offline corpus is the CI floor.

Third, extend the [D067](#d067-multi-producer-chain-composition-precedence-contract) corpus with explicit race vectors for conflicting inbound, autoChain, env, and mirror tails. The resolver contract remains unchanged. The new cases make stale-tail precedence replayable.

Fourth, extend the [D052](#d052-cross-attestation-requirement-for-transaction-records) corpus with `creator-signer-missing`: two counterparty signatures verify over the cross-attestation bytes, but no signer entry matches the top-level `creator_key`. The verifier must report `cross_attestation.missing: false` while rejecting the record's base creator-signature path.

**Alternatives considered.**

- _Rely on unit tests._ Rejected. Unit tests catch local regressions, but they do not give external implementations a replayable spec artifact.
- _Keep the live Wycheproof fetch as the only adversarial signing gate._ Rejected. It is useful, but it can skip under network failure and does not cover atrib record-shape adversaries.
- _Hand-author the new JSON files._ Rejected. The corpus must be reproducible from fixed seeds and timestamps. Generators make drift obvious.
- _Bundle the compact graph corpus into [§3.2.4](atrib-spec.md#324-edge-derivation-rules)._ Rejected. Compact intra-session edges are a response optimization for [§3.4.1](atrib-spec.md#341-get-v1graphcontext_id); full [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation needs its own corpus.

**Consequences.**

- A third-party verifier or graph service can replay the substrate corpus without depending on atrib's TypeScript tests.
- P020 is retired from Pending decisions. Future corpus additions extend [D101](#d101-substrate-wide-adversarial-conformance-corpus) unless they change a normative rule enough to warrant their own ADR.
- The corpus is adversarial, not exhaustive. New malformed-record, edge-derivation, or cross-attestation cases should be added when a bug or new rule exposes them.
- `@atrib/graph-node` now declares `fast-check` as a dev dependency for property-based edge tests.

**Cross-references.**

- [§1.4](atrib-spec.md#14-signing-and-verification), signing and verification.
- [§3.2.4](atrib-spec.md#324-edge-derivation-rules), graph edge derivation.
- [§1.2.3.1](atrib-spec.md#1231-multi-producer-chain-composition), multi-producer chain-root precedence.
- [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), transaction cross-attestation.
- [`spec/conformance/1.4/`](spec/conformance/1.4/), signing and adversarial vectors.
- [`spec/conformance/3.2.4/`](spec/conformance/3.2.4/), full edge derivation corpus.

---

## D102: Sandboxed signer proxy keeps keys outside sandbox

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P014 and P015, removed from Pending decisions when this ADR codified the decision.

**Context.** P014 and P015 captured the same security boundary from two angles. P015 was the normative rule: a producer signing records for sandboxed agent code must not place the Ed25519 private key inside that sandbox. P014 was the runtime pattern: sandboxed code asks a host signer proxy to sign, while the signer holds key material outside the sandbox. The Anthropic Claude Code sandboxing architecture uses the same credential separation shape for git credentials and signing keys. atrib needs that boundary because a record signed by a sandbox-held key still verifies even if prompt-injected code produced it.

**Decision.** Add [§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution): when a producer signs records for an agent running inside a sandboxed execution environment, the private key MUST NOT be reachable from that sandbox. The producer MUST hold the key in a host signer process, host service, HSM, secure enclave, or equivalent boundary outside the sandbox. The sandbox may send unsigned record requests and sidecar context. The host signer controls `creator_key`, `signature`, and the local `signers[]` entry for transaction records; performs canonicalization and signing itself; runs host policy before signing; optionally submits to the log; and returns the signed record or `record_hash`.

Add [§9.7](atrib-spec.md#97-pattern-sandboxed-execution-signer-proxy) as the informative runtime integration pattern for this rule. The pattern is now Pattern #7 because it is the next shipped documented pattern. P012 and P013 remain pending and will take later numbers when acted on.

Ship a tested reference example in `@atrib/integration`: `packages/integration/src/signer-proxy-example.ts`, `packages/integration/examples/signer-proxy/`, and `packages/integration/test/signer-proxy.test.ts`. The test proves the sandbox client does not hold a private key, the host signer rejects sandbox-supplied signer-controlled fields, host policy runs before signing, and the resulting record verifies with normal `@atrib/mcp` verification.

**Alternatives considered.**

- _Keep keys inside the sandbox and rely on filesystem isolation._ Rejected. If the sandbox can read or call the key directly, prompt-injected code can mint records that verify under the agent key without crossing a host policy boundary.
- _Let the sandbox canonicalize and send bytes to be signed._ Rejected for the reference pattern. The host signer must own canonicalization so the sandbox cannot smuggle a different record shape than the one the host reviewed.
- _Make this only informative._ Rejected. The key-location rule is a producer-side security invariant for sandboxed execution, so [§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) is normative.
- _Require a specific proxy transport._ Rejected. Unix socket, stdio, loopback HTTP, HSM API, and enclave calls can all satisfy the same boundary if the sandbox cannot reach key material directly.

**Consequences.**

- Existing non-sandboxed producers are unchanged. They may continue to hold the key in process under their own host threat model.
- Any future atrib producer that signs on behalf of sandboxed agent code must satisfy [§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution).
- The signer proxy does not certify truth. It prevents direct key access and gives the host a policy gate before signing. Verifiers still assess signed records under the broader [§8.7](atrib-spec.md#87-adversarial-threat-model) stack.
- P014 and P015 are retired from Pending decisions. Future sandbox work extends [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) unless it changes the normative key-isolation rule.

**Cross-references.**

- [§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution), signing key isolation for sandboxed execution.
- [§9.7](atrib-spec.md#97-pattern-sandboxed-execution-signer-proxy), sandboxed-execution signer proxy pattern.
- [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), transaction cross-attestation bytes.
- [`packages/integration/examples/signer-proxy/`](packages/integration/examples/signer-proxy/), runnable signer-proxy example.
- [`packages/integration/test/signer-proxy.test.ts`](packages/integration/test/signer-proxy.test.ts), reference test surface.

---

## D103: Log subscriptions use SSE plus JSON Feed over commitment-visible fields

**Date:** 2026-05-28

**Status:** Accepted

**Supersedes:** P023, removed from Pending decisions when this ADR codified the decision.

**Context.** Always-on consumers need a low-latency way to react to new public log entries. Polling `/v1/stats` and then walking tiles or `/v1/recent` is wasteful for notification routers, cross-agent subscribers, and cognitive runtimes that only care about a narrow creator, context, or event type. P023 proposed Server-Sent Events as the primary surface and JSON Feed as the pull companion.

The log stores 90-byte commitment entries, not signed record bodies. That means log-node can filter by fields encoded in the entry: `creator_key`, `context_id`, `event_type`, `timestamp_ms`, and `log_index`. It cannot filter by annotation `topic` or `importance` without consulting record bodies, producer mirrors, or a Record Body Archive Layer.

**Decision.** Add [§2.5.6](atrib-spec.md#256-log-subscription-surfaces-optional): log implementations MAY expose `/v1/stream` and `/v1/feed.json` as optional subscription surfaces over decoded log entries.

`/v1/stream` is the primary push surface. It uses Server-Sent Events with `event: ready` followed by `event: log_entry` messages. Each `log_entry` event carries `{ tree_size, entry }`, where `entry` is the same compact decoded entry shape used by `/v1/recent`.

`/v1/feed.json` is the pull companion. It returns JSON Feed 1.1 with one item per decoded log entry. Each item carries a stable `id` equal to the `record_hash`, a `/v1/lookup/<hash>` URL, a timestamp, a readable title, and an `_atrib` extension object containing the decoded entry.

The first implementation supports these filters on both surfaces:

- `creator_key`: exact base64url Ed25519 public key match.
- `context_id`: exact 32-hex session anchor match.
- `event_type`: decoded label (`tool_call`, `transaction`, `observation`, `directory_anchor`, `annotation`, `revision`, `extension`, `reserved`) or atrib normative event_type URI.
- `since`: millisecond timestamp or ISO timestamp. Boundary is inclusive.

The first implementation rejects `topic` and `importance` with `400 Bad Request` because those filters require record-body indexing. Rejecting is deliberate. Silent ignore would make downstream notification code believe server-side filtering happened when it did not.

**Alternatives considered.**

- _Polling only._ Rejected. It wastes client and server work for always-on consumers and adds avoidable latency.
- _WebSocket primary._ Rejected. The log only needs one-way delivery. SSE is HTTP-native, proxy-friendly, and easier for scripts.
- _Webhooks first._ Rejected. They require every consumer to host a public endpoint. They can come later for managed consumers.
- _Accept `topic` and `importance` now by best-effort body fetch._ Rejected. The log is intentionally commitment-only. Body-aware filtering belongs in a separate index or archive-backed service.
- _Make subscriptions normative._ Rejected for v1. Verification does not depend on push delivery. The surfaces are optional read conveniences.

**Consequences.**

- The public log can support live activity consumers without forcing them into polling loops.
- Server-side filtering is honest about the commitment-only boundary.
- JSON Feed gives cron and desktop consumers a simple fallback when they cannot hold a long-lived SSE connection.
- Future body-aware subscription work should extend [D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields) only after a body index or Record Body Archive Layer exists.

**Cross-references.**

- [§2.5.6](atrib-spec.md#256-log-subscription-surfaces-optional), log subscription surfaces.
- [`services/log-node/src/server.ts`](services/log-node/src/server.ts), reference implementation.
- [`services/log-node/test/server.test.ts`](services/log-node/test/server.test.ts), SSE and JSON Feed tests.
- [`services/log-node/README.md`](services/log-node/README.md), operator API documentation.

---

## D104: Parent-child threading uses ATRIB_PARENT_RECORD_HASH

**Date:** 2026-05-29

**Status:** Accepted

**Supersedes:** P025, removed from Pending decisions when this ADR codified the decision.

**Context.** When a parent agent dispatches a child agent, the parent usually has a signed spawn record: a Task tool call, framework handoff, worker-node launch, or similar record. The child then signs its own records. Without an explicit link, parent and child records appear as flat peers, especially when both processes use the same `creator_key`. P025 tracked two options: a producer-side `informed_by` convention, or promotion of [D073](#d073-handoff-event_type-byte-placeholder-adr) into a dedicated `handoff` event_type with new graph rules.

**Decision.** Ship the producer-side convention first. A parent producer that has the signed parent/spawn `record_hash` MAY set `ATRIB_PARENT_RECORD_HASH=<sha256:...>` in the child producer's environment before the child signs. Child producers that support the convention validate the env value as a canonical [§1.2.5](atrib-spec.md#125-informed_by) record hash and add it to `informed_by`.

`@atrib/mcp` reads the env value at middleware initialization. If valid, it seeds the first successful wrapper-signed record's `informed_by`. Failed tool calls do not consume the seed. The middleware merges the seed with the `informedBy` callback and `autoDetectInformedByFromArgs`, dedupes, and signs the lexicographically sorted set.

`@atrib/emit` uses the same helper and keeps its stateless per-emit behavior: when the env value is valid, each explicit emit call prepends it to caller-provided `informed_by` before signing. This matches short-lived `atrib-emit-cli` hook producers. Long-lived `atrib-emit` operators that need one-shot behavior should unset the env value after the first child record or rely on the wrapper-signed first record.

[D073](#d073-handoff-event_type-byte-placeholder-adr) remains a placeholder. This ADR does not promote a new event_type byte, a new graph edge type, or new signed record fields. The graph edge is the existing INFORMED_BY edge.

**Alternatives considered.**

- _Do nothing until a dedicated handoff event exists._ Rejected. Same-key parent-child traces are disconnected today, and `informed_by` already represents the needed causality.
- _Promote [D073](#d073-handoff-event_type-byte-placeholder-adr) immediately._ Rejected. The bar in [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) requires a producer that depends on the type plus a conformance surface. Current evidence supports the cheaper convention, not a new normative event type.
- _Use `chain_root` for parent-child relationships._ Rejected. `chain_root` is the structural predecessor in a record chain. `informed_by` is the field for "this prior record informed this action."
- _Make every child record cite the parent._ Rejected for middleware records. Citing the parent on the first successful child record is enough for trace traversal, and repeated citations add graph noise. `@atrib/emit` remains stateless because the CLI path signs one record per process.

**Consequences.**

- Parent-child trace traversal works without changing the wire format. Walking backward from the first child record reaches the parent spawn record through INFORMED_BY, then continues through the parent's chain.
- Same-identity parent and child processes still get a structural relationship even when `creator_key` cannot distinguish them.
- This is a producer convention, not proof that a human-meaningful child agent existed. Verifiers should treat it as signed lineage metadata, subject to the broader [§8.7](atrib-spec.md#87-adversarial-threat-model) stack.
- Runtimes where the parent record hash is not available before the child signs still need a later annotation, a framework-native `informed_by` point, or a future [D073](#d073-handoff-event_type-byte-placeholder-adr) promotion.
- P025 is retired from Pending decisions. Future explicit handoff work should extend [D073](#d073-handoff-event_type-byte-placeholder-adr), not reopen the baseline parent-hash convention.

**Cross-references.**

- [§1.2.5](atrib-spec.md#125-informed_by), existing parent-child link field.
- [§9.8](atrib-spec.md#98-composing-patterns), runtime composition notes for `ATRIB_PARENT_RECORD_HASH`.
- [`packages/mcp/src/refs.ts`](packages/mcp/src/refs.ts), shared env validation helper.
- [`packages/mcp/test/middleware.test.ts`](packages/mcp/test/middleware.test.ts), one-shot middleware seed coverage.
- [`services/atrib-emit/test/emit.test.ts`](services/atrib-emit/test/emit.test.ts), explicit emit env coverage.
- [D073](#d073-handoff-event_type-byte-placeholder-adr), future explicit handoff event placeholder.

---

## D105: Pattern 3 handoff claims use verifier-side claim acceptance

**Date:** 2026-05-29

**Status:** Accepted

**Extends:** [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion), [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), and [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash).

**Context.** [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash) solved the producer-side parent-child case: when a parent has a prior record hash before a child signs, the child can cite that hash through `informed_by`. Pattern 3 multi-agent flows need the receiving side too. Agent B may receive a `record_hash` claim, a signed record, private body material, and an inclusion proof from Agent A. Before Agent B acts, it needs a small deterministic acceptance step: verify the evidence, reject bad claims, and only then use accepted hashes in its own `informed_by`.

[D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion) says new primitives start as extensions until routine use and cognitive distinctness are proven in real work. [D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) first shipped as that extension. [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) later promoted the operation after two independent receiving flows needed verification before linking.

**Decision.** Ship `verifyHandoffClaims()` in `@atrib/verify` as the verifier-side Pattern 3 acceptance helper. A caller supplies one or more claims containing:

- `record_hash`, the claimed `sha256:<64hex>` record hash.
- `record`, the signed `AtribRecord` when available.
- `body`, `args`, or `result` material when the receiving agent needs private evidence replay.
- `proof`, a log proof bundle when available.
- A trust set (`trusted_creator_keys`), freshness bounds, and an optional log public key.

For each claim, the helper verifies:

- The supplied record hashes to the claimed `record_hash`.
- `verifyRecord()` accepts the record signature and canonical record shape.
- The signer is in the supplied trust set when a trust set is provided.
- The record timestamp is within the caller's freshness bound when one is provided.
- Supplied body material matches the record's `args_hash` or `result_hash` commitment when required.
- A supplied proof binds to the serialized log entry for that exact record, verifies its RFC 6962 inclusion path, and verifies the C2SP signed-note checkpoint signature when the caller supplies `log_public_key`.

The result splits claims into `accepted` and `rejected` arrays and exposes `accepted_record_hashes` for the receiving agent to pass into its next signed record's `informed_by`. Rejection reasons are named (`record_missing`, `record_hash_mismatch`, `signature_invalid`, `wrong_signer`, `stale`, `body_hash_mismatch`, `proof_invalid`, etc.) so callers can explain why a handoff was refused.

This is a verifier helper, not a new record type. It does not add graph edge types, does not promote [D073](#d073-handoff-event_type-byte-placeholder-adr), does not fetch private bodies on its own, and does not change settlement calculation. The caller remains responsible for obtaining records, private body material, and proof bundles from a local mirror, archive, private handoff packet, log lookup, or other trusted channel.

**Follow-up update.** The caller-supplied helper now has a packet adapter, `handoffClaimsFromEvidencePacket()`, that accepts [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror envelopes, private continuation packets, and required hash lists. It preserves missing records as verifier rejections, carries `_local.content` / `_local.args` / `_local.result` into body checks, and supports context allow-lists through `allowed_context_ids`. The tests now cover wrong context, missing body, missing proof, and packet-driven Agent B follow-up.

**P022 posture.** P022 was promoted by [D106](#d106-verify-is-promoted-to-cognitive-primitive-7). The extension remains the library layer; `@atrib/verify-mcp` is the agent-facing wrapper.

**Alternatives considered.**

- _Promote `@atrib/verify-mcp` immediately in the first [D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) pass._ Rejected then. That would have skipped [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion)'s extension-first rule. [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) accepts promotion only after the second independent flow landed.
- _Fold handoff verification into `atrib-recall` now._ Rejected. Recall reads the local mirror. Pattern 3 acceptance may include private packet material, proof bundles, and trust-set policy that do not belong in recall's baseline read API.
- _Accept `record_hash` references without body or proof checks._ Rejected. That would make `informed_by` easy to spoof with stale or unrelated records. The receiving agent needs an explicit acceptance step.
- _Promote a dedicated `handoff` event_type._ Rejected. The graph relationship is already `INFORMED_BY`. [D073](#d073-handoff-event_type-byte-placeholder-adr) still lacks the producer and conformance evidence required by [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).

**Consequences.**

- Pattern 3 now has a minimal tested receiving path: Agent A signs a claim, Agent B verifies supplied evidence, then Agent B signs a follow-up with `informed_by` pointing at the accepted claim.
- `@atrib/verify` gains a new public API and a minor version changeset.
- The first implementation is intentionally caller-supplied. Remote fetching, archive lookup, local-mirror lookup, and recall integration remain separate adapter work.
- Since proof verification recomputes the expected log leaf from the record's serialized log entry, a valid proof for a different record cannot satisfy the handoff claim.
- P022 is codified by [D106](#d106-verify-is-promoted-to-cognitive-primitive-7) rather than silently absorbed into this helper.

**Cross-references.**

- [§5.5.5](atrib-spec.md#555-handoff-claim-verification), verifier-side handoff claim helper.
- [`packages/verify/src/handoff.ts`](packages/verify/src/handoff.ts), reference implementation.
- [`packages/verify/test/handoff.test.ts`](packages/verify/test/handoff.test.ts), local acceptance and rejection tests.
- [`packages/integration/test/pattern3-handoff.test.ts`](packages/integration/test/pattern3-handoff.test.ts), real-log Pattern 3 e2e.
- [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), verify primitive promotion.
- [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash), producer-side parent-child threading.

---

## D106: Verify is promoted to cognitive primitive #7

**Date:** 2026-05-29

**Status:** Accepted

**Amends:** [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion), and [D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance).

**Codifies:** P022, the former pending decision for verify promotion.

**Context.** [D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) added `verifyHandoffClaims()` as an extension-first helper. That was the right first move: one tested handoff path proved the shape, but not the cognitive primitive. The remaining gate was [D080](#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion)'s routine-use bar.

The follow-up work added two independent receiving-side flows:

- A private continuation packet flow. Agent A provides a [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)-style packet with signed record, private body material, proof bundle, and required hash list. Agent B verifies body commitment, proof, signer, freshness, context allow-list, missing body, missing proof, wrong signer, stale or future records, malformed evidence, and tampering before signing a follow-up with `informed_by`.
- A Cloudflare Agent transaction packet flow. The Cloudflare adapter emits a signed transaction record from an unwrapped upstream checkout response, gets a real in-process log inclusion proof, then a receiving audit agent verifies the packet before signing an `informed_by` follow-up.

These are different producers and different evidence postures. The first is an explicit cross-harness continuation packet with private body material. The second is a framework-adapter transaction packet with log inclusion and signer trust. In both, the receiving agent has a distinct cognitive step: "verify this counterparty evidence before I act on it."

**Decision.** Promote `verify` to cognitive primitive #7 and ship `@atrib/verify-mcp` as the agent-facing MCP wrapper. The primitive is named `atrib-verify`. It is read-only and wraps the existing `@atrib/verify` library.

`atrib-verify` accepts:

- `packet`, `records`, or `claims` evidence material.
- `required_record_hashes` so missing records become explicit rejections.
- `trusted_creator_keys` and `allowed_context_ids` trust policy.
- `require_body`, `require_body_commitment`, and `require_log_inclusion` gates.
- `log_public_key_b64`, `max_age_ms`, and `now_ms` verifier options.

The output is compact and agent-facing: `accepted_record_hashes`, `accepted`, `rejected`, and per-claim booleans for signature, signer trust, context policy, body commitment, and proof checks. The receiving agent uses `accepted_record_hashes` as the input to `informed_by` on its next signed action.

**Boundary check.**

- **Different cognitive purpose:** yes. The agent is not looking up its own past or walking causal history. It is accepting or rejecting someone else's evidence before relying on it.
- **Different required args:** yes. It requires evidence material plus trust policy, not just a record lookup key or context query.
- **Different graph effect:** read-only, like recall, trace, and summarize. The graph effect appears on the next write through `informed_by`; the primitive itself verifies whether that write should cite the upstream claim.

**What this does not change.**

- No new event_type, byte assignment, graph edge type, or settlement rule.
- `verifyHandoffClaims()` remains the library API.
- `handoffClaimsFromEvidencePacket()` remains a pure packet-to-claim adapter. It does not read files, fetch logs, or call archives.
- Record Body Archive retrieval remains future adapter work. `atrib-verify` verifies supplied archive material; it does not fetch it.

**Alternatives considered.**

- _Keep verify as a library-only extension._ Rejected. Two independent Pattern 3 flows now need an explicit receiving-side verify step before follow-up. Leaving it hidden behind code imports would make the agent surface lie about what the agent must do.
- _Fold verify into recall._ Rejected. Recall reads local history. Pattern 3 verification may consume private packets, cross-agent evidence, trust sets, and proof bundles that are not local recall queries.
- _Make verification a write primitive that signs an attestation record._ Rejected. The act of verification is useful before acting, but the protocol does not need a new event_type. If an agent wants to record the conclusion, it can use `atrib-emit` with `informed_by` pointing at the accepted hashes.
- _Promote `handoff` instead._ Rejected. [D073](#d073-handoff-event_type-byte-placeholder-adr) remains a placeholder for a future record type. Current evidence is about verifying claims before linking through the existing `INFORMED_BY` edge.

**Consequences.**

- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s surface is now seven primitives: `atrib-emit`, `atrib-annotate`, `atrib-revise`, `atrib-recall`, `atrib-trace`, `atrib-summarize`, and `atrib-verify`.
- `@atrib/verify-mcp` is a public package with a stdio binary `atrib-verify`.
- Read-primitive instrumentation applies to `atrib-verify` through `logReadPrimitiveCall`, so loop-closure analysis can see verification calls alongside recall, trace, and summarize.
- P022 is codified by this ADR. It should not remain listed as a pending decision.

**Cross-references.**

- [`services/atrib-verify/`](services/atrib-verify/), `@atrib/verify-mcp`.
- [`services/atrib-verify/test/verify.test.ts`](services/atrib-verify/test/verify.test.ts), primitive handler tests.
- [`packages/verify/src/handoff.ts`](packages/verify/src/handoff.ts), library helper and packet adapter.
- [`packages/integration/test/pattern3-handoff.test.ts`](packages/integration/test/pattern3-handoff.test.ts), private continuation packet e2e.
- [`packages/integration/test/cloudflare-agent-packet.test.ts`](packages/integration/test/cloudflare-agent-packet.test.ts), Cloudflare Agent transaction packet e2e.

---

## D107: AP2 counterparty attestation signs atrib transaction bytes

**Date:** 2026-05-29

**Status:** Accepted

**Extends:** [D052](#d052-cross-attestation-requirement-for-transaction-records), [D097](#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness), and [D098](#d098-ap2-receipts-stay-external-evidence-for-cross-attestation).

**Context.** [D098](#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) drew the right boundary: AP2 receipt JWT signatures and VI SD-JWT credentials are external evidence, not `signers[]` entries. The remaining gap was the handoff point for a real AP2 merchant or settlement party that wants to countersign the atrib transaction record itself.

`signTransactionRecord(record, privateKey, counterpartySigners?)` could already preserve supplied counterparty signers, but callers had to know how to produce those entries. The AP2 live interop harness also stopped at `detectTransaction()` plus `verifyAp2ViEvidenceAsync()`, so it could not test a reference artifact that included the actual atrib transaction record. One verifier edge also needed tightening: `signers_valid` counted valid entries, not distinct signer keys. A duplicate signer entry could inflate the count without adding an independent party.

**Decision.** Add `signTransactionAttestation(record, privateKey)` to `@atrib/mcp` and `@atrib/mcp/worker`.

The helper returns a single `{ creator_key, signature }` signer entry over `canonicalCrossAttestationInput(record)`. It requires `event_type = https://atrib.dev/v1/types/transaction`. AP2 participants use it only after the atrib transaction record fields are finalized, especially `creator_key`, `content_id`, `chain_root`, `context_id`, and `timestamp`.

The verifier now counts `signers_valid` as distinct creator keys with at least one valid signature over the cross-attestation bytes. Duplicate entries from the same key do not satisfy the two-party minimum. The base creator-signature check now accepts any valid signer entry matching the top-level `creator_key`, so a tampered duplicate before a valid creator entry does not incorrectly reject the record.

The AP2 live interop harness now accepts an optional `ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON` artifact. When present, the harness runs `verifyRecord()` with the same AP2 / VI evidence bundle, checks that the record `content_id` matches the detected AP2 receipt identity, and fails if `cross_attestation.missing` is true. `ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION=1` makes the transaction record artifact required.

`@atrib/integration` also includes a local AP2 participant artifact generator. It accepts an AP2 result plus AP2 / VI evidence bundle, rehydrates split compact JWT and SD-JWT fixtures when needed, normalizes full delegated AP2 mandate chains to the closed mandate JWT reference material, derives the transaction `content_id` through the production AP2 detector, signs the atrib transaction record as the agent, and appends a counterparty signer through `signTransactionAttestation()`. This is not a substitute for a real merchant or payment-party key. It is the local contract test for the bytes a real participant must sign.

The Google AP2 sample extractor composes with that generator. It converts captured official sample A2A function responses plus `.temp-db` mandate-chain files into the same artifact contract. It does not treat the sample merchant ES256 receipt key as an atrib signer.

The [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) conformance corpus adds `duplicate-signer-key`, pinning the rule that two entries from one key count as one valid signer.

**Alternatives considered.**

- _Keep counterparty signing as manual use of `canonicalCrossAttestationInput()`._ Rejected. That is easy to misuse in AP2 adapters and makes merchant-side code copy low-level signing logic.
- _Append counterparty signers inside `@atrib/verify`._ Rejected. Verification must stay read-only. Signing belongs in `@atrib/mcp`.
- _Count valid signer entries instead of distinct keys._ Rejected. The security property is independent parties, not array length.
- _Make transaction records mandatory for every AP2 interop run._ Rejected. Some reference runs only expose AP2 result and evidence artifacts. The harness keeps that path but lets stricter runs require the atrib record.

**Consequences.**

- AP2 Path 2 can now demonstrate the full boundary: successful AP2 receipt detection, valid AP2 / VI evidence, and a two-party atrib transaction record.
- AP2 receipt JWT signatures still do not count toward `cross_attestation`. Only signatures over atrib's [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) canonical bytes count.
- Duplicate signer entries can no longer satisfy the two-party minimum.
- The live AP2 harness can act as a reference-artifact gate for merchant adapters that emit or receive an atrib transaction record.
- The local participant generator gives AP2 implementers a concrete file-level contract before a live AP2 counterparty exposes an atrib signing endpoint.

**Cross-references.**

- [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402), AP2 receipt detection.
- [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), transaction cross-attestation.
- [§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), AP2 / VI evidence and interop harness.
- [`packages/integration/test/ap2-live-interop.test.ts`](packages/integration/test/ap2-live-interop.test.ts), artifact-harness coverage.
- [`packages/integration/test/ap2-vi-e2e.test.ts`](packages/integration/test/ap2-vi-e2e.test.ts), AP2 Path 2 with counterparty signer.
- [`packages/integration/test/ap2-local-participant.test.ts`](packages/integration/test/ap2-local-participant.test.ts), local participant artifact generation.
- [`packages/integration/test/google-ap2-sample-extract.test.ts`](packages/integration/test/google-ap2-sample-extract.test.ts), official sample extraction into local participant artifacts.
- [`spec/conformance/1.7.6/cases/duplicate-signer-key.json`](spec/conformance/1.7.6/cases/duplicate-signer-key.json), duplicate-signer corpus case.

---

## D108: Observability span trees are intake, local sidecars are cognitive payload

**Date:** 2026-05-29

**Status:** Accepted

**Extends:** [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path), [D086](#d086-bm25-indexes-record-content-from-d062-sidecars), and [D099](#d099-explicit-emit-records-commit-local-content-through-default-args_hash).

**Context.** Langfuse and similar LLM observability systems make the runtime span tree the product center: trace, nested observations, sessions, inputs, outputs, model metadata, usage, cost, scores, prompt versions, tags, users, releases, and eval objects. Langfuse can ingest this through SDK wrappers, decorators, framework integrations, and OTLP. It maps OpenTelemetry spans into its trace and observation model, including generation, tool, retriever, agent, evaluator, embedding, and related observation types.

That shape overlaps with atrib's capture surface. `@atrib/openinference` already consumes OpenInference-shaped OpenTelemetry spans, and most useful agent runs already produce a nested runtime trace before atrib signs anything. The product risk is muddying the boundary: if atrib copies the observability product model into the signed protocol, it becomes a worse Langfuse. If atrib ignores the span tree, it misses the cheapest and most widely deployed intake path for modern agent runtimes.

The second risk is on the read side. Rich capture is only useful to atrib if future agents can recall it. Before this decision, recall, trace, and summarize privileged `_local.content`; wrapper-style sidecars such as `_local.toolName`, `_local.args`, and `_local.result` could be mirrored yet stay mostly invisible to content search and narrative synthesis. That made the capture shape and the consumption shape drift apart.

**Decision.** Treat OpenTelemetry and OpenInference span trees as an intake and correlation layer, not as atrib's canonical evidence shape.

The canonical evidence shape remains:

1. The signed `AtribRecord`.
2. The public Merkle-log commitment and inclusion proof.
3. The deterministic graph derived from record structure.
4. Optional local mirror or archive bodies needed for replay, handoff, settlement, dispute, or cognitive recall.

Prompts, outputs, metadata, usage, cost, scores, prompt versions, trace ids, span ids, users, tags, and releases do not become first-class signed `AtribRecord` fields in v1. They live in local sidecar content unless a verifier, handoff, settlement, dispute, or recall consumer proves that one of those fields needs a protocol-level commitment or graph effect.

`@atrib/openinference` now writes a recall-readable sidecar content payload under `_local.content` through its submission callback convention. The content shape is local-only and includes:

- `source`, `span_kind`, `span_name`, `trace_id`, `span_id`.
- `what`, `why_noted`, and `topics` so observation records are legible to recall.
- `tool_name`, `args`, `result`, `input`, `output`, and MIME hints when present.
- `agent_name`, `model_name`, `tool_call_id`, and `llm_output_tool_call_id`.
- prompt fields such as prompt text, prompt messages, prompt tools, prompt template, prompt variables, prompt version, prompt id, and prompt URL when present.
- usage, cost, score, and metadata maps when present.

The signed record may still carry `args_hash` and `result_hash` per [§8.3](atrib-spec.md#83-salted-commitment-posture) when the caller wants replay-checkable commitments to the input or output bytes. That is the bridge from local observability payload to verifier-grade evidence. OpenInference strings that contain JSON are parsed and JCS-canonicalized before hashing so supplied body material can replay through `@atrib/verify`. The default remains sidecar-only.

`@atrib/mcp` now exposes local-sidecar normalization helpers so read primitives share one rule: explicit `_local.content` wins; otherwise consumers derive recall-readable content from known local fields such as `toolName`, `args`, `result`, `input`, `output`, `traceId`, `spanId`, `spanKind`, and `spanName`. `@atrib/recall`, `@atrib/trace`, and `@atrib/summarize` consume the normalized content. BM25 search indexes OpenInference observation fields. Trace summaries surface span kind, span name, model name, and prompt version. Summaries include OpenInference prompt, output, usage, cost, score, and metadata snippets.

`informed_by` is not copied from generic OTel parent-child nesting. Parent-child nesting proves correlation inside a trace, not dependency on a prior signed result. The shipped automatic derivation is intentionally narrower: LLM `tool_call.id` to matching TOOL `tool_call.id`, materialized before signing.

**Alternatives considered.**

- _Make Trace, Observation, and Session first-class atrib protocol objects._ Rejected. That would duplicate Langfuse and OpenTelemetry while weakening atrib's verifier boundary. `context_id` already gives correlation. `AtribRecord` already gives signed evidence.
- _Add prompts, outputs, metadata, usage, cost, scores, and prompt versions as signed record fields._ Rejected for v1. These fields are high-cardinality, often private, and usually operational. They become verifier-relevant only when a consumer needs to replay or dispute a specific claim. `args_hash`, `result_hash`, local mirrors, and future archive bodies cover that bridge without expanding the core record.
- _Ignore observability span trees and keep only wrapper/lifecycle capture._ Rejected. OpenTelemetry and OpenInference are the path of least resistance for many agent frameworks. Not consuming them would force atrib into custom adapters where a stable span stream already exists.
- _Build a Langfuse-style trace viewer inside atrib._ Rejected. The useful product boundary is composition: send spans to Langfuse or Phoenix for debugging, send signed records to atrib for evidence, recall, handoff, and settlement.
- _Let each cognitive primitive parse local sidecars independently._ Rejected. It recreates the drift this decision fixes. The normalizer belongs in `@atrib/mcp` because every read primitive already depends on it.

**Consequences.**

- atrib can sit beside Langfuse, Phoenix, Datadog, or any OTLP exporter on the same OpenTelemetry pipeline.
- Langfuse remains the better place to inspect live traces, latency, cost dashboards, evals, and prompt-management workflows. atrib remains the place to prove which action was signed, chained, committed, and later used as context.
- Some redundancy is intentional. `trace_id`, `span_id`, input/output snippets, model metadata, and prompt version may appear in both an observability backend and the local atrib mirror. The difference is consumption: Langfuse uses them for operations, atrib uses them as local cognitive payload and optional commitment material.
- Read primitives get stronger. A future agent can search for a prompt version, model, usage anomaly, evaluator score, or OpenInference span name and then trace or summarize the signed records around it.
- Causality remains replayable. Generic span nesting stays local sidecar context unless a future explicit derivation rule proves it should become signed `informed_by`.
- The public log stays lean. None of the new observability fields reach the log unless the host separately submits a signed record or archive body under an explicit privacy posture.
- Promotion remains conservative. A new signed field or event type still needs the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar: a distinct graph effect, verifier requirement, settlement requirement, or repeated consumer need.

**Cross-references.**

- [§5.9.3](atrib-spec.md#593-the-_local-sidecar-shape), local sidecar shape.
- [§8.3](atrib-spec.md#83-salted-commitment-posture), args/result body commitments.
- [§9.4](atrib-spec.md#94-pattern-openinference-spanprocessor-telemetry-substrate-hook), OpenInference SpanProcessor pattern.
- [`packages/openinference/src/sidecar.ts`](packages/openinference/src/sidecar.ts), OpenInference sidecar normalization.
- [`packages/mcp/src/local-sidecar.ts`](packages/mcp/src/local-sidecar.ts), shared local-sidecar normalizer.
- [`services/atrib-recall/src/aggregations.ts`](services/atrib-recall/src/aggregations.ts), recall loader consumption.
- [`services/atrib-trace/src/index.ts`](services/atrib-trace/src/index.ts), trace sidecar summaries.
- [`services/atrib-summarize/src/prompt.ts`](services/atrib-summarize/src/prompt.ts), summary prompt consumption.

---

## D109: MCP/OAuth authorization evidence uses generic tiered evidence blocks

**Date:** 2026-06-01

**Status:** Accepted

**Extends:** [D051](#d051-capability-scoped-records-via-directory-published-envelopes), [D089](#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D094](#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), and [D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance).

**Context.** External review of Vouch, ZCAP-LD, OAuth/GNAP, A2A, MCP authorization, AP2, and Verifiable Intent clarified a layer boundary. atrib already proves signed action history, graph structure, handoff evidence, identity claims, capability envelopes, and AP2 / VI transaction evidence. It does not issue authorization credentials or decide which agent is allowed to act. That boundary is correct.

The gap was verifier ergonomics. AP2 / VI evidence had a strong tiered result under `ap2_vi_evidence`, but the shape was protocol-specific and transaction-only. Tool-call authorization evidence from MCP's OAuth profile had nowhere to attach. Capability checks also had avoidable `unresolvable` outcomes because callers could not supply the facts they had already resolved from a local body or protocol event.

MCP authorization makes this worth implementing now. HTTP MCP servers use OAuth-style resource-server semantics, protected-resource metadata, authorization-server discovery, scopes, and resource binding. atrib is already MCP-native. A verifier that sees a signed MCP `tool_call` record should be able to attach the OAuth evidence for that call without changing the record validity bit.

**Decision.** `@atrib/verify` now exposes a generic tiered `evidence[]` block shape and an OAuth / MCP authorization evidence verifier.

1. `verifyRecord()` accepts `authorizationEvidence[]` and attaches results to `result.evidence`.
2. Each evidence block has `{ valid, protocol, issuer, subject, scope, attenuation_ok, delegation_ok, constraints, errors, warnings }`.
3. AP2 / VI evidence remains available at `ap2_vi_evidence` for backward compatibility and is also mirrored into `evidence[]` as `protocol: "ap2_vi"`.
4. OAuth / MCP evidence verifies caller-supplied access-token JWTs against caller-supplied JWKS, checks issuer, audience, resource binding, required scopes, optional RFC 9396-style `authorization_details`, optional `client_id`, subject, actor subject, `cnf.jkt`, caller-supplied introspection responses, and optional DPoP proof material.
5. The OAuth / MCP verifier does not mint tokens, run OAuth redirects, call introspection endpoints, or fetch metadata. Callers supply tokens, claims, introspection responses, protected-resource metadata, constraints, and trust roots.
6. `verifyRecord()` accepts `resolvedFacts` so capability checks can evaluate `tool_names`, `max_amount`, and `counterparties` when the caller has local body material or protocol-event facts.
7. Evidence validity is tiered. A record can have `valid: true` while an evidence block has `valid: false`.

**Alternatives considered.**

- _Build a Vouch adapter first._ Rejected. Vouch has strategic overlap, but current traction is thin and its fixed delegation-depth posture is not a pattern atrib should copy.
- _Make OAuth evidence failures flip `verifyRecord().valid`._ Rejected. That would blur record authenticity with external authorization posture. A signed action can be real even when the token evidence is missing, expired, over-scoped, or invalid.
- _Keep AP2 / VI as the only evidence block._ Rejected. MCP tool calls are atrib's broadest capture surface. Authorization evidence needs to attach before transactions, not only after commerce closes.
- _Fetch OAuth metadata or call token-introspection endpoints inside `@atrib/verify`._ Rejected. Hidden network fetches would add privacy, caching, trust-root, and SSRF policy to a verifier path that currently runs on caller-supplied material.
- _Put OAuth scopes into the signed atrib record._ Rejected. Scope strings and token claims are external authorization evidence. They are not part of the canonical action record unless a producer deliberately commits local body material through `args_hash` or `result_hash`.

**Consequences.**

- atrib gains a second concrete authorization-evidence adapter without becoming an authorization server.
- MCP/OAuth strengthens the tool-call side of atrib in the same way AP2/VI strengthened the transaction side.
- Consumers can render and policy-check one `evidence[]` list across AP2 / VI, MCP/OAuth, and future ZCAP-LD, Biscuit, macaroon, GNAP, or Vouch adapters.
- Capability checks are less often stuck at `unresolvable` when callers have already resolved tool names, amounts, or counterparties.
- Opaque-token support is caller-supplied evidence. A caller can pass a verified introspection response from a path it controls, but `@atrib/verify` does not call the introspection endpoint itself.
- Delegation-depth limits stay out of core validity. Any future capability-chain adapter must bound verifier work without treating arbitrary hop count as a semantic validity rule.

**Cross-references.**

- [§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), generic authorization evidence blocks.
- [§6.7.2](atrib-spec.md#672-verifier-semantics), resolved capability facts.
- [`packages/verify/src/authorization-evidence.ts`](packages/verify/src/authorization-evidence.ts), OAuth / MCP authorization evidence verifier.
- [`packages/verify/src/verify-record.ts`](packages/verify/src/verify-record.ts), `authorizationEvidence[]`, `evidence[]`, and `resolvedFacts`.
- [MCP authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization), OAuth-based HTTP transport authorization.
- [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), OAuth Protected Resource Metadata.
- [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396), OAuth Rich Authorization Requests.
- [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449), OAuth DPoP.
- [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662), OAuth Token Introspection.

---

## D110: MCP/OAuth evidence capture closes the producer-to-verifier loop

**Date:** 2026-06-01

**Status:** Accepted

**Extends:** [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), [D100](#d100-mcp-middleware-can-sign-and-observe-records-with-log-submission-disabled), and [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks).

**Context.** [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) gave verifiers a generic `evidence[]` shape and an MCP/OAuth evidence checker. That was necessary, but incomplete. A verifier-only adapter still required every host to hand-build evidence blocks from MCP transport state. That left too much of the useful path outside atrib's own reference implementation.

The missing piece is producer-side capture from already-validated MCP HTTP authorization state. MCP transports can expose `extra.authInfo` and request metadata after the server or framework has accepted the OAuth token. atrib should preserve that authorization context in the local mirror sidecar so later verifiers can attach it to the signed record.

**Decision.** `@atrib/mcp` now has opt-in producer-side MCP/OAuth evidence capture through `AtribOptions.authorizationEvidence`.

1. The producer reads validated `extra.authInfo` and request metadata after the tool handler succeeds.
2. The producer writes verifier-ready `authorizationEvidence` only to the local sidecar passed to `onRecord` or mirror writers.
3. The producer does not put OAuth claims, scopes, or proof material into the signed `AtribRecord`.
4. The producer does not store raw bearer tokens by default. It stores verified claims, optional one-way token hash, configured constraints, and optional DPoP proof material.
5. The producer writes `resolvedFacts: { tool_name }` for tool calls so capability-envelope checks can use local body facts.
6. `@atrib/verify` accepts caller-supplied OAuth token-introspection responses, verifies optional DPoP proofs, and keeps replay-cache state caller-owned through `seenJtis`.
7. `AtribVerifier.verify()` mirrors AP2 / VI into generic `evidence[]` and accepts generic authorization evidence for settlement-level checks.
8. `spec/conformance/5.5.6/oauth/` pins offline JWT, verified-claims, introspection, scope, resource-binding, and DPoP cases.
9. `@atrib/integration` exposes `pnpm --filter @atrib/integration mcp-oauth-evidence` to prove the producer-to-verifier path locally.
10. The explorer action view can render `entry.evidence[]` when a lookup or body surface supplies verifier evidence, but the public log remains commitment-only.

**Alternatives considered.**

- _Store OAuth evidence in the public log entry._ Rejected. The log commits to record hashes and fixed entry bytes. OAuth scopes and proofs are external authorization evidence and often sensitive.
- _Store raw bearer tokens so auditors can replay every check._ Rejected. A bearer token is a credential. The sidecar may store a hash and verified claims, but raw token retention must be an explicit host policy outside the default path.
- _Perform live introspection inside `@atrib/verify`._ Rejected for the same reason as [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks): hidden network calls add privacy, caching, SSRF, and trust-root policy to a verifier path that should run on supplied evidence.
- _Make DPoP replay prevention global inside the library._ Rejected. Replay detection needs shared state across requests and verifier instances. The library verifies `jti`, `iat`, `ath`, `htm`, `htu`, and `cnf.jkt`; callers pass `seenJtis` when they enforce replay policy.

**Consequences.**

- MCP/OAuth is now a real second adapter path, not just a result schema.
- The reference path proves an authorized MCP tool call can produce a signed atrib record, local authorization sidecar evidence, and a verifier `evidence[]` result without changing base record validity.
- Capability support improves at the same time because producers now provide resolved tool-name facts in the sidecar.
- The public log posture stays unchanged. Authorization material remains local, archived, or verifier-supplied evidence.
- Explorer support is conditional. It renders evidence only when an API or body surface includes it; it does not imply the commitment-only log stores evidence blocks.

**Cross-references.**

- [§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), generic authorization evidence blocks.
- [§5.9.3](atrib-spec.md#593-the-_local-sidecar-shape), local sidecar fields.
- [`packages/mcp/src/oauth-evidence.ts`](packages/mcp/src/oauth-evidence.ts), producer-side MCP/OAuth sidecar evidence capture.
- [`packages/verify/src/authorization-evidence.ts`](packages/verify/src/authorization-evidence.ts), OAuth / MCP authorization evidence verifier.
- [`packages/integration/src/mcp-oauth-evidence-harness.ts`](packages/integration/src/mcp-oauth-evidence-harness.ts), local producer-to-verifier harness.
- [`spec/conformance/5.5.6/oauth/`](spec/conformance/5.5.6/oauth/), offline OAuth / MCP evidence corpus.

---

## D111: Host-owned OAuth evidence infrastructure

**Date:** 2026-06-01

**Status:** Accepted

**Extends:** [D070](#d070-record-body-archive-layer), [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), and [D110](#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop).

**Context.** [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) and [D110](#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop) made MCP/OAuth evidence possible, but left three production edges for hosts to solve alone:

1. Explorer evidence needed a body/evidence API because `log-node` cannot return sidecar evidence.
2. DPoP replay protection needed state shared across verifier instances.
3. Opaque-token introspection needed live network plumbing, but hidden verifier fetches would violate the caller-owned trust boundary.

**Decision.** atrib now ships host-owned infrastructure for those three edges without moving authorization policy into core record validity.

1. `services/archive-node` serves body and evidence retrieval for archived records. The explorer reads its evidence projection opportunistically. Producers can opt into archive submission through `@atrib/mcp` or `@atrib/mcp-wrap`; the producer submits the signed body only after log acceptance and sends selected verifier evidence, not raw local sidecar args or results.
2. `@atrib/verify` exposes `DpopReplayCache`, `MemoryDpopReplayCache`, and `createFetchDpopReplayCache()`. Deployments that need replay defense pass a shared cache into OAuth evidence verification; the HTTP adapter lets hosts wire Redis, Durable Objects, Postgres, or another atomic store behind a small endpoint.
3. `@atrib/verify` exposes `introspectOAuthToken()` and `oauthEvidenceFromIntrospectionResult()`. The host chooses the endpoint, client authentication, timeout, and expected issuer, audience, or resource. The helper returns caller-supplied evidence; `verifyRecord()` still performs no hidden network calls.

**Alternatives considered.**

- _Let `verifyRecord()` call introspection endpoints._ Rejected. It would hide network behavior, SSRF policy, token handling, and authorization-server trust roots inside a function that should verify supplied material.
- _Keep DPoP replay state as `seenJtis[]` only._ Rejected. It works for tests and one process, but production HTTP deployments need an atomic shared check-and-remember contract.
- _Make archive evidence mandatory for explorer action views._ Rejected. Most records remain verifiable at Tier 1 from the log alone. Missing body evidence is a state to show, not an error.

**Consequences.**

- atrib has a concrete second evidence adapter path with production retrieval and verifier plumbing, not just fixture code.
- Hosts still own OAuth secrets, live introspection policy, replay-cache deployment, and archive opt-in policy.
- The archive layer gives public inspection a way to show evidence without changing log entries or graph derivation.
- A hosted Cloudflare Worker / Durable Object reference for replay-cache and introspection endpoints now lives at [`packages/integration/examples/cloudflare-agents/oauth-evidence-infra/`](packages/integration/examples/cloudflare-agents/oauth-evidence-infra/). It is an implementation example, not a protocol requirement.

**Cross-references.**

- [§2.12](atrib-spec.md#212-record-body-archive-layer), archive body and evidence API.
- [§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), OAuth / MCP evidence and DPoP replay-cache semantics.
- [`packages/mcp/src/submission.ts`](packages/mcp/src/submission.ts), producer-side archive submission after log proof.
- [`packages/verify/src/dpop-replay-cache.ts`](packages/verify/src/dpop-replay-cache.ts), replay-cache contract.
- [`packages/verify/src/oauth-introspection.ts`](packages/verify/src/oauth-introspection.ts), host-owned introspection helper.
- [`services/archive-node/`](services/archive-node/), production archive reference service.
- [`packages/integration/examples/cloudflare-agents/oauth-evidence-infra/`](packages/integration/examples/cloudflare-agents/oauth-evidence-infra/), Cloudflare Worker and Durable Object reference for replay cache and introspection endpoints.
- [`docs/concepts/12-delegation-and-capabilities.md`](docs/concepts/12-delegation-and-capabilities.md), capability and delegation boundary note.

## D112: Anthropic Memory Tool wrapper signs memory commands without owning storage

**Date:** 2026-06-01

**Status:** Accepted

**Context.** Anthropic's Memory Tool is a client-side tool: the application
handles file operations and controls storage. The current TypeScript SDK exposes
`betaMemoryTool(handlers)`, where the host implements handlers for `view`,
`create`, `str_replace`, `insert`, `delete`, and `rename`. Anthropic's public
docs describe this as a backend-swappable surface and tell implementers to
restrict operations to `/memories`.

The outreach program needed a finished artifact for the Anthropic Memory Tool
lane, not only a strategy note. The previous plan said `@atrib/memory-tool`
would implement a storage backend itself. Source-reading the SDK showed a
cleaner shape for TypeScript: wrap any existing `MemoryToolHandlers` object and
sign the commands around it.

**Decision.** Add `@atrib/memory-tool` as a public package that exports
`createAtribMemoryTool()` and `attributeMemoryTool()`. The package wraps
Anthropic Memory Tool handlers, signs mutating commands as atrib `tool_call`
records, and leaves storage under the host's control.

Default signed commands:

- `create`
- `str_replace`
- `insert`
- `delete`
- `rename`

`view` remains unsigned by default because it is read-only and can reveal memory
contents through result hashes if the host chooses a weak privacy posture.
Callers can opt in with `signReads: true`.

Each record uses:

- `tool_name = anthropic.memory.<command>`
- `args_hash = sha256(JCS(command))`
- `result_hash = sha256(JCS({ status, result }))` or
  `sha256(JCS({ status, error }))`
- `event_type = tool_call`
- `context_id` from the caller or a fresh process-local id
- `chain_root` from `@atrib/mcp` `resolveChainRoot()`

The signed record does not store memory file bodies. The host can keep bodies in
its own filesystem, database, cloud store, local mirror, or archive policy.
If no atrib signing key is configured, or the configured key cannot be decoded,
the wrapper passes commands through without signing. The Memory Tool operation
still succeeds or fails according to the host's handler.

**Alternatives rejected.**

- _Implement a new filesystem backend._ Rejected for v0. Anthropic already
  ships a local filesystem handler. Wrapping handlers proves the verifiability
  layer without copying storage logic or drifting from the SDK's own example.
- _Depend on Anthropic SDK at runtime._ Rejected. The package imports SDK types
  only. Users already pass the wrapped handlers to `betaMemoryTool()`.
- _Sign only successful mutations._ Rejected. Failed writes are useful evidence
  in memory-integrity investigations, so the wrapper signs error outcomes while
  preserving the original thrown error.
- _Sign reads by default._ Rejected. Reads are useful for audit trails in some
  deployments, but they create more privacy surface. Opt-in is the better
  default.

**Consequences.**

- The Anthropic Memory Tool outreach lane now has a runnable package artifact.
- The integration composes with `BetaLocalFilesystemMemoryTool` and any custom
  handler object.
- The package depends on the public `@atrib/mcp` signing, hashing, submission,
  and chain-root helpers instead of reimplementing protocol logic.
- Missing or invalid signing configuration degrades to unsigned pass-through,
  matching [§5.8](atrib-spec.md#58-degradation-contract).
- The package pins its peer expectation to `@anthropic-ai/sdk >=0.100.1`. The
  Memory Tool is still beta, so callers should pin the SDK version they test.

**Cross-references.**

- [`packages/memory-tool/README.md`](packages/memory-tool/README.md), package
  guide and quick start.
- [§1.2](atrib-spec.md#12-record-format), record fields.
- [§5.8](atrib-spec.md#58-degradation-contract), degradation contract.
- [§8.3](atrib-spec.md#83-salted-commitment-posture), content commitment
  posture.
- [D067](#d067-multi-producer-chain-composition-precedence-contract), shared
  chain-root resolution.
- [D100](#d100-log-submission-can-be-disabled-while-still-signing-and-running-onrecord),
  offline signing and `onRecord` behavior.

## D113: Unvalidated informed_by refs are omitted by default

**Date:** 2026-06-02

**Status:** Accepted

**Extends:** [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), and [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash).

**Context.** A live session graph still showed missing `INFORMED_BY` refs after
the producer-side structured-ref fix had landed. The immediate cause was
runtime skew: the repository carried the fixed `@atrib/emit`, while the
operator machine still had an older global `@atrib/emit` binary on the hook
path. A follow-up smoke found a second structural gap in the fixed path:
`@atrib/emit` kept caller-supplied `informed_by` refs when validation was
`unknown` because local mirrors or log lookup were unavailable.

That default preserved the wrong thing. The [§5.8](atrib-spec.md#58-degradation-contract)
degradation contract says atrib failures must not affect the primary tool call
or agent response. It does not require producers to preserve an unverifiable
graph claim. If the producer cannot prove a referenced record exists in local
mirror state or the configured log lookup, signing the event without that ref
is the safer degradation.

**Decision.** Producers that validate `informed_by` refs keep only refs that are
found locally or through log lookup. Missing refs and unvalidated refs are
omitted before signing by default. The producer emits a warning that names the
short hash and still signs the event without the omitted ref. Deliberate
dangling claims remain possible only through an explicit escape hatch:
`allow_unresolved_informed_by: true`.

For `@atrib/emit`, this rule applies to both the long-lived MCP server and the
`atrib-emit-cli` hook binary because both route through `handleEmit`. The build
script also restores executable bits on `dist/main.js` and `dist/cli.js` after
`tsc`, so local global installs keep the hook-spawned binaries runnable.

**Alternatives rejected.**

- _Keep unvalidated refs with a warning._ Rejected. It keeps signed structure
  that the producer failed to validate. That creates avoidable dangling edges.
- _Refuse to sign when a ref cannot be validated._ Rejected. That violates the
  degradation contract. The primary event can still be signed without the
  unverifiable edge.
- _Treat validation failure as an external ref._ Rejected. External refs are
  references to records outside the resolved graph set. A lookup failure says
  nothing about scope.

**Consequences.**

- Default producer behavior favors fewer graph claims over unverifiable graph
  claims.
- Existing signed records are immutable. Historical missing-ref edges remain
  visible until the referenced records are replayed or the session is viewed
  with repair annotations.
- Operators must update or restart long-lived producer processes after package
  updates. Source changes and global installs do not rewrite already-loaded MCP
  server code.
- Conformance fixtures and deliberate dangling-node tests must set
  `allow_unresolved_informed_by: true`.

**Cross-references.**

- [§1.2.5](atrib-spec.md#125-informed_by), `informed_by`.
- [§3.2.4](atrib-spec.md#324-edge-derivation-rules), graph edge derivation.
- [§5.8](atrib-spec.md#58-degradation-contract), degradation contract.
- [`services/atrib-emit/src/reference-resolution.ts`](services/atrib-emit/src/reference-resolution.ts),
  reference validation.
- [`services/atrib-emit/test/emit.test.ts`](services/atrib-emit/test/emit.test.ts),
  default drop coverage.

## D114: Google ADK Python proof uses the plugin callback boundary

**Date:** 2026-06-04

**Status:** Accepted

**Extends:** [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path)
and [D100](#d100-log-submission-can-be-disabled-while-still-signing-and-running-onrecord).

**Context.** The existing Google ADK example proved the TypeScript package:
`@google/adk` `InMemoryRunner`, `BasePlugin`, and `FunctionTool` can emit a
hash-only atrib record at the tool callback boundary. Route research for the
Google ADK outreach lane showed the stronger public channel is currently
`google/adk-python`, whose `Ideas` and `Show and tell` discussions already
cover provenance exporters, Ed25519 receipts, compliance plugins, memory, and
authority receipts. The TypeScript proof was useful, but the route and artifact
did not match.

**Decision.** Add a sibling Python ADK proof at
[`packages/integration/examples/google-adk-python/`](packages/integration/examples/google-adk-python/).
The proof runs a real `google-adk==2.1.0` `InMemoryRunner`, registers a Python
`BasePlugin`, uses a scripted `BaseLlm`, calls a real `FunctionTool`, and captures
the `after_tool_callback` event. The TypeScript smoke then signs one hash-only
atrib `tool_call` record for that captured Python tool outcome, following the
same host-signing pattern used by the LangGraph Python, LlamaIndex Python,
Letta, and Microsoft Agent Framework examples.

The signed record uses:

- `tool_name = google.adk.python.tool.<tool_name>`
- `args_hash = sha256(JCS(package, package_version, runtime, session, tool_name, agent_name, user_id, args))`
- `result_hash = sha256(JCS(operation, tool, result))`
- `event_type = tool_call`
- `context_id` supplied by the smoke
- local sidecars for raw ADK app, session, user, invocation, function-call id,
  arguments, and result material

**Alternatives rejected.**

- _Post the TypeScript proof into `google/adk-python`._ Rejected. The channel
  mismatch would make the artifact harder for Python maintainers to judge.
- _Open a Python proof that bypasses ADK and calls the tool function directly._
  Rejected. It would not prove the ADK plugin lifecycle.
- _Sign inside the Python script._ Rejected for this example. The existing
  Python examples keep Python runtime capture separate from atrib signing in the
  TypeScript smoke, so protocol signing still uses the shared `@atrib/mcp`
  helpers.
- _Lead with BigQuery Agent Analytics or Agent Platform Runtime._ Rejected for
  this proof. Those are stronger later routes, but they require managed Google
  identifiers that this local `InMemoryRunner` proof does not produce.

**Consequences.**

- The ADK outreach lane now has a Python artifact that matches the higher-signal
  ADK Python route.
- The proof stays local and credential-free. It does not claim Agent Platform
  Runtime, Gemini Enterprise, BigQuery Agent Analytics, Memory Bank, trajectory
  evaluation, hosted model calls, upstream acceptance, or maintainer interest.
- A later managed Google proof can pair the same callback boundary with ADK
  telemetry, BigQuery Agent Analytics event ids, Cloud Trace ids, Memory Bank
  events, or Agent Platform Runtime deployment ids.

**Cross-references.**

- [`packages/integration/examples/google-adk/`](packages/integration/examples/google-adk/),
  TypeScript ADK plugin proof.
- [`packages/integration/examples/google-adk-python/`](packages/integration/examples/google-adk-python/),
  Python ADK plugin proof.
- [`packages/integration/test/google-adk-python-attribution.test.ts`](packages/integration/test/google-adk-python-attribution.test.ts),
  opt-in Python smoke coverage.

## D115: Agent-to-subagent handoff uses a three-signal producer bundle

**Date:** 2026-06-04

**Status:** Accepted

**Extends:** [D065](#d065-atrib_chain_tail_context_id-env-var-for-cross-producer-chain-tail-handoff),
[D104](#d104-parent-child-threading-uses-atrib_parent_record_hash),
[D105](#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance),
and [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default).

**Context.** Agent-to-subagent workflows are now a routine agent runtime shape:
coding agents spawn workers, orchestrators dispatch specialists, hosted agents
hand work to local agents, and framework runtimes expose handoff or delegation
callbacks. atrib already had the pieces, but they were documented separately:
`ATRIB_CONTEXT_ID` for session scope, `ATRIB_CHAIN_TAIL_<context_id>` for chain
continuity, `ATRIB_PARENT_RECORD_HASH` for a parent dispatch edge, and Pattern 3
verification for received handoff claims.

That separation made the common path too easy to implement partially. A child
could inherit the context but start a split chain, chain to the parent but lack
an explicit parent edge, or cite a temp smoke/hash artifact as `informed_by`
without proving the target record exists. The live outreach-master session
showed this failure class: the session itself was valid, but some downstream
records preserved unresolved `INFORMED_BY` claims from local proof outputs.

**Decision.** Same-session subagent spawns use a single producer handoff bundle.
When the parent has signed the dispatch record before the child signs, the
parent or adapter MUST pass these signals together:

- `ATRIB_CONTEXT_ID=<parent-context-id>`
- `ATRIB_CHAIN_TAIL_<parent-context-id>=<latest-tail-record-hash>`
- `ATRIB_PARENT_RECORD_HASH=<parent-dispatch-record-hash>`

`@atrib/mcp` exposes `buildSubagentProducerEnv()` so adapters can build this
bundle without hand-copying env-var rules. When the dispatch record is also the
latest chain tail, the helper uses the parent dispatch hash for both
`ATRIB_CHAIN_TAIL_<context_id>` and `ATRIB_PARENT_RECORD_HASH`. When a runtime
has a fresher tail, it can pass a distinct `chainTailRecordHash`.

If the parent dispatch record hash is not available before the child signs,
the adapter MUST NOT preserve a guessed or unresolved parent edge. It should use
one of three shapes instead:

- pre-call signing for the spawn/handoff action, then pass the resulting parent
  hash to the child bundle;
- Pattern 3 evidence, where the receiving agent calls `atrib-verify` and uses
  only `accepted_record_hashes` in its follow-up `informed_by`; or
- a later annotation or revision record that explains the relationship after
  both sides are signed.

Temp smoke hashes, output commitment hashes, transcript snippets, and private
proof labels are evidence metadata. They are not `informed_by` targets unless
they are also durable atrib record hashes that resolve locally or through a
trusted packet. `allow_unresolved_informed_by: true` remains reserved for
deliberate dangling fixtures and diagnostics.

**Alternatives rejected.**

- _Promote a dedicated `handoff` event_type now._ Rejected. The producer bundle
  fixes the common same-session case with existing `chain_root` and
  `informed_by` semantics. [D073](#d073-handoff-event_type-byte-placeholder-adr)
  remains the reserved decision point for runtimes that need handoff-specific
  graph behavior.
- _Only document `ATRIB_PARENT_RECORD_HASH`._ Rejected. It links the parent edge
  but does not preserve session scope or chain continuity by itself.
- _Let child producers keep unresolved parent refs and repair later._ Rejected.
  Repair records can explain history, but new producers should not create
  avoidable missing links.

**Consequences.**

- Adapter authors have one helper for same-session child env construction
  instead of three handwritten conventions.
- The parent-to-child direction stays producer-side. The child-to-parent return
  direction remains verifier-side when the parent is asked to build on a child
  packet.
- Existing signed records are immutable. This decision prevents the next class
  of broken links; it does not erase historical dangling nodes.
- SessionStart and multi-creator awareness remain a separate read-side problem
  under [P026](#p026-multi-creator-awareness-in-sessionstart-context-surface).
- This does not make parent env seeds depend on child-visible mirror or public
  log lookup. [D116](#d116-producer-side-informed_by-validation-is-source-aware)
  adds resolver-backed validation for callback and auto-detected refs while
  keeping parent dispatch hashes on the producer-owned path.

**Cross-references.**

- [`packages/mcp/src/subagent.ts`](packages/mcp/src/subagent.ts),
  `buildSubagentProducerEnv()` helper.
- [`packages/mcp/test/subagent.test.ts`](packages/mcp/test/subagent.test.ts),
  helper coverage.
- [§9.8](atrib-spec.md#98-composing-patterns), runtime composition guidance.
- [§7.8](atrib-spec.md#78-cross-harness-continuation-packets),
  cross-harness packet shape.

## D116: Producer-side informed_by validation is source-aware

**Date:** 2026-06-04

**Status:** Accepted

**Extends:** [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type),
[D104](#d104-parent-child-threading-uses-atrib_parent_record_hash),
[D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default),
and [D115](#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle).

**Context.** [D115](#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle)
fixed the same-session agent-to-subagent spawn shape, but the remaining
missing-link class was broader than parent-child threading. `@atrib/mcp`
accepted any shape-valid `sha256:<64-hex>` returned by an `informedBy` callback or
structured auto-detect path. That preserved backwards compatibility, but it let
wrapper configs promote temp smoke hashes, output commitments, or private proof
labels into signed `informed_by` claims when those hashes were not durable atrib
records.

At the same time, a naive "resolve every ref before signing" rule would break the
subagent path [D115](#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle)
is trying to preserve. A parent process can sign a dispatch record and pass that
hash to a child before the child's mirror or the public log can see it. That hash
is producer-owned structure, not an external evidence claim.

**Decision.** `@atrib/mcp` now treats `informed_by` candidates by source:

- `parent-env`: `ATRIB_PARENT_RECORD_HASH` seeds are shape-validated and kept as
  producer-owned spawn anchors. They are not looked up through the child's mirror
  or the public log.
- `informedBy-callback`: explicit host callback refs are shape-validated, then
  resolver-accepted when a `recordReferenceResolver` is configured.
- `auto-detect`: structured auto-detected refs follow the same resolver path as
  callback refs.

`@atrib/mcp` exposes `recordReferenceResolver` on `AtribOptions`, plus
`RecordReferenceCandidate` metadata (`recordHash`, `source`, `toolName`,
`contextId`, `params`) so hosts can make source-aware decisions. Resolver errors
are caught, the candidate is dropped, and the wrapped tool call still succeeds
per [§5.8](atrib-spec.md#58-degradation-contract).

`@atrib/mcp` also exposes a shared `defaultRecordReferenceResolver()` for Node
hosts. It checks local mirrors under `ATRIB_AUTOCHAIN_SOURCE`, `ATRIB_MIRROR_FILE`,
and `ATRIB_RECORDS_DIR` / `~/.atrib/records`, then falls back to public log lookup.
It returns `found`, `not-found`, or `unknown`; hosts that require validated refs
drop both `not-found` and `unknown`.

`@atrib/mcp-wrap` now wires this resolver for configured `informedByPaths`. It
checks the configured wrapper mirror first, then uses the shared resolver. This
keeps valid cross-producer local links, such as refs to `atrib-emit` observations,
while dropping temp proof hashes that have no durable record. `@atrib/emit` now
uses the same shared resolver implementation for explicit emit refs, preserving
its existing [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default)
behavior without duplicating mirror and log lookup code.

**Alternatives rejected.**

- _Make every `informed_by` candidate perform mandatory lookup._ Rejected. It
  would drop valid parent dispatch hashes during the spawn race between parent
  signing and child-visible durability.
- _Keep resolver logic only in `@atrib/emit`._ Rejected. The latest missing-link
  incident flowed through wrapper-signed tool calls, so the guard must sit at the
  shared middleware boundary too.
- _Validate only against the wrapper's own mirror._ Rejected. Valid refs often
  point to records signed by a sibling producer, especially `atrib-emit`.
- _Treat unknown lookup status as acceptable._ Rejected for wrapper-configured
  refs. If validation is unavailable, the safer graph behavior is to omit the
  edge and leave the evidence in local sidecar or prose.

**Consequences.**

- The common `mcp-wrap informedByPaths` path no longer signs unresolved refs when
  the target is absent from local mirrors and the log lookup.
- Parent-to-child subagent anchors still work before log inclusion or child
  mirror visibility.
- Raw `@atrib/mcp` consumers keep shape-only behavior unless they configure a
  resolver. This preserves API compatibility, but production wrappers should pass
  a resolver when they promote argument fields into `informed_by`.
- `@atrib/emit` and `@atrib/mcp-wrap` now share resolver behavior, reducing drift
  between explicit cognitive records and wrapper-signed tool records.

**Cross-references.**

- [`packages/mcp/src/middleware.ts`](packages/mcp/src/middleware.ts),
  source-aware candidate handling.
- [`packages/mcp/src/record-reference.ts`](packages/mcp/src/record-reference.ts),
  shared local mirror plus log resolver.
- [`packages/mcp/src/mirror.ts`](packages/mcp/src/mirror.ts),
  explicit mirror hash lookup.
- [`packages/mcp-wrap/src/wrap.ts`](packages/mcp-wrap/src/wrap.ts),
  wrapper resolver wiring.
- [`services/atrib-emit/src/reference-resolution.ts`](services/atrib-emit/src/reference-resolution.ts),
  shared resolver reuse.

## D117: Demo records are classified by execution surface

**Date:** 2026-06-10

**Status:** Accepted

**Extends:** [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence),
[D070](#d070-record-body-archive-layer),
[D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface),
and [D097](#d097-ap2-live-interop-artifact-harness-is-opt-in).

**Context.** `@atrib/integration` now contains local demos, framework smokes,
Cloudflare live proofs, AP2 capture tools, proof-log receipts, OAuth archive
fixtures, and deterministic Google stack proofs. They all create real signed
records, but they do not all mean the same thing.

The recurring record-health audits surfaced the risk: if test records, public
proof records, live-capture artifacts, and the operator's cognitive-primitive
records are treated as one undifferentiated pool, recall and graph-health
analysis can overstate or understate what happened. A public Cloudflare proof is
valuable protocol evidence, but it is not the same signal as a daily
`atrib-emit` observation from an agent session. An AP2 fixture transaction is a
verifier replay artifact, but it is not a real merchant settlement unless the
external AP2 participant supplied the live evidence.

**Decision.** Demo-generated records are classified by execution surface:

- **Offline and local demos** sign real records but keep them in process memory,
  local sidecars, local dev logs, or fixture artifacts. They must not contact
  production atrib services during default tests.
- **Public proof generators** intentionally submit narrow, inspectable records
  to `log.atrib.dev` and, when needed, `archive.atrib.dev`. They must be named
  and documented as public proof commands.
- **Live capture artifacts** collect upstream protocol events and write verifier
  replay artifacts. They only become public log records when a command explicitly
  says it is producing a public proof.

The default `@atrib/integration` Vitest suite now refuses fetches to production
atrib services: `log.atrib.dev`, `archive.atrib.dev`, `graph.atrib.dev`,
`directory.atrib.dev`, and `explore.atrib.dev`. Tests must use local endpoints,
in-process dev logs, or mocked fetches. Live proof scripts run outside Vitest.

Public demo records are valid protocol evidence, but they are not default
operator memory. Health checks and recall flows should scope them by command,
example path, signer role, `context_id`, or run artifact before using them as
evidence about dogfood sessions.

**Alternatives rejected.**

- _Forbid examples from writing public records._ Rejected. Public proof records
  are useful for demos, explorer QA, and partner-facing artifacts.
- _Treat every example record as normal dogfood memory._ Rejected. That would
  pollute recall and make operator health checks confuse scripted proof traffic
  with lived agent history.
- _Require every demo to use a private local log._ Rejected. Some demos are meant
  to prove inclusion, archive retrieval, and public explorer behavior against
  deployed services.
- _Let each example decide without a repo-wide rule._ Rejected. The same
  structural bug class has already appeared through test harness leakage and
  unresolved reference residue, so record treatment needs one shared rule.

**Consequences.**

- Future demo work must state which record class it belongs to.
- Default tests fail loudly on accidental production fetches from the integration
  package.
- Public proof records should be queried as proof artifacts, not mixed into
  unscoped recall summaries about the operator's sessions.
- The same signed record format remains valid across all three classes. The
  difference is governance, endpoints, and interpretation, not cryptographic
  validity.

**Cross-references.**

- [`packages/integration/README.md`](packages/integration/README.md), demo record
  treatment table.
- [`packages/integration/test/setup.ts`](packages/integration/test/setup.ts),
  production endpoint fetch guard.
- [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/),
  live public proof examples.
- [`packages/integration/examples/google-stack-chain/`](packages/integration/examples/google-stack-chain/),
  local deterministic Google proof chain.
- [`packages/integration/examples/proof-log-receipt/`](packages/integration/examples/proof-log-receipt/),
  public proof-log and archive receipt.

---

## D118: Primary trace path is a presentation rule over trace and chain

**Date:** 2026-06-11

**Status:** Accepted

**Extends:** [D054](#d054-unified-public-explorer), [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), [D068](#d068-trace-operations-split-provenance-trace-vs-causal-chain), [D086](#d086-bm25-indexes-all-event-type-content-shapes-not-just-annotations), and [D108](#d108-openinference-is-an-observability-intake-layer-not-a-replacement-trace-store).

**Context.** The TIBET / Humotica review surfaced a real product lesson. A
one-parent token chain is easy to explain and easy to follow. atrib's graph is
more expressive: a record can have a structural chain parent, several
`informed_by` parents, an annotation target, a revision target, a provenance
anchor, a human approval record, capability evidence, and transaction evidence.
That expressiveness is correct for verification, but it makes the first-read
path harder for a human.

[D068](#d068-trace-operations-split-provenance-trace-vs-causal-chain) already
split `/v1/trace/{record_hash}` and `/v1/chain/{record_hash}` because they
answer different questions. `/v1/trace` walks producer-claimed ancestry.
`/v1/chain` walks substrate-derived chain order. Merging those into one
protocol endpoint would blur the structure-vs-claims boundary. Leaving the
dashboard with only a full DAG and a chain list made the opposite mistake: the
human reader had no obvious "read this first" line.

The same review clarified the intent/rationale boundary. TIBET's `erachter`
field makes stated intent visible. atrib can already carry equivalent local
sidecar text, but the implementation did not consistently index or summarize
`intent` and `rationale`. Human approval was also easy to misread: atrib already
supports a human-controlled key signing an ordinary record, as the Cloudflare
approval-trace proof demonstrates, but it does not yet have native human
authorization edge types.

**Decision.**

1. The public explorer trace route now renders a **primary trace path** above
   the full graph.
2. The primary path is computed over the dashboard's merged trace + chain graph,
   not by changing graph-node's APIs.
3. The selection order is deterministic: `INFORMED_BY`, `REVISES`, `ANNOTATES`,
   `PROVENANCE_OF`, then `CHAIN_PRECEDES`. For several resolved parents with
   the same edge type, the newest timestamp wins; ties sort by record hash.
4. The primary path is presentation metadata only. It is not a graph edge, not a
   validity condition, and not an input to settlement calculation.
5. `/v1/trace` and `/v1/chain` remain separate protocol endpoints per [D068](#d068-trace-operations-split-provenance-trace-vs-causal-chain).
6. `_local.content.intent` and `_local.content.rationale` are first-class local
   cognitive fields. Recall indexes them, `atrib-trace` surfaces them in compact
   sidecar summaries, and `atrib-summarize` includes them in prompt input.
7. Human-attested approval or intent is represented now as separate signed
   evidence: a record under a human-controlled `creator_key`, or an archive /
   external evidence block, linked by `informed_by` when it informs a later
   action. Native `APPROVED_BY`, `AUTHORIZED_BY`, `ATTESTED_BY`, or
   `DELEGATED_TO` edges remain deferred under [P004](#p004-human-direct-signing-as-a-first-class-identity-class-post-day-1).

**Alternatives rejected.**

- _Flatten the protocol to a single parent pointer._ Rejected. It would make
  traces easier to explain but would lose real multi-parent structure, including
  human approvals, diagnostics, revisions, and cross-session anchors.
- _Extend `/v1/trace` to also walk `CHAIN_PRECEDES`._ Rejected again for the
  same reason as [D068](#d068-trace-operations-split-provenance-trace-vs-causal-chain):
  producer claims and substrate structure should stay separate at the API
  boundary.
- _Promote human authorization edge types now._ Rejected. The current
  approval-trace pattern already proves separate human signatures and
  `informed_by` continuity. Native edge vocabulary needs real adopter pressure
  because it also brings key-management UX and identity-taxonomy work.
- _Make `intent` or `rationale` validity-critical._ Rejected. Signed intent is
  still a signed claim. It can guide readers and agents, but it does not prove
  sincerity, completeness, or human authorization.

**Consequences.**

- The explorer now borrows TIBET's explanation strength without adopting
  TIBET's one-parent limitation.
- Agents and humans get a stable first-read trace path while auditors can still
  inspect the full multi-edge graph.
- `intent` and `rationale` are useful to recall, trace, and summarize without
  becoming public-log fields.
- Existing human approval support is documented as "separate signed record now;
  native authorization edges later."
- P004 stays pending, but its scope is narrower: first-class human identity
  classes and authorization edge derivation, not basic human signing.

**Cross-references.**

- [§3.4.5](atrib-spec.md#345-get-v1tracerecord_hash), provenance trace.
- [§3.4.6](atrib-spec.md#346-get-v1chainrecord_hash), causal chain.
- [§5.9.3](atrib-spec.md#593-the-_local-sidecar-shape), local sidecar shape.
- [`apps/dashboard/graph-utils.mjs`](apps/dashboard/graph-utils.mjs), primary
  trace path helper.
- [`apps/dashboard/index.html`](apps/dashboard/index.html), explorer trace
  rendering.
- [`packages/mcp/src/content-shapes.ts`](packages/mcp/src/content-shapes.ts),
  recall-readable content extraction.
- [`services/atrib-trace/src/index.ts`](services/atrib-trace/src/index.ts),
  compact sidecar summaries.
- [`services/atrib-summarize/src/prompt.ts`](services/atrib-summarize/src/prompt.ts),
  summary prompt rendering.
- [`packages/integration/examples/cloudflare-agents/approval-trace/`](packages/integration/examples/cloudflare-agents/approval-trace/),
  human approval proof with separate signing keys.
- [`docs/concepts/14-tibet-humotica-crosswalk.md`](docs/concepts/14-tibet-humotica-crosswalk.md),
  TIBET / Humotica comparison.

---

## D119: AAuth evidence stays verifier-side

**Date:** 2026-06-11

**Status:** Accepted

**Extends:** [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks),
[D110](#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop),
[D111](#d111-host-owned-oauth-evidence-infrastructure),
[D115](#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle),
and [D116](#d116-producer-side-informed_by-validation-is-source-aware).

**Context.** AAuth draft -02 defines an agent authorization protocol with
per-instance agent identifiers, HTTP Message Signature proof of possession,
agent/resource/auth tokens, `AAuth-Access`, missions, sub-agents, and Person
Server / Authorization Server governance. It is adjacent to MCP/OAuth evidence,
but it is not the same protocol surface: AAuth models agent identity and
authorization across trust domains, while atrib records signed action history
and durable verifier evidence.

AAuth also names the audit gap atrib can help close. Request-time
authentication proves the request was authorized at that moment. Long-term
audit needs captured verification evidence because keys rotate, tokens expire,
and metadata can change. That evidence belongs beside MCP/OAuth and AP2 / VI
evidence in atrib's verifier layer.

**Decision.** AAuth is a concrete generic authorization evidence adapter under
`evidence[]` with `protocol: "aauth"`. It is not a new atrib `event_type`,
graph edge, directory identity class, payment detector, or settlement input.

`@atrib/verify` verifies caller-supplied AAuth JWTs and JWKS, caller-verified
claims, or decoded claims under an explicit signature policy. It checks token
type, issuer, audience, expiry, resource binding, scopes, agent and subject
constraints, `parent_agent`, `act.sub`, mission references, HTTP Message
Signature facts, `AAuth-Access` `Authorization` coverage, key binding through
`cnf.jwk` or `agent_jkt`, and optional R3 facts. The verifier performs no hidden
network fetches, metadata discovery, token minting, Person Server calls,
Authorization Server calls, or user interaction.

`@atrib/mcp` exposes `buildAAuthEvidenceFromEvent()` as the producer-side bridge
for hosts that already receive AAuth events. The helper accepts TypeScript
`createAAuthFetch()` / `onEvent` shaped callbacks, server verification-result
shapes such as .NET `AAuthVerificationResult`, and Person Server audit-sink
style events. It emits verifier-ready sidecar evidence with decoded token facts,
caller-supplied verification status, HTTP signature facts, configured
constraints, and a one-way token hash when token material is visible. It does
not store raw AAuth JWTs by default.

The offline corpus lives at `spec/conformance/5.5.6/aauth/`. It covers
agent/resource/auth token cases, signature verification, `cnf` binding,
expiry failures, mission and R3 evidence, `AAuth-Access` authorization coverage,
and missing actor claims.

The outreach path is artifact-first. The draft packet lives at
[`docs/outreach/aauth-evidence-packet.md`](docs/outreach/aauth-evidence-packet.md).
No external outreach is implied by this ADR.

**Alternatives rejected.**

- _Create an `aauth_authorization` event type._ Rejected. AAuth authorization is
  external verifier evidence for an action, not a new class of action in the
  atrib log.
- _Treat AAuth as a subtype of MCP/OAuth._ Rejected. It shares the same evidence
  lane, but its token types, access modes, missions, sub-agent fields, and HTTP
  signature binding rules differ enough to deserve a protocol-specific adapter.
- _Let the verifier fetch AAuth metadata and JWKS itself._ Rejected. The generic
  evidence contract keeps network and trust policy host-owned. Hidden fetches
  would make verification harder to reproduce.
- _Persist raw AAuth JWTs by default._ Rejected. Sidecars and archive evidence
  should preserve verifier facts and hashes by default. Raw tokens remain
  caller-owned sensitive material.
- _Lead with a partnership pitch._ Rejected. The useful first contact is a small
  source-backed artifact tied to AAuth's audit and non-repudiation questions.

**Consequences.**

- AAuth evidence can render beside MCP/OAuth and AP2 / VI evidence without
  changing base record validity, graph derivation, or settlement calculation.
- The integration point is stable even if AAuth SDK event names change: producers
  can map any verified callback, verification result, or audit event into the
  same `protocol: "aauth"` evidence shape.
- atrib has a concrete artifact for engaging AAuth maintainers: a verifier
  adapter, conformance corpus, producer capture helper, and route packet.
- Future work should wire the helper into a runnable AAuth TypeScript or .NET
  example before any stronger public claim.

**Cross-references.**

- [§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), generic
  authorization evidence blocks.
- [`packages/verify/src/aauth-evidence.ts`](packages/verify/src/aauth-evidence.ts),
  AAuth evidence verifier.
- [`packages/mcp/src/aauth-evidence.ts`](packages/mcp/src/aauth-evidence.ts),
  producer-side AAuth evidence capture helper.
- [`packages/verify/test/aauth-evidence-conformance.test.ts`](packages/verify/test/aauth-evidence-conformance.test.ts),
  verifier conformance coverage.
- [`packages/mcp/test/aauth-evidence.test.ts`](packages/mcp/test/aauth-evidence.test.ts),
  capture helper coverage.
- [`spec/conformance/5.5.6/aauth/`](spec/conformance/5.5.6/aauth/), offline
  AAuth evidence corpus.
- [`docs/outreach/aauth-evidence-packet.md`](docs/outreach/aauth-evidence-packet.md),
  draft outreach packet.

# Pending decisions

These will get full ADRs when we act on them. Recorded here so they remain findable and don't silently drop. Per the global Deferred Decision Logging convention, this section uses the forward-looking pattern (forward-looking decisions that will become numbered ADRs when codified).

## P009: middleware orphan-flagging consistency with [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail)

**Source:** Audit pass 2026-05-09 after [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) shipped. The middleware's MCP-traffic-handling path in `packages/mcp/src/middleware.ts` synthesizes a `context_id` (random or `stableContextId` under `autoChain`) when no inbound atrib token, no `traceparent`, and no caller value are available. This path produces real per-call records but does NOT mark them with `inheritedFrom = 'fresh-orphan'` because the middleware's signing path doesn't go through `inheritChainContext`.

**The decision in question:** should middleware-side orphans (records produced when MCP \_meta carries no atrib context) get the same `'fresh-orphan'` flag that `inheritChainContext`-driven orphans get? Or is the middleware case structurally different enough that it stays unflagged?

**Considerations.**

- Middleware orphans are usually one-record sessions or autoChain-clustered short sessions, they don't have the absorption pathology that motivated [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail). The absorption-into-existing-chain failure mode is specific to mirror-tail inheritance.
- A consistent flag across all orphan paths would let recall/trace/summarize filter uniformly via `inheritedFrom === 'fresh-orphan'` regardless of producer.
- Adding the flag requires extending the middleware's `ToolCallSigningContext` (or equivalent) to carry the orphan provenance through to the consumer side, since middleware doesn't currently surface a `ChainContext`-shaped result.

**Likely outcome (not committed):** accept; extend middleware to flag orphans. The cost is small (a boolean threading) and the consistency is worth it. Defer until at least one consumer (recall, trace, or substrate-health) actually uses the flag.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P010: sidecar `_local.fallback: 'orphan'` field per [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail)

**Source:** [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) "Alternatives considered" notes that producers MAY add a sidecar `_local.fallback: 'orphan'` field to mark orphan provenance on the local-mirror side. The signed record carries no orphan signal; the producer's runtime context (`inheritedFrom`) is the source of truth consumers need, but it lives in producer memory only.

**The decision in question:** should the local-mirror sidecar shape (per [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) / [§5.9](atrib-spec.md#59-local-mirror-conventions)) gain a normative `fallback: 'orphan' | undefined` field so consumers reading the mirror (atrib-recall, atrib-trace, atrib-summarize) can filter orphans without needing access to the producer's runtime state?

**Considerations.**

- Currently atrib-emit emits the warning at sign time but doesn't write the orphan flag into the sidecar. Consumers reading the mirror have no way to filter orphans even though [D072](#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) says they MAY.
- Adding `fallback` to the [§5.9.3](atrib-spec.md#593-the-_local-sidecar-shape) sidecar table is non-breaking (back-compat tolerates absence per [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)).
- Requires coordinated update across atrib-emit (writer) + atrib-recall + atrib-trace + atrib-summarize (readers, optional default-filter). Per the [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) sync-trigger row, sidecar shape changes require coordinated multi-package work.

**Likely outcome (not committed):** accept; add the field as producer-side convention first, normalize in the spec [§5.9.3](atrib-spec.md#593-the-_local-sidecar-shape) table when at least one consumer uses it.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P002: agent-bridge on atrib substrate

**Source:** Strategic question raised 2026-04-30 ("what if agent-bridge just used atrib for this stuff?"). Use Case 2: verifiable agent-to-agent coordination.

**The decision in question:** rebuild agent-bridge as `atrib-bridge`, a parallel implementation that uses atrib substrate (signed records + Merkle log + directory) instead of Postgres + Supabase as the storage and identity layer. Source becomes `creator_key` (cryptographic, not spoofable). Categories become `event_type` URIs in the agent-bridge namespace. Acks become signed records pointing at posts via `informed_by`. Postgres dependency disappears entirely.

**Strategic implications.** The substrate's reach was under-claimed by the original "verifiable tool calls" positioning. agent-bridge fitting on atrib substrate proves the substrate generalizes to verifiable agent-to-agent coordination. This is a concrete second use case beyond the original wrapper-on-MCP-tool-calls one and a flywheel for atrib adoption (every bridge user becomes an atrib user).

**Staging if accepted.** Build atrib-bridge as parallel implementation; dogfood for weeks; if it works, atrib-backed becomes the open-source default and the original Supabase-backed stays as legacy/development. Slots into the dogfooding sequencing as 6.5 + 6.6 (atrib-bridge prototype + atrib-bridge SKILL.md), after cross-session graph viz lands.

**Likely outcome (not committed):** accept; build the parallel implementation; let dogfood prove it out. The architectural and strategic case is strong; the open question is purely capacity (multi-week effort).

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P004: human-direct signing as a first-class identity class (post-day-1)

**Source:** Signer-taxonomy design pass 2026-04-30, design question #8 (resolved: humans-direct allowed, post-day-1).

**The decision in question:** humans signing atrib records directly (distinct from agent-direction-of-human). Edge types to model the relationship: `AUTHORIZED_BY` (human → agent record), `ATTESTED_BY` (human → claim), `APPROVED_BY` (human → decision), `DELEGATED_TO` (human → agent). Spec changes: new edge types in [§3.2.3](atrib-spec.md#323-edge-types) + derivation rules in [§3.2.4](atrib-spec.md#324-edge-derivation-rules). Identity-resolution changes: humans get a distinct `claim_type` (currently `self_attested` covers both).

**Current baseline after [D118](#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain):** a human-controlled key can already sign an ordinary atrib record. The Cloudflare approval-trace proof uses this pattern: agent proposal, human approval, action MCP execution, and outcome records use separate signing keys, and execution points at the human approval record through `informed_by`. P004 is about native human identity classes and authorization edge derivation, not basic signing support.

**Why deferred.** Day 1 dogfood doesn't require it. Compliance-shaped use cases (regulator wants on-graph proof of human authorization) need it; we're not pursuing those use cases yet.

**Reopening criteria.** First adopter that needs cryptographic distinction between "human authorized" and "agent did this autonomously." Likely candidates: payment-protocol counterparties, regulated financial actions, healthcare-adjacent automation.

**Likely outcome when acted on:** the spec changes are small (new edge types + derivation rules + claim_type extension); the operational change is bigger (humans need their own keys, key management UX, distinguishing identity from agent identities they direct). Defer until a real use case forces the operational work.

**ADR number** will be assigned when acted on.

## P005: reconcile @atrib/verify README per-record annotations with actual code surface

**Source:** Audit during sign*record decoupling. The package README documented per-record annotations on the result object (`informed_by_resolution`, `provenance`, `capability_check`, `cross_attestation`, `cross_log*\*`, posture detection) without corresponding code surface.

**Status:** mostly codified per-feature. This entry is now a router stub; the substantive design lives in the per-feature ADRs.

**Codified surfaces:**

- `provenance`, shipped via `verifyRecord(record, options)` + `spec/conformance/1.2.6/` corpus. Tracked under [D044](#d044-provenance_token-field-for-cross-session-causal-anchoring).
- `informed_by_resolution`, `verifyRecord` populates `{ resolved, dangling }` from caller-supplied candidates. Tracked under [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type).
- `posture` (timestamp_granularity, args_commitment_form, result_commitment_form), `verifyRecord` always populates these per [D045](#d045-privacy-postures-normative-spec-section).
- `tool_name_form` ([§8.2](atrib-spec.md#82-opaque-name-posture)), `'hashed' | 'plain' | null`. Tracked under [D061](#d061-add-tool_name-args_hash-result_hash-fields-to-§121).
- `capability_check`, `{ envelope, in_envelope, mismatches, unresolvable }` when caller passes a resolved `identityClaim`. Tracked under [D051](#d051-capability-scoped-records-via-directory-published-envelopes).
- `cross_attestation` (transaction records), `{ signers_count, signers_valid, missing }` per [D052](#d052-cross-attestation-requirement-for-transaction-records).

**Remaining work tracked separately:**

- **Middleware-side multi-signer transaction signing**: `@atrib/mcp` currently signs transaction records with the standard single-signer path. Producing records with `signers[]` populated requires a counterparty-coordination protocol design (out-of-band? webhook? sign-then-merge?). Will be a follow-up ADR alongside the first protocol-adapter that needs it.
- **`cross_log_*` verifier surface ([D050](#d050-cross-log-replication-for-equivocation-defense) / [§2.11](atrib-spec.md#211-cross-log-replication))**, BLOCKED on multi-log proof-bundle parsing infrastructure and a trusted-log-set config surface. No code surface added; the README's documented annotation remains aspirational. Will be re-opened when a second independent log node ships.

**Pattern observed during the rollout.** Surfaces with constraint inputs already on the record (or supplied by the caller via the `identityClaim` option) implemented cleanly. Surfaces that needed new fields on the canonical record shape (tool_name, args_hash, result_hash) required upstream spec work first ([D061](#d061-add-tool_name-args_hash-result_hash-fields-to-§121)). The pattern set by [D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)'s reconciliation (verify-record.ts + spec/conformance/<§> + verify test) is reusable for any remaining annotation when a real consumer surfaces.

**Reopening criteria.** First external verifier integrator hitting either of the two remaining gaps OR a new annotation surface that doesn't yet have an ADR. Open the per-feature ADR at that point and update this stub with a backlink.

## P008: referent-matched revision and annotation emission from the cognitive extractor

**Source:** [D063](#d063-canonical-event_type-examples-and-selection-tree) added canonical examples and a selection tree distinguishing observation / annotation / revision by structural referent. A cognitive-extractor producer pattern (Mem0-style post-hoc transcript extraction) closes the runtime observation gap, but emits all detected events as `event_type=observation` even when the LLM's classification suggests revision or annotation. The reason: revision REQUIRES `revises: "sha256:<hex>"` per [§1.2.9](atrib-spec.md#129-revises) and annotation REQUIRES `annotates: "sha256:<hex>"` per [§1.2.7](atrib-spec.md#127-annotates), but the extractor doesn't know which prior signed record carries the position being revised or the target being annotated. Without referent matching, emitting with the structurally-correct event_type would either (a) violate the spec's REQUIRES constraints or (b) attach a fabricated/hallucinated hash, both unacceptable.

The MVP preserves the LLM's classification as `extractor_classification` in the observation content (NOT as a `kind` field, the field name is intentional, signaling "this is the extractor's inference, not a spec-level event_type claim"). Consumers reading the record see `event_type=observation` on the wire and the extractor's classification in content; nothing in the record claims to be a revision/annotation while violating [§1.2.9](atrib-spec.md#129-revises)/[§1.2.7](atrib-spec.md#127-annotates).

**Why deferred:** referent matching is a search problem, not a generation problem. The LLM identifies "agent revised X to Y" but cannot generate `revises=<hash>` because it doesn't know which signed record carries X. Solving requires either (a) scoping candidates to recent records the agent could plausibly be revising/annotating and passing the candidate set to the LLM in a second pass, or (b) building a vector-search index over the operator's signed records and pre-filtering candidates by semantic similarity. Both add machinery the MVP didn't justify before observation extraction was proven stable.

**Why this is a follow-up, not a blocker:**

- The MVP closes the biggest gap (no automated path for in-the-moment observations) without the harder referent-matching problem. SRA-Bench-style "absence of need-aware skill invocation" symptoms are partly addressed by transcript extraction; revisions and annotations remain in the residual judgment-discipline tier until referent matching ships.
- The on-the-wire shape is honest: every cognitive-extractor record carries `event_type=observation`. Nothing pretends to be a revision or annotation while missing the spec-required referent.
- Downstream consumers (graph viz, recall, atrib-summarize) can already render visual distinction by reading `extractor_classification` from the sidecar, even before spec-level event_type emission ships.

**The right path when acted on:**

The spec posture remains unchanged: [§1.2.7](atrib-spec.md#127-annotates) and [§1.2.9](atrib-spec.md#129-revises) already require referents; the extractor will emit revision or annotation event_types only when a valid referent is confirmed.

Implement hash-by-context-window referent matching: scope candidates to recent records in the active chain, pass the candidate set to the extractor LLM in a second pass with `record_hash + brief summary` per candidate, validate that the LLM's chosen hash is in the candidate list before emitting. Reject hallucinated hashes.

Consider vector-search-backed referent matching as a future optimization if scale demands it; the in-context-window approach becomes less effective beyond ~50 candidate records, though typical lifecycle windows are 5–30 records.

When an extracted event has a solid referent, the LLM selected a hash from the candidate list and confirmed its match, emit with `event_type=revision` or `event_type=annotation` and the proper top-level field. Otherwise, retain the observation-emission path.

The `extractor_classification` field is redundant for records where event_type is promoted to revision or annotation. Retain it only on observation-emission records to preserve disambiguation, and remove it from revision/annotation records to avoid conflicting signals.

**How to apply:** Schedule alongside the next graph-viz iteration that needs revision/annotation visual distinction. The MVP ensures the data shape remains compliant (`extractor_classification` is an honest signal, observation event_type doesn't violate spec) so the referent-matching work can be sequenced when there's a consumer demanding spec-level event_type fidelity.

**ADR number** will be assigned when acted on.

## P012: New runtime integration pattern - Multi-agent orchestrator (orchestrator queries atrib for worker capability + cross-attestation status before delegating)

**Source:** external research analysis from May 2026 (publicly cited architecture patterns from Anthropic and EveryDev). Anthropic's "Multi-agent Research System" essay validates the orchestrator-worker shape (90.2% performance gain at 15x token cost). Their CitationAgent provides operator-trusted attribution for cross-agent reasoning. atrib has the substrate primitives ([D052](#d052-cross-attestation-requirement-for-transaction-records) cross-attestation, [D051](#d051-capability-scoped-records-via-directory-published-envelopes) capability envelopes, [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) informed_by, [D067](#d067-multi-producer-chain-composition-precedence-contract) chain composition, production substrate with 8 distinct signers) but no normative pattern in [§9](atrib-spec.md#9-runtime-integration-patterns) documenting how an orchestrator should consume them at delegation time.

**The decision in question:** add a new pattern to [§9](atrib-spec.md#9-runtime-integration-patterns) documenting the multi-agent orchestrator pattern: orchestrator queries the atrib log for worker capability declarations (per [§6.7](atrib-spec.md#67-capability-declarations)) + cross-attestation count (per [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)) + revocation status (per [§1.9](atrib-spec.md#19-key-rotation-and-revocation)) BEFORE delegating a task to that worker. The pattern is the cryptographic version of CitationAgent's attribution: workers' track records become independently auditable, not vendor-asserted.

**Considerations.**

- The substrate primitives are all shipped; this is a pattern documentation + reference example, not a substrate change.
- Maps cleanly to a previously-explored multi-agent orchestrator pattern (trust-or-don't routing); the spec section becomes the normative description and the prior exploration becomes the empirical validation.
- A reference example (synthetic orchestrator + 2 workers, one honest one Sybil; orchestrator catches Sybil via atrib gating) is planned for the public demo repository.
- Composes with [D067](#d067-multi-producer-chain-composition-precedence-contract) chain composition (each worker produces records under its own creator_key; chain-root resolution lets the orchestrator trace cross-agent provenance).
- Composes with [P013](#p013-new-runtime-integration-pattern---hosted-runtime-adapter-sign-events-stored-by-hosted-runtimes-like-anthropic-managed-agents) (a hosted-runtime adapter signing events under its agent's atrib key produces the substrate this pattern queries).

**Likely outcome (not committed):** accept; ship a new [§9](atrib-spec.md#9-runtime-integration-patterns) pattern section paired with the reference orchestrator-gating demo. The substrate is structurally there; the gap is purely normative + tooling.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P013: New runtime integration pattern - Hosted-runtime adapter (sign events stored by hosted runtimes like Anthropic Managed Agents)

**Source:** external research analysis from May 2026 (publicly cited architecture patterns from Anthropic and EveryDev). Anthropic's "Managed Agents" essay decomposes hosted long-horizon agent infrastructure into three explicit layers (harness + sandbox + session log) with the session log queryable via `getEvents()` positional slices. This is direct external validation of atrib's substrate-as-distinct-layer architecture, with one critical addition: Anthropic's session log is operator-trusted; atrib's would be operator-INDEPENDENT (signed by the agent's own key).

**The decision in question:** add a new pattern to [§9](atrib-spec.md#9-runtime-integration-patterns) documenting the hosted-runtime adapter pattern: an adapter consumes the runtime's session-log API (Anthropic Managed Agents `getEvents()`, LangSmith Deployment threads, Mastra Platform Server, Inngest step replays) and signs each event under the agent's atrib key, producing a verifiable trajectory parallel to the operator-trusted log.

**Considerations.**

- This is a new integration pattern not covered by the shipped [§9](atrib-spec.md#9-runtime-integration-patterns) patterns. Pattern #4 OpenInference is the closest, but operates on real-time spans, not post-hoc API events.
- A reference adapter for Anthropic Managed Agents is planned for public release; it demonstrates how hosted-runtime customers can adopt atrib with one npm install.
- Pattern composes with [P012](#p012-new-runtime-integration-pattern---multi-agent-orchestrator-orchestrator-queries-atrib-for-worker-capability--cross-attestation-status-before-delegating) (a hosted-runtime adapter is a substrate producer; orchestrators built on top can query the substrate the adapter produces).
- Composes with [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) when the hosted runtime extracts events from a sandboxed worker. The signing key must live outside the sandbox per [§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution).
- Each runtime adapter is independent; ADR codifies the pattern, not any specific adapter.

**Likely outcome (not committed):** accept when the first hosted-runtime adapter ships. Likely first: Anthropic Managed Agents (richest API surface, direct architectural alignment with atrib's three-layer model).

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P016: Foundations positioning extension - atrib's location below Loop / Runtime / Sandbox (EveryDev mapping)

**Source:** external research analysis from May 2026 (publicly cited architecture patterns from Anthropic and EveryDev). EveryDev's three-layer Loop / Runtime / Sandbox decomposition (May 2026, the cleanest published mapping of the TS agent ecosystem) provides a precise external taxonomy for atrib's structural position. Anthropic's "Managed Agents" essay independently arrives at the same architectural shape (harness + sandbox + session log decomposed). The substrate-as-distinct-layer architecture is externally validated; the spec's [§0](atrib-spec.md#0-foundations) does not yet land this positioning explicitly.

**The decision in question:** add a subsection to [§0](atrib-spec.md#0-foundations) ("Where atrib sits in the agent stack" or similar) documenting the Loop / Runtime / Sandbox / atrib-substrate mapping. atrib is below all three layers as the verifiable trajectory substrate that any combination produces records into. The mapping makes the architectural positioning recognizable to anyone in the harness-engineering community, and gives the locked positioning ("verifiable agent actions / every action becomes signed context for the next / agents that reason from a past they can prove") an external structural anchor.

**Considerations.**

- The locked headline positioning is unchanged. This is a positioning EXTENSION, not a positioning shift.
- [§0](atrib-spec.md#0-foundations) is informative; this addition is non-breaking.
- Section should reference the EveryDev essay (TypeScript Agent Frameworks in 2026, May 2026) as the external taxonomy source AND the Anthropic Managed Agents essay (March 2026) as the architectural-alignment evidence.
- Useful for future positioning content: blog posts, public-flip-eligible documentation, the eventual `atrib/ROADMAP.md` public-facing roadmap.

**Likely outcome (not committed):** accept; small spec addition. Schedule alongside the next public-facing documentation cycle since the section becomes most-leveraged on public-facing surfaces.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P017: Environment isolation (sandboxing) as boundary-trust complement to atrib's trajectory-trust

**Source:** external research analysis from May 2026 (publicly cited architecture patterns from Anthropic and EveryDev). The current [§8.7](atrib-spec.md#87-adversarial-threat-model) adversarial threat model enumerates a 10-layer trust stack (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, cross-log replication, structural anomaly detection). The Anthropic Sandboxing essay describes a complementary trust dimension: **environment isolation** (filesystem isolation + network proxy + credential separation). The cleanest single-line "what atrib uniquely provides" framing acquired in the arc: _"Sandboxing handles boundary-trust; atrib handles trajectory-trust. They compose orthogonally; neither replaces the other."_ The [§8.7](atrib-spec.md#87-adversarial-threat-model) stack does not currently surface this complement.

**The decision in question:** add a Layer 11 entry to [§8.7](atrib-spec.md#87-adversarial-threat-model): **environment isolation (sandboxing)** as the boundary-trust layer complementing atrib's trajectory-trust. The new layer is INFORMATIVE (it is not an internal trust mechanism for atrib); it documents the orthogonal composition with sandboxing primitives (Claude Code sandboxing, Daytona, E2B, Sandcastle, Anthropic Managed Agents containerization, etc.) and clarifies that an adversarial-environment-aware verifier can EITHER (a) require evidence the producer ran in a known-isolated environment via attestation, OR (b) tolerate unisolated environments and rely on atrib's existing 10 layers.

**Considerations.**

- [§8.7](atrib-spec.md#87-adversarial-threat-model) currently does NOT have an environment-isolation layer; the trust stack reads as if atrib alone bears the entire verification burden, which is structurally incorrect.
- The new layer is informative; it documents the complement, not a new internal mechanism.
- Composes naturally with [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox), which shipped sandboxed-execution signer proxy composition and the signing-key isolation MUST.
- Should reference the Sandboxing essay's specific architectural primitives (bubblewrap, seatbelt, proxy) and atrib's role as the trajectory-trust complement.

**Likely outcome (not committed):** accept; small informative spec addition. Pairs with [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) and [P016](#p016-foundations-positioning-extension---atribs-location-below-loop--runtime--sandbox-everydev-mapping). The signer-proxy example demonstrates the composition.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P018: Adopt Inspect AI as the Track B harness baseline

**Source:** evals landscape research from May 2026 (publicly cited frameworks from UK AISI and the broader 2026 agent-eval ecosystem). UK AISI's `UKGovernmentBEIS/inspect_ai` is the convergent open-source agent-eval harness as of mid-2026 (MIT, 5,571 commits, 200+ pre-built evals in the companion `inspect_evals` registry). It supports running Claude Code / Codex CLI as agent subjects, which is the integration shape Track B needs for the redesigned Pattern 1 v2 experiment.

**The decision in question:** standardize on Inspect AI as the harness layer for Track B Pattern 1 v2 (and subsequent Track B patterns), replacing earlier bespoke scaffolding. The atrib MCP wrapper sits underneath; Inspect orchestrates the agent, runs the task, scores the result. Specific commitment: pilot one task before committing fully (Inspect's agent-as-subject API may have rough edges with the atrib MCP wrapper).

**Considerations.**

- AISI maintenance signal is strong (5,571 commits, active releases). Reference harness for the broader 2026 agent-eval consensus.
- Cleanly separates atrib's substrate from the eval logic above it. Inspect handles the run loop, sandboxing, scoring; atrib handles the trajectory recording.
- Legible to external reviewers (AISI is the UK government's AI Safety Institute; their tooling is the closest thing to a regulatory-grade reference).
- Alternatives rejected: bespoke harness (slow, less legible), Promptfoo (CLI-first, less expressive for trajectory eval), DeepEval (Python-only; atrib's current implementation footprint is TypeScript).
- Risk: API rough edges; pilot one task (the lowest-effort Pattern 1 v2 sub-task) before committing the full experiment.

**Likely outcome (not committed):** accept when E1 lands. The pilot validates the integration; full Pattern 1 v2 then runs on Inspect.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P021: Publish a behavior-impact paired benchmark suite as an atrib artifact

**Source:** evals landscape research from May 2026 (publicly cited model from SWE-bench / Terminal-Bench 2.0 / RE-Bench / GAIA leaderboards; specifically the lessons of the April 2026 contamination collapse). After Track B Pattern 1 v2 produces a non-null behavior-impact result, the next leverage point is converting that result into a publishable benchmark suite (Suite B) that any operator can run themselves to measure substrate-impact on their own agent stack.

**The decision in question:** publish a curated paired-comparison behavior-impact benchmark (Suite B) as an atrib artifact. Each task is run twice (with-atrib vs without-atrib); the Suite reports pass^k delta. Cadence: quarterly snapshots with 30% task rotation (resists the contamination problem that broke SWE-bench Verified). The Suite's results are themselves verifiable atrib trajectories; the substrate validates itself.

**Considerations.**

- Eval-as-product surface; atrib's answer to SWE-bench Pro / Terminal-Bench 2.0 / RE-Bench in the publishable-benchmark space.
- Resists the April 2026 contamination collapse by design (rotation + pre-published schedule).
- Publishable artifact that operators can run, cite, and verify independently. Strengthens the verifiability story (the benchmark itself is signed).
- Defer until E1-E5 have landed AND at least one Track B success has been published. Premature publication risks publishing a NULL or negative result, which is the wrong sequencing.
- Alternative rejected: rely on existing benchmarks. None of them measure substrate-impact in a way that's robust to contamination.

**Likely outcome (not committed):** accept when E6 ships. Approximately 2-3 weeks of focused work for the first quarterly snapshot.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P024: Embedded spec viewer at atrib.dev (auto-updated from spec source)

**Source:** Reader-experience gap surfaced 2026-05-13 when README links pointing at `atrib-spec.md` rendered correctly on GitHub (relative path resolves to the same repo) but 404'd on npmjs.com (resolved to `npmjs.com/atrib-spec.md...`). The immediate fix landed as commit `03c70eb`: convert all relative spec / DECISIONS links to absolute GitHub URLs. This works but kicks readers out to GitHub by default. The spec deserves a permanent canonical URL that doesn't depend on GitHub being the host.

**The decision in question:** host the spec at `https://atrib.dev/spec` (or `https://docs.atrib.dev`) as an embedded markdown viewer. The viewer renders the same markdown source that lives in the repo, auto-publishes on push to main, and exposes a stable URL pattern (`/spec`, `/spec#section-id`) that READMEs and external citations link to instead of GitHub.

**Considerations.**

- Eliminates the GitHub-kickout for npm visitors. README links resolve to a viewer hosted on the project's own domain.
- Auto-publish removes drift between "what's on GitHub" and "what the linked viewer shows". Push to main triggers a GitHub Actions job that re-renders the spec into the viewer's static assets and deploys.
- Stable URL pattern: `/spec` for the document; `/spec#124-event_type-values` for a specific section. Matches how the spec markdown structures anchors at present (kebab-cased headings).
- Embeddable: the viewer renders inside `atrib.dev`'s normal navigation, so readers see the project context (homepage, dashboard link, explorer link) alongside the spec. Better orientation than GitHub's raw markdown view.
- Implementation candidates: (a) a static-site generator pass (mdBook, Docusaurus, VitePress) that builds on every main push; (b) a runtime markdown renderer on a Cloudflare Worker fetching the raw spec from GitHub on-demand (with cache invalidation on push); (c) a Vercel deployment of the same.
- Alternative rejected: pure GitHub viewer (current state). Works but kicks readers to a third-party platform and exposes the rest of the atrib repo's directory listing. Not the canonical-URL experience.
- Alternative rejected: PDF spec at `/spec.pdf`. Loses the section-anchor URL pattern that makes references useful (`#129-revises`, `#324-edge-derivation-rules`); breaks search.

**Likely outcome (not committed):** accept after Track B Pattern 1 v2 produces a non-null result and the spec stabilizes enough that the auto-publish doesn't break links daily. Implementation effort: roughly 1-2 days for the static-site generator option plus the deploy pipeline.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P026: Multi-creator awareness in SessionStart context surface

**Source:** Fidelity audit of multi-creator context requirements in atrib's agent-facing surface, specifically the SessionStart boot-context block. The Layer 1 context surface presently shows records signed under a single creator_key. As atrib multi-agent flows ship (Pattern 3) and cross-agent verification becomes routine, SessionStart should also surface records from other creator_keys whose work is relevant to the boot-time work context, so the agent boots into a multi-signer view, not just its own past.

**The decision in question:** add a "multi-creator context" block to SessionStart that surfaces (a) records from trusted-set creator_keys whose topics overlap with the boot-time work context, (b) cross-attestation records ([D052](#d052-cross-attestation-requirement-for-transaction-records)) signed alongside, (c) handoff records ([D073](#d073-handoff-event_type-byte-placeholder-adr)) involving the booting agent. The single-creator surface is sufficient until those flows produce daily-traffic volume; promoting now would surface mostly-empty blocks and add hook complexity without payoff.

**Considerations.**

- Current practice during the single-agent phase is effectively single-signer: write primitives fire under one creator_key, and read primitives mostly consume that same local mirror. The substrate is multi-signer-capable, but routine work is only beginning to use it.
- The hook reads from local mirror files. Multi-creator context would require either: (i) shipping the trusted-set's records to the local mirror via subscription, (ii) on-boot fetch from log.atrib.dev filtered by creator_key set + topics. [D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields) supplies the single-key subscription surface, but trusted-set selection and topic-aware multi-key filtering remain open.
- The "trusted set" is itself a design question: operator-curated allowlist? directory-anchored claims? Pattern-3 flow participants only? No standard answer until multi-agent flow shape stabilizes.
- Topic-aware filtering (already shipped in Block 3b/3d) extends naturally to multi-creator records, same scoring function, just a wider record source.

**Likely outcome (not committed):** ship this when at least one of the following is real: (i) Pattern 3 multi-agent flow active in production, (ii) [D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields) grows trusted-set or multi-key filters, (iii) an agent regularly operates in contexts where another agent's signed history is relevant to boot-time state. Until then, the single-creator surface is canonical.

**Cross-references.**

- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), the primitive surface whose boot-time context this would extend across creator_keys.
- [D052](#d052-cross-attestation-requirement-for-transaction-records), cross-attestation records this would surface.
- [D073](#d073-handoff-event_type-byte-placeholder-adr), handoff event_type placeholder; multi-creator session resume is the canonical handoff consumer case.
- [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), verify promotion; Pattern 3 now triggers the multi-creator context question too.
- [D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields), subscription surface; shipped single-key dependency.
- [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash), parent-child agent representation; multi-creator boot context is the read-side analogue.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P027: Deployment architecture for host-side hook helpers, symlink-from-repo vs published CLI

**Source:** Substrate-signing outage caused by a host-side hook helper losing access to its npm dependencies when the user-level symlink got redirected into a git worktree directory without a sibling `node_modules`. The outage was silent (the hook's stdout was 0; the detached helper crashed with `ERR_MODULE_NOT_FOUND` against `@modelcontextprotocol/sdk` and produced no records). The proximate fix was an installer guardrail refusing worktree paths; the underlying architecture coupling remains.

The structural shape under Position 1: hook source files live in a deployment-side repo at `tools/claude-hooks/*.mjs`; the host points `~/.claude/scripts/<name>.mjs` symlinks at them; Node resolves their imports by walking up from each file's realpath looking for `node_modules`. Three implicit assumptions are co-dependent, (1) the realpath neighborhood carries the dependency install, (2) Node's CommonJS-style upward resolution remains stable, (3) symlinks never get redirected to a tree without the install. Any one breaking produces silent helper death because hooks fire detached and their failure modes are observable only in `~/.atrib/logs/mcp-signer.log` at boot-time substrate-health checks, not at fault time.

The deeper conflation: the repo simultaneously holds the _source of truth for helper code_ (where developers edit + version-control) and the _runtime deployment_ (what hooks actually execute). Edit-in-place via symlinks is good for iteration; the same symlinks are the runtime's source of fragility.

**The decision in question:** which deployment architecture for host-side hook helpers (the operator-installable thin glue between Claude Code / Cursor / similar host PostToolUse-style hooks and atrib's MCP signing servers):

1. **Symlink-from-repo (status quo + installer guardrails).** Source lives in the repo's `tools/claude-hooks/`; user-level install creates symlinks pointing at the repo. Dependencies install once at the source location's sibling `node_modules`. Installer refuses to point symlinks at worktree paths (the catch added after the outage above). Edits propagate live; dev velocity high; deployment surface coupled to repo-checkout shape.
2. **Published CLI (`@atrib/cli` on npm).** atrib publishes a unified CLI with subcommands `atrib emit`, `atrib recall`, `atrib trace`, `atrib summarize`, `atrib annotate`, `atrib revise` (each subcommand backed by the corresponding `@atrib/<primitive>` package's signing logic). Operators install once: `npm install -g @atrib/cli`. Hook scripts under `~/.claude/scripts/` become ~10-line shell wrappers that `exec atrib emit --hook-mode < stdin`. The CLI is the runtime; the repo's `tools/claude-hooks/` retains source-of-truth for development but is no longer the deployment surface. Standard pattern matching `gh`, `tailwind`, `prettier`, the OpenTelemetry collector, etc.
3. **Hybrid.** Keep `tools/claude-hooks/` for atrib-developers self-hosting (preserves edit-in-place velocity during atrib's own iteration). Publish the CLI for external operators. Two installation paths documented separately. Higher maintenance, two delivery channels for the same logic, but avoids forcing the velocity sacrifice while atrib's substrate is still rapidly iterating.

**Considerations.**

- The edit-in-place pattern (Position 1) is genuinely useful when atrib's substrate is being iterated in parallel with the hook layer. A typical iteration edits both a primitive's source AND the hook that integrates it, and live symlink propagation means subsequent invocations exercise the edits without a republish step. Position 2 forces a build-publish-reinstall loop into that cycle, real velocity cost, not theoretical.
- Position 1's resilience scales poorly: every new helper introduces another dependency tree to manage. Migration cost compounds the longer Position 1 stays canonical. The current helper count (~8) is small enough to make migration cheap; a future world with 20+ helpers makes it large.
- Position 2's resilience pattern is what every production-grade CLI tool converges on, published binary, stable PATH entry, integration shims are thin. Protocol-evolution risk (MCP spec changes, transport changes, signing-pipeline updates) absorbs into the CLI as one versioned surface instead of distributing across N helpers each carrying their own SDK pin.
- Position 3 sounds like the diplomat's answer but doubles the surface area atrib has to keep working. Two installation paths means two failure modes and two sets of operator-facing docs. The maintenance tax is real.
- Spec evolution (e.g., a future MCP transport change, or [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback)'s daemon mode landing) is easier to roll out across consumers when the consumers are versioned packages (Position 2) than when they're filesystem-anchored source files (Position 1).
- The outage that prompted this ADR was silent for ~30 minutes; substrate-health visibility surfaces these gaps only at session boot. Failure handling matters more as atrib's substrate starts supporting verifiable-reasoning claims in real-world flows such as Pattern 3 multi-agent handoff verification.

**Current posture:** Position 1 (status quo with installer guardrail). The substrate-signing-outage forensics produced exactly the kind of guardrail that closes the immediate failure mode (refuse-to-install-from-worktree). Position 1 is acceptable while atrib's substrate is in rapid iteration with a small developer surface.

**Promotion path to Position 2.** Migrate when at least one of the following becomes true:

1. **First external operator onboards** to atrib-as-substrate (not as repo), symlink-from-repo doesn't generalize across operator machines and becomes a friction point.
2. **Helper count crosses ~10**, OR a new helper's dependency tree conflicts with an existing one. Per-helper dependency management becomes the dominant cost.
3. **Protocol evolution churn**: MCP transport or signing-pipeline changes start producing version-coordination drift across helpers. Centralizing the protocol surface in one published CLI flips from "nice to have" to "needed for substrate stability."
4. **A second silent outage** of the same class (hook helpers die without surfacing the failure to running sessions). One occurrence is operationally tolerable with the guardrail; a second indicates the architecture itself is the problem.

**When promotion happens.** Ship `@atrib/cli` covering all seven cognitive primitives as subcommands; replace `tools/claude-hooks/atrib-tool-emit-helper.mjs` and `atrib-tool-signer-hook.mjs` and the lifecycle helpers with thin shell scripts that exec the CLI; update the installer to drop the symlink-into-repo path entirely (in favor of `npm install -g @atrib/cli` as the single install step); deprecate the `tools/claude-hooks/node_modules/` sibling-install pattern. Keep `tools/claude-hooks/` as source for atrib-development.

**Alternatives rejected.**

- _Drop the SDK dependency from helpers entirely and hand-roll JSON-RPC._ Considered as a tactical mid-step. Rejected: shifts protocol-surface fragility from "one SDK version pinned" to "every helper maintains its own JSON-RPC client." Doesn't scale across helpers; doesn't address the deployment-architecture coupling that caused the outage.
- _Bundle each helper into a single-file artifact via esbuild._ Considered. Rejected: adds a build step without addressing the source-vs-deployment conflation; bundle drift between editable source and shipped artifact creates its own class of "what's actually running?" confusion.
- _Promote to Position 2 immediately, accepting the velocity cost._ Rejected for the current iteration phase. The substrate is changing fast enough that the build-publish-reinstall loop would slow forward progress without commensurate operational payoff yet.

**Consequences.**

- Position 1 remains canonical until a promotion gate trips. The installer-guardrail closes the worst foot-gun; further fragility is documented but not chased.
- When Position 2 ships, hooks become host-independent: the same `~/.claude/scripts/atrib-tool-signer-hook.sh` script works on Cursor's hook surface (if Cursor's hooks are stdio-compatible), Codex CLI's, Zed's ACP, because the integration is "exec a stable command on PATH" rather than "symlink a source file with sibling node_modules."
- A successful migration also addresses [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash)'s deployment concern (env-driven `informed_by` threading needs the receiver MCP server reachable from any subprocess; a published CLI on PATH satisfies that uniformly).

**Cross-references.**

- [D069](#d069-runtime-integration-patterns--first-class-peers-no-canonical-path), runtime integration patterns; Position 2's "hooks-call-CLI" pattern fits naturally as the canonical Pattern #2-equivalent (in-process MCP middleware) deployment shape.
- [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), long-lived emit daemon; the daemon's wire format is unchanged across Position 1 vs Position 2 (both invoke atrib-emit; only how the binary is located differs). Migration is independent.
- [D106](#d106-verify-is-promoted-to-cognitive-primitive-7), verify promotion: Position 2 makes `atrib verify` a normal CLI subcommand rather than a new helper plus `node_modules`.
- [D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields), subscription surface; the always-on consumer pattern benefits from a stable CLI deployment for the same reasons.
- [D104](#d104-parent-child-threading-uses-atrib_parent_record_hash), parent-child env threading; benefits from PATH-resolved CLI per consequences above.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P036: Cross-harness continuation packet for support/RCA investigations

**Source:** John Yeo / Autumn support-investigation case study, May 2026 (`https://useautumn.com/blog/building-an-ai-agent-to-investigate-support-tickets`). The post describes a real workflow where structured request logs, Claude Code, Axiom MCP, and domain skills make local investigations effective, while a hosted Slack-facing agent loses quality when MCP auth, skill loading, and codebase context drift from the local harness. The key product implication for atrib: the public Merkle log proves commitments, but the local continuation agent needs record bodies, redacted evidence, skill versions, latest chain tail, and provenance anchors.

**The decision in question:** should atrib standardize an informative cross-harness continuation packet pattern for workflows that begin in one harness and continue in another, especially support, incident, billing, and RCA investigations?

The packet would carry:

- Upstream anchors: `context_id`, latest `record_hash`, latest chain tail, and `provenance_token` guidance for a fresh receiving trace.
- Body access: local mirror bundle, archive references, or both for the record bodies the receiver may need.
- Redacted evidence: ticket ids, tenant context, request/response body references, tenant-scoped log-query references, code-read references, support-thread references, diagnostic outputs, and external-system references with hashes and scopes.
- Skill and domain context: skill pack names, versions, hashes, and domain reference docs.
- Runtime diagnostics: tool availability, MCP auth state, skill-loading state, hosted memory and filesystem status, codebase checkout identity, and hosted-agent capability failures.
- Privacy posture: which bodies and evidence are public, archived, local-only, salted, redacted, or withheld.

**Considerations.**

- This is a harness-consumption pattern in [§7](atrib-spec.md#7-harness-integration-patterns), not a new [§9](atrib-spec.md#9-runtime-integration-patterns) runtime-mounting pattern.
- Tier 1 public log proof is not enough for continuation. It proves a record existed, not what the receiving agent needs to inspect. Tier 2 body retrieval and Tier 3 signature replay remain necessary.
- The packet should not collapse the Record Body Archive Layer into the log. [D070](#d070-record-body-archive-layer)'s separation remains the rule that preserves the privacy posture.
- The packet can be private support-system metadata, a harness-specific extension record such as `https://example.com/v1/types/continuation_packet`, or both. A normative event_type is premature.
- Existing cognitive primitives are sufficient. The receiving agent uses `recall`, `trace`, and `summarize` to read, then `emit`, `annotate`, and `revise` to continue.
- Interaction channels are evidence, not the substrate. Plain-style webhooks, Slack threads, and local Claude Code or Codex sessions can carry the packet, but atrib should only prove the signed trail and anchors.

**Likely outcome (not committed):** accept as an informative [§7](atrib-spec.md#7-harness-integration-patterns) pattern first. Build a support/RCA demo before deciding whether any fields deserve normative status or conformance vectors.

**Cross-references.**

- [§7.8](atrib-spec.md#78-cross-harness-continuation-packets), informative continuation-packet pattern.
- [D070](#d070-record-body-archive-layer), Record Body Archive Layer.
- [D087](#d087-signed-diagnostic-outcome--causal-trace-replay), signed diagnostic outcome pattern.
- [P037](#p037-skill-and-domain-context-provenance-for-agent-investigations), skill/context provenance.
- [P038](#p038-hosted-agent-diagnostic-records-for-mcp-auth-skill-loading-and-code-context-gaps), hosted-agent diagnostics.
- [P039](#p039-support-and-rca-signed-investigation-demo), support/RCA demo.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P037: Skill and domain-context provenance for agent investigations

**Source:** Same Autumn case study. The useful agent combined Claude Code, structured logs, and carefully iterated investigation skills that encoded billing, Stripe webhook, entitlement, and cache-domain knowledge. The hosted agent quality gap included skill-trigger failures.

**The decision in question:** should atrib capture skill and domain-context provenance as first-class evidence in investigation traces and continuation packets?

Candidate shape:

- Skill pack name, version, source, and content hash.
- Domain reference document ids and hashes.
- Skill-loading status for the run.
- Skill-trigger status when the harness exposes it.
- A link from investigation hypotheses, diagnostics, and final summaries to the skill/context record hashes that informed them.

**Considerations.**

- This should not become a new cognitive primitive. It is either sidecar metadata, an extension record, or a field inside a continuation packet.
- Skill files may contain private operational detail. Hashes and private archive references may be safer defaults than public bodies.
- The immediate product value is explaining why a local harness outperformed a hosted harness: same model class, different skills and code context.
- A receiving agent should be able to detect "the prior run used `billing-investigation@hash`, but I do not have it loaded."

**Likely outcome (not committed):** accept for support/RCA flows as part of the continuation packet. Promote to a sharper schema only after a real demo proves which fields agents use.

**Cross-references.**

- [P036](#p036-cross-harness-continuation-packet-for-supportrca-investigations), continuation packet.
- [D062](#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence), local sidecar persistence.
- [D079](#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), primitive-surface boundary.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P038: Hosted-agent diagnostic records for MCP auth, skill loading, and code context gaps

**Source:** Same Autumn case study. The hosted agent was useful for simple investigations but weaker for deeper iteration. The named failure classes were MCP auth flakiness, skills not triggering correctly, and worse codebase understanding compared with local Claude Code.

**The decision in question:** should hosted-agent harnesses sign diagnostic records for capability gaps before or during investigation runs?

Diagnostic classes to capture:

- MCP connection and auth status per tool.
- Skill discovery, load, and trigger status.
- Codebase checkout identity, dirty state, and index freshness.
- Hosted memory and filesystem availability.
- Missing local-only tools or credentials.
- Runtime transport limits, such as inability to spawn stdio MCP servers in Cloudflare Workers.

**Considerations.**

- [D087](#d087-signed-diagnostic-outcome--causal-trace-replay) already supplies the pattern. A diagnostic is a `tool_call` or extension record linked with `informed_by`, not a new event_type.
- These diagnostics are especially useful when a hosted result is handed to a local harness. The receiver can see whether it should trust the prior result, redo part of the investigation, or continue from the signed evidence.
- Some diagnostics can expose sensitive tool names or credential topology. Use privacy postures from [§8](atrib-spec.md#8-privacy-postures).

**Likely outcome (not committed):** accept as a harness guidance pattern. Add it to any hosted-agent example that claims continuation quality, starting with the support/RCA demo.

**Cross-references.**

- [D087](#d087-signed-diagnostic-outcome--causal-trace-replay), diagnostic outcome pattern.
- [P036](#p036-cross-harness-continuation-packet-for-supportrca-investigations), continuation packet.
- [P039](#p039-support-and-rca-signed-investigation-demo), support/RCA demo.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P039: Support and RCA signed investigation demo

**Source:** Same Autumn case study plus atrib's existing approval-trace work. The Cloudflare approval-trace example demonstrates signed proposal, approval, execution, outcome, and handoff. The next user-legible wedge is a signed investigation trace: support ticket, tenant-scoped logs, code-path reads, hypotheses, diagnostics, revisions, and handoff.

**The decision in question:** should the next public demo be an Autumn-shaped support/RCA investigation trace instead of another commerce-first demo?

Candidate demo:

- Fake support ticket for a stateful billing issue.
- Plain-style webhook trigger plus Slack-style thread handoff.
- Fake Axiom-shaped wide logs with tenant context and request `extras`.
- Agent queries logs, reads the code path, emits hypotheses, revises at least one wrong hypothesis, runs a diagnostic, and signs a final investigation summary.
- Continuation packet lets a local Claude Code or Codex session continue from the hosted run.
- Explorer view shows the signed causal chain without exposing private ticket or log bodies by default.

**Considerations.**

- This demo makes atrib useful even without a payment event. It shows provable investigation continuity, not settlement.
- It complements Axiom-like observability rather than competing with it. The log store keeps operational evidence; atrib proves the investigation path.
- It should reuse existing primitives and the new [§7.8](atrib-spec.md#78-cross-harness-continuation-packets) pattern. No new protocol feature should be invented just for the demo.
- It gives Mastra adapter research a concrete test case without requiring the adapter to ship first.

**Likely outcome (not committed):** accept. Build it after the approval-trace work lands cleanly, then use it to decide whether P036-P038 need implementation or only docs.

**Cross-references.**

- [P036](#p036-cross-harness-continuation-packet-for-supportrca-investigations), continuation packet.
- [P037](#p037-skill-and-domain-context-provenance-for-agent-investigations), skill/context provenance.
- [P038](#p038-hosted-agent-diagnostic-records-for-mcp-auth-skill-loading-and-code-context-gaps), hosted-agent diagnostics.
- [D087](#d087-signed-diagnostic-outcome--causal-trace-replay), diagnostic outcome pattern.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P040: Mastra source verification after hosted support-agent evidence

**Source:** Same Autumn case study. Autumn used Mastra to host an agent with access to codebase, MCPs, skills, memory, and file system support, but still observed a quality gap versus local Claude Code for deeper investigations. The README already lists Mastra as planned and source-verification-gated.

**The decision in question:** should Mastra move up the adapter-priority queue because hosted support-agent workflows are becoming a concrete demand signal?

**Considerations.**

- Mastra is now attached to a real support-agent workflow rather than a framework popularity row.
- The source-read-first rule still controls. No adapter should be designed from the blog post or package names alone.
- A Mastra adapter may need to capture skill loading, memory state, file-system context, and MCP auth diagnostics in addition to tool calls.
- If Mastra's hosted platform exposes post-hoc run events rather than in-process callbacks, the correct shape may be [§9.5](atrib-spec.md#95-pattern-post-hoc-api-import--consumer-re-sign), not a normal [§9.3](atrib-spec.md#93-pattern-callback--lifecycle-handlers-sdk-native-interception) adapter.

**Follow-up, 2026-06-03:** [`packages/integration/examples/mastra-runtime/`](packages/integration/examples/mastra-runtime/) now proves the local `@mastra/mcp` path: `MCPClient` connects to `MCPServer` over stdio, executes a Mastra `createTool()` tool, signs a hash-only atrib record, and keeps raw payloads in local sidecars. That removes the local MCP source-verification gap. Hosted Mastra Platform run imports, post-hoc event APIs, skill loading, memory state, file-system context, and MCP auth diagnostics remain unread.

**Likely outcome (not committed):** raise source verification priority. Do not commit to an adapter shape until Mastra source and hosted-runtime APIs are read.

**Cross-references.**

- [D020](#d020-framework-adapter-targets-claude-agent-sdk-cloudflare-agents-vercel-ai-sdk-re-ranked-from-an-incomplete-prior-decision), prior framework-adapter prioritization.
- [D024](#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private), source-read-first precedent.
- [P039](#p039-support-and-rca-signed-investigation-demo), support/RCA demo.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P042: Local substrate coordinator for long-lived and multi-harness dogfood

**Source:** live Codex MCP process audit on 2026-06-10, repeated stale bridge child-process incidents, the operator's reminder that atrib must work across long-lived local agents and always-on assistants, and the earlier [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess), [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement), and [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) lessons. Local watcher WAL and receipt join-back incidents add the read/write reconciliation pressure.

**The decision in question:** should atrib introduce an optional host-owned local substrate coordinator beneath all harness adapters, rather than keep adding MCP bundles, hook helpers, watcher-specific queues, and per-harness fixes?

**Why this is not just [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) again:** [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) was emit-only spawn amortization. [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) and [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) removed that need for hook-class producers. The current issue is wider: Codex and Claude Code startup-spawn MCP children multiply cognitive-primitive processes per active bundle, bridge-backed always-on assistants may use bash/curl paths rather than an MCP host, scheduled long-lived producers need stable process ownership, and local watcher pipelines need WAL drain plus receipt join-back. A single aggregated MCP server would reduce one symptom and miss the system boundary.

**Candidate shape.** One optional local service per creator identity or trusted host boundary, reachable over a Unix socket or explicit localhost transport, supervised by the host (launchd locally, container supervisor in server deployments). It owns shared substrate work only:

- key resolution and signing request policy, subject to [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)
- `resolveChainRoot`, source-aware `informed_by` validation, and parent-child context threading
- mirror/WAL append, receipt token generation, log submission queue, archive submission, and receipt join-back
- local read indexes for recall, trace, and summarize, built from the same mirror and sidecars
- health reporting: pid, socket, version, queue depth, WAL backlog, active contexts, stale wrapper/process detections

Adapters stay thin:

- Claude Code and Codex hooks plus stdio/HTTP MCP adapters inject session context and call the coordinator
- bridge-backed always-on assistant wrappers call the same local service without becoming MCP hosts
- long-lived heartbeat, critic, and prerun producers use the same socket under supervisor ownership
- local knowledge-base watchers enqueue records and join receipts through the coordinator instead of each watcher owning sync details
- Inspect/eval and sandboxed runtimes keep per-run env contexts and [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) signer-proxy boundaries explicit

**Non-negotiables.**

1. No mandatory daemon for first-time users. Existing in-process, CLI, and stdio paths remain valid.
2. No new cognitive primitive or event type. This is deployment architecture, not protocol vocabulary.
3. No silent key multiplexing. Multiple creator keys mean separate sockets or explicit signer selection with policy.
4. No primary-path blocking. Coordinator unavailable means fallback or no-op under [§5.8](atrib-spec.md#58-degradation-contract).
5. No host-specific assumptions in core. Harness context discovery remains registry-driven per [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers).
6. Signed bytes must stay identical to existing producer paths by routing through the existing signing and verifier code.

**First work if accepted:** write the coordinator contract and fixture tests before moving a hot path. The first dogfood slice should prove one startup-spawn harness (Codex or Claude Code), one long-lived assistant or scheduled-producer harness, and one local watcher WAL path can use the same coordinator contract without changing record bytes. A process-health report should gate rollout before any default config change.

**Design packet shipped 2026-06-10:** [`docs/concepts/13-local-substrate-coordinator.md`](docs/concepts/13-local-substrate-coordinator.md) defines the host-owned boundary, non-negotiables, fixture contract, worked startup-spawn example, and rollout gate. [`spec/conformance/local-substrate-coordinator/`](spec/conformance/local-substrate-coordinator/) pins the first executable contract across `startup-spawn`, `long-lived-agent`, and `watcher-wal` harness classes; `pnpm doc-sync` runs `scripts/check-local-substrate-coordinator-fixtures.mjs` so body-equality, fallback, and health-report gates stay checked. `@atrib/mcp` now exports the typed P042 contract helpers (`validateLocalSubstrateRequest`, `validateLocalSubstrateResponse`, `validateLocalSubstrateHealthReport`, `validateLocalSubstrateFixture`, and `hashLocalSubstrateRecordBody`) plus opt-in client, in-process coordinator prototype, and probe helpers (`tryLocalSubstrateCoordinator`, `createHttpLocalSubstrateTransport`, `createInProcessLocalSubstrateCoordinator`, `buildLocalSubstrateHealthReport`, and `probeLocalSubstrateHealth`). The in-process prototype signs only matching creator-key bodies, returns real hash and receipt identifiers, and keeps the default harness scope to `startup-spawn`; long-lived agents and any default daemon still require their own rollout evidence.

**Startup-spawn shadow wiring shipped 2026-06-11:** `@atrib/mcp` now accepts an opt-in local-substrate shadow option at the exact unsigned-record-body boundary. It sends `mode: "shadow_probe"` requests to a caller-supplied coordinator transport, then still signs, mirrors, attaches outbound context, and queues submission locally. `@atrib/mcp-wrap` exposes the first operator path through a JSON `localSubstrate` config that uses `createHttpLocalSubstrateTransport()` and a `startup-spawn` producer envelope. The coordinator signs and returns the hash in shadow mode but skips queue and mirror side effects, so real wrapper reachability can be tested without double-committing records. Full coordinator-owned signing remains out of scope until the contract can return or own the signed body, mirror append, outbound context, and queue as one unit.

**Long-lived emit shadow wiring shipped 2026-06-11:** `@atrib/emit` now accepts the same shadow-probe shape for explicit cognitive records. `handleEmit()` builds the normal signed record, strips `signature` back to the exact unsigned body, dispatches a bounded `mode: "shadow_probe"` request with a `long-lived-agent` producer envelope, and keeps local signing, mirror append, and queue submission authoritative. `emitInProcess()` waits only for that bounded attempt so short-lived hook producers do not exit before telemetry lands; the emit MCP server, `atrib-emit-cli`, `@atrib/annotate`, and `@atrib/revise` can opt in through `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` plus `ATRIB_LOCAL_SUBSTRATE_MODE=shadow` or by passing an explicit transport. This covers the second P042 harness class without adding a daemon or enabling coordinator-owned emit commit mode.

**Watcher-WAL commit proof shipped 2026-06-11:** `createInProcessLocalSubstrateCoordinator()` now accepts `operation: "enqueue_record_and_join_receipt"` for callers that opt in to the `watcher-wal` harness class. The public fixture path proves the coordinator signs the exact watcher annotation body, returns the real `record_hash` and `receipt_id`, exposes WAL health counters, and hands the observer explicit join metadata (`entry_id`, `source_path`, `receipt_join_field`) without mutating signed bytes. The local knowledge-base WAL path now writes the same source-targeted join metadata into queued envelopes and durable receipts, and join-back refuses to let a declared-source receipt be claimed by a different markdown file. This covers the third P042 harness class at the in-process proof level. Default dogfood config and process-count reduction remain open.

**HTTP service handler shipped 2026-06-11:** `@atrib/mcp` now exports `createLocalSubstrateCoordinatorHttpHandler()` and `handleLocalSubstrateCoordinatorHttpRequest()` as the server-side match for `createHttpLocalSubstrateTransport()`. The handler serves `POST /atrib/local-substrate` for coordinator requests and `GET`/`HEAD /atrib/local-substrate` or `/atrib/local-substrate/health` for read-only health. It rejects malformed JSON and invalid requests before the coordinator hot path, preserves application-level `rejected` envelopes for clients, and stays framework-neutral so Node HTTP, Hono, Bun, Deno, launchd-owned local services, and tests can share one route contract. This is still not a default daemon or a new MCP surface.

**Node host binding shipped 2026-06-11:** `@atrib/mcp` now exports `bindLocalSubstrateCoordinatorNodeServer()` as the Node HTTP binding for the same P042 service contract. It binds loopback by default, returns endpoint and health URLs for clients, caps request bodies before JSON parsing, keeps malformed or oversized requests out of the coordinator hot path, and leaves browser CORS policy to the host. This makes the supervised-host path executable without adding another package, MCP server, or default background process.

**Host binary shipped 2026-06-11:** `@atrib/emit` now ships `atrib-local-substrate`, the first supervised host process for the P042 boundary. It reuses `@atrib/emit`'s bounded `resolveKey()` chain, starts the shared Node HTTP coordinator at `127.0.0.1:8787` by default, supports `startup-spawn`, `long-lived-agent`, and `watcher-wal` requests, prints a machine-readable ready event for supervisors, and drains the coordinator queue on SIGTERM/SIGINT with a bounded timeout. The binary is opt-in and does not change default Codex, Claude Code, OpenClaw, Hermes, or watcher configs.

**Process-health proof shipped 2026-06-11:** `scripts/prove-local-substrate-process-health.mjs` and `pnpm prove:local-substrate` now provide the first repo-owned rollout gate for the host process. The proof builds `@atrib/mcp` and `@atrib/emit`, starts the real `atrib-local-substrate` binary on an ephemeral loopback port, sends the three fixture harness requests over HTTP, checks watcher receipt issuance, validates final health, asserts zero stale children and zero orphan receipts, and proves unavailable coordinators classify as fallback-safe `unavailable`. This proves the host binary can satisfy the P042 contract in isolation. It does not prove default dogfood config, cross-thread process-count reduction, long-lived local-agent adoption, or watcher routing yet.

**Watcher-WAL dogfood adoption shipped 2026-06-11:** `@atrib/emit` now exposes an explicit watcher-WAL coordinator commit path for in-process and CLI producers. `emitInProcess()` can send `operation: "enqueue_record_and_join_receipt"` with WAL join metadata, skip its own log queue only after the coordinator returns the expected `record_hash`, surface the coordinator `receipt_id`, and fall back to local queue submission on rejection, timeout, or hash mismatch. `atrib-emit-cli` accepts the same path through a top-level `local_substrate` envelope, while the default CLI path keeps shadow-only behavior. The local knowledge-base WAL drain now passes its source-targeted join metadata into that envelope, writes coordinator receipt ids only when present, and runs against a launchd-owned local-substrate host. A live probe produced record `sha256:89981cf752c2a09e076663f2c8ec75a82ced15a7e0622771a0a72a557bdd37df` and coordinator health reported zero queue depth, stale children, and orphan receipts afterward. This proves one real watcher route. Startup-spawn process-count cleanup remains restart-gated.

**Aggregated MCP runtime shipped 2026-06-11:** `@atrib/primitives-runtime` adds a private local `atrib-primitives` binary for dogfood harnesses that need process-count reduction before a full coordinator migration. Stdio mode mounts the seven public primitive packages in process and exposes their 15 physical MCP tools through one MCP server, reducing the per-thread atrib primitive process target from seven OS child processes to one when a host config points at `services/atrib-primitives/dist/index.js`. Streamable HTTP mode serves the same tools from one loopback host process, with one in-process runtime per MCP session, so startup-spawn harness configs can share a primitive host across threads for the same agent profile once they support HTTP MCP endpoints. Different agent profiles still need separate primitive HTTP hosts because the runtime inherits `ATRIB_AGENT`, mirror paths, key paths, and local-substrate endpoints from process env. A single mixed-profile primitive process would blur creator and mirror boundaries. The standalone public primitive packages stay unchanged and publishable. This is not a coordinator: it does not own signer policy, WAL commit, receipt join-back, queue health, or cross-harness supervision. The protocol proof is `services/atrib-primitives/test/mcp-protocol.test.ts`, which lists all 15 tools and routes recall through both stdio and Streamable HTTP. The topology report now has a separate `host-owned-primitives-http` gate, so per-thread stdio collapse cannot be mistaken for agent-scoped cross-thread process sharing.

**Long-lived route topology gate shipped 2026-06-11:** `scripts/report-local-substrate-topology.mjs` now treats supervised long-lived producer routing as its own live topology gate. The collector recognizes known Hermes and OpenClaw gateway launch agents, extracts only safe atrib endpoint and agent fields from launchd metadata or the referenced env file, and requires at least one long-lived route to point at a healthy coordinator before `ready_for_default_trial` can pass. The regression fixture `missing-long-lived-agent-route.json` keeps the default gate closed even when startup-spawn process sharing, agent-scoped primitive HTTP hosting, coordinator health, and watcher-WAL routing all pass. This aligns the live dogfood report with P042's three required harness classes.

**Hermes long-lived route dogfood adoption shipped 2026-06-11:** the Hermes gateway launch agent now carries `ATRIB_LOCAL_SUBSTRATE_ENDPOINT=http://127.0.0.1:8789/atrib/local-substrate`, `ATRIB_LOCAL_SUBSTRATE_MODE=shadow`, and `ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS=500`. The first `launchctl kickstart -k` restarted Hermes from launchd's cached definition and did not load the new env, so the rollout used `launchctl bootout` plus `launchctl bootstrap` against the edited plist. A manual heartbeat smoke emitted record `sha256:e83dca5954ebbb1f8679dbaa0d91d09fde66009104bd5d1bee71b260209d29a7`, the live Hermes process now shows the ATRIB env, and `pnpm report:local-substrate` reports `PASS long-lived-agent-route` with `long-lived agent routes: 1/2`. OpenClaw remains unwired, and the startup-spawn collapse gate remains restart-gated by the current Codex app-server's stale primitive children.

**Likely outcome (not committed):** accept after a design packet validates the contract against current startup-spawn harnesses, bridge-backed always-on assistants, scheduled long-lived producers, and local watcher process models. If accepted, promote this into an ADR that supersedes [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback) for local hot paths while preserving [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback)'s fallback and single-creator-key invariants.

**Cross-references.**

- [D076](#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), the earlier emit-only daemon design.
- [D081](#d081-in-process-emit-for-hook-class-producers-emitinprocess) and [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), the hook-path correction that avoided an unnecessary daemon on short-lived Node hooks.
- [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), harness context discovery.
- [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement), the measurement surface a coordinator health report should extend.
- [D102](#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox), signer isolation for sandboxed producers.
- [P002](#p002-agent-bridge-on-atrib-substrate), agent-bridge on atrib substrate.
- [P027](#p027-deployment-architecture-for-host-side-hook-helpers-symlink-from-repo-vs-published-cli), hook helper deployment architecture.

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.
