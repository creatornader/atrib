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
**Context:** The initial SDK shipped with synthetic ACP/UCP detection rules (`response.data.object.object === 'checkout_session'`, `type === 'order.created'`, `event_type === 'ORDER_CREATED'`) that came from imagined Stripe-event-envelope shapes — a guess at the protocol surface, never cross-checked against the real ACP and UCP specs. When the rules were verified against the actual specs (via the `/agentic-commerce-protocol/agentic-commerce-protocol` and `/universal-commerce-protocol/ucp` repos), it turned out that (a) neither protocol uses any of those shapes, (b) ACP and UCP have converged on essentially the same checkout completion response, and (c) the `TransactionDetection.protocol` literal `'ACP/UCP'` was hiding a distinction that consumers actually care about.
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

**Followup:** W3C Trace Context conformance and MCP SDK extension API verification next. The AP2 work was expected to touch `emitTransactionRecord` for AP2 content_id derivation; in the end no change was needed there because AP2 still uses the MCP server URL fallback (the PaymentMandate carries useful identifiers like `payment_request_id` but extracting them per-protocol is not required at this stage).

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
- **Multi-upstream fan-out per proxy.** Rejected for v1 (D020 already locked this in). Each proxy maps 1:1 to an upstream; users with N upstreams create N proxies. Simpler reasoning, no namespace-collision logic, easier failure isolation per upstream.
- **Dynamic tool list refresh.** Deferred to V2. The proxy snapshots `listTools()` once at construction. Restart the proxy if the upstream catalog changes. The upstream-driven `tools/list_changed` notification path can be added later without breaking the public API.

**Files added:**

- `packages/mcp/src/proxy.ts` (~250 lines)
- `packages/mcp/test/proxy.test.ts`: 5 unit tests using `InMemoryTransport.createLinkedPair()` against a real upstream `McpServer`:
  1. `tools/list` is forwarded from the upstream snapshot
  2. `tools/call` forwards arguments and returns the response unchanged
  3. Attribution records are emitted on the proxy side (verified via mocked submission `fetch` and outbound `_meta.atrib` token)
  4. §5.8 degradation: upstream `isError: true` results propagate without record emission (per §5.3.3)
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
**Context:** D020 set the framework-adapter build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Cloudflare adapter as "the same proxy server pattern as Claude Agent SDK", i.e. expected to reuse the `createAtribProxy()` primitive shipped in D021. Before writing code, the actual `agents@0.9.0` source was inspected (npm pack + grep on `dist/index-BtHngIIG.d.ts` and `dist/client-BwgM3cRz.js`). The findings make the right architecture noticeably different from D020's prediction in two ways: the proxy isn't needed for either of Cloudflare's two MCP surfaces, and the client-side surface is even smaller than expected.

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

This is the same Case A pattern as Claude Agent SDK in D021. The retroactive wrapping shipped in commit `c450672` lets `atrib()` be called before OR after `registerTool()`.

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

**Why this is different from D020's prediction:**

D020 said the Cloudflare adapter would "use the same proxy server pattern as Claude Agent SDK". That prediction was based on the dependency-graph signal that `agents` bundles `@modelcontextprotocol/sdk`, and assumed the integration shape would mirror Claude SDK's. It was right that the McpAgent server-side surface exists, but the Cloudflare-specific architecture also exposes the client field publicly on `MCPClientConnection`, which is a more direct integration point than building a full proxy MCP server. The proxy approach would have worked but would have required deploying a separate Worker as the proxy URL, operationally heavier than necessary. Reading the source revealed the simpler path.

**`createAtribProxy` is NOT part of the Cloudflare adapter.** The proxy primitive shipped in D021 is still useful: for hosts that DON'T expose the underlying Client field publicly, or for upstream MCP servers that the user wants to attribute from outside any host (e.g. exposing a stdio MCP server as an attributed HTTP endpoint that any consumer can connect to). But for Cloudflare specifically, the client-wrap path is strictly simpler and more direct.

**Workers runtime constraint:** Cloudflare Workers don't support child processes, so the MCP SDK's `StdioClientTransport` doesn't work in the Worker runtime. Cloudflare Agents can only connect to upstream MCP servers via HTTP transports (`streamable-http` or the deprecated `sse`). If a user needs to attribute a stdio upstream from a Cloudflare Agent, they have to either run the stdio server elsewhere with an HTTP front-end, or use `createAtribProxy()` on a non-Worker runtime that proxies stdio out as Streamable HTTP and have the Cloudflare Agent connect to that proxy URL. The README in `packages/integration/examples/cloudflare-agents/` documents this.

**Alternatives considered:**

- **Proxy-Worker pattern**: deploy a separate Worker that uses `createAtribProxy() + McpAgent.serve('/')` to expose an attributed MCP server, then have the consuming Agent connect to it via `addMcpServer(name, 'https://my-proxy.workers.dev/mcp')`. Architecturally clean and validates that `createAtribProxy()` composes with `McpAgent.serve()`. **Rejected for v1 as the primary path** because it adds operational complexity (a second Worker deployment, a second URL, potentially a second Durable Object class) for a use case that the in-place client wrap solves more directly. Still documented as an option for stdio upstream cases where it's the only viable path.
- **Subclass `Agent` with an `AtribAgent` class** that overrides `addMcpServer` to wrap automatically. **Rejected** because users already extend `Agent`/`AIChatAgent` (or other framework classes), and forcing them to also extend `AtribAgent` creates a multiple-inheritance problem TypeScript can't solve. The helper-function approach lets users keep their existing inheritance hierarchy.
- **Monkey-patch `Agent.addMcpServer`** to auto-wrap on every call. **Considered for a future version** as a `installAttributionHook(agent, options)` helper that the user calls once at startup instead of after every `addMcpServer`. Deferred from v1: the explicit one-line helper at the call site is more honest and easier to debug than a hidden monkey-patch.
- **Wrap every method on `MCPClientManager`** instead of swapping the `client` field on each connection. **Rejected** because `MCPClientManager` has many methods (`callTool`, `readResource`, `getPrompt`, `listTools`, etc.) and only `callTool` needs attribution. Wrapping at the per-connection `client` level is narrower and requires no knowledge of `MCPClientManager`'s evolving API.

**Files added:**

- `packages/agent/src/adapters/cloudflare-agent.ts` (~170 lines): `attributeCloudflareAgentMcp(agent, options)` helper. Walks `agent.mcp.mcpConnections`, wraps each `client` with `wrapMcpClient`, marks wrapped clients with a `Symbol.for('atrib.cloudflare.wrapped')` for idempotency. Per-connection failures are caught and skipped per spec §5.8 degradation.
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

The cloudflare-agent unit tests can't import the real `agents` package because it depends on the WorkerD runtime (Durable Object bindings, Cloudflare-specific globals, etc.). Instead, the tests construct a structural mock that mirrors the public shape we depend on: `{ mcp: { mcpConnections: { [name]: { client: MinimalMcpClient, url } } } }`. This validates the helper's behavior against the same field shapes the real Cloudflare classes expose. If `agents` ever changes the public shape, the integration would break in production silently; a future improvement is to add a daily/weekly CI job that npm-installs the latest `agents` and runs a regression test against the real types (similar to the SDK shape regression test added in D019).

The runnable examples (`surface-1-mcp-agent.ts`, `surface-2-agent-client.ts`) are the secondary line of defense: they typecheck against user-installed `agents` in a real Worker project, and any breaking change in the Cloudflare API would surface there at deploy time.

**Test results:** 360 tests passing across all 4 packages (was 355; +5 cloudflare-agent unit tests). No regressions in mcp (166), verify (82), or integration (5).

**Followup:** Vercel AI SDK adapter is the next §6 chunk. Different shape entirely: wrap the `tools()` record returned by `createMCPClient`, not `callTool()`. Lives in `@atrib/agent`, similar surface to `attributeCloudflareAgentMcp` but different mechanism. After Vercel AI SDK, §7 (developer integration documentation) and §8 (TypeDoc API reference) remain.

---

## D023: Vercel AI SDK MCP adapter: monkey-patch `MCPClient.request`, NOT `wrapMcpClient` and NOT the `tools()` execute callbacks

**Date:** 2026-04-06
**Context:** Third framework adapter in the build order, after Claude Agent SDK (D021) and Cloudflare Agents (D022). The Vercel AI SDK exposes MCP integration through `createMCPClient()` in `@ai-sdk/mcp` (and the legacy `experimental_createMCPClient()` re-exported from `ai`). The initial assumption (anchored to the followup note in D022) was that this would be a `tools()`-record-wrapping job: replace each tool's `execute()` callback with one that runs through atrib's interceptor. Source-reading `@ai-sdk/mcp@1.0.35`'s `dist/index.mjs` invalidated that plan and surfaced two structural facts that ruled out both `wrapMcpClient` and the `tools()`-wrap approach.

**Decision:** Ship a third adapter shape, `attributeVercelAiSdkMcp(client, { interceptor, serverUrl? })`, which **monkey-patches the client's `request()` method in place**. The patch intercepts only `tools/call` JSON-RPC methods, injects atrib's outbound `_meta` (atrib token, traceparent, tracestate, baggage, X-atrib-Chain) into `request.params._meta`, forwards to the original `request()`, then flows the raw response (with its own `_meta` intact) through `interceptor.onAfterToolResponse`. Idempotent via `Symbol.for('atrib.vercel-ai-sdk.patched')`. Lives at `packages/agent/src/adapters/vercel-ai-sdk-mcp.ts`. Six unit tests cover the contract (passthrough, injection, no caller mutation, response flow, idempotency, §5.8 degradation).

**Two structural facts that forced this approach:**

1. **`@ai-sdk/mcp` MCPClient is NOT a `@modelcontextprotocol/sdk` Client.** It has its own JSON-RPC implementation. Different `callTool` shape (`{name, args, options}` vs `{name, arguments, _meta}`), and crucially the `_meta` field is **not accepted** by AI SDK's `callTool`; it builds the request as `{ method: 'tools/call', params: { name, arguments: args } }` at `dist/index.mjs:1819` with no `_meta` field at all. So `wrapMcpClient` (which depends on `client.callTool({ name, arguments, _meta })` shape) cannot patch this client. Verified by structural source read, not by importing the package as a dependency.

2. **`tools()` builds AI-SDK-shaped tool definitions whose execute() callbacks pass through `extractStructuredContent`** when an outputSchema is set, and that helper **drops the `_meta` field from the result envelope** at `dist/index.mjs:1989-1991`. Wrapping at the AI SDK execute layer would lose the response-side `_meta` (which carries the server's `atrib` chain token from the @atrib/mcp middleware) for any tool with structured output. This rules out the `tools()`-record-wrapping approach I had initially planned in D022's followup.

**Why `request()` is the right integration point:** It's the JSON-RPC bottleneck through which every `tools/call` flows on its way to the transport (`dist/index.mjs:1750`). Patching here lets us inject `_meta` into the outbound request **before** it hits the transport and read raw `_meta` from the response **before** any AI-SDK-specific transformation strips it. This is structurally symmetric to how `@atrib/mcp` patches `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)` on the server side (D018): same pattern, opposite end of the wire.

**Alternatives considered:**

- **Wrap `tools()` execute callbacks**: fails because `extractStructuredContent` strips `_meta` before reaching the callback (point 2 above). Also requires re-wrapping every time the user calls `tools()`, since each call returns fresh function references.
- **Use `wrapMcpClient`**: fails because `@ai-sdk/mcp`'s callTool shape doesn't accept `_meta` (point 1 above). The Proxy-based wrapper would inject `_meta` into a field that's structurally discarded by the AI SDK before the JSON-RPC request is built.
- **`createAtribProxy`**: overkill. The Vercel AI SDK already accepts a real working MCPClient connected to the upstream; we don't need to interpose a fake server. The proxy pattern is for cases (like Claude Agent SDK Case B) where the host accepts a `McpServer` instance but not an MCPClient.
- **Subclass `MCPClient`**: would require importing `@ai-sdk/mcp` as a hard dependency, which we explicitly avoid (the AI SDK has a heavy transport dependency tree we don't want in `@atrib/agent`).

**Idempotency:** The marker symbol pattern from D022's `attributeCloudflareAgentMcp` is reused: `Symbol.for('atrib.vercel-ai-sdk.patched')` set on the client after first patch, checked on entry. Calling the helper twice on the same client is a no-op the second time. Verified by a unit test that asserts the `request` method reference is unchanged after a second call.

**Order independence:** The helper can be called BEFORE or AFTER `mcpClient.tools()` because the AI SDK builds tool execute() callbacks that read `client.request` at **invocation time**, not at build time. This means users don't need to remember to patch before calling `tools()`; the patch fires correctly regardless of order. This is documented in both the source comment and the example README.

**Caller-arg immutability:** The patched `request()` constructs a new args object (`{ ...args, request: { ...args.request, params: { ...params, _meta: outboundMeta } } }`) rather than mutating the caller's params. Verified by a unit test that captures the caller's params reference and asserts `_meta` was never added to it. This matters because AI SDK tool execute callbacks may share/cache the args object.

**§5.8 degradation:** Both `onBeforeToolCall` and `onAfterToolResponse` are wrapped in try/catch. On `onBeforeToolCall` failure, the request is forwarded with the **original** params (no `_meta` injection), never mutated, never broken. On `onAfterToolResponse` failure, the result is still returned to the caller. Both failure paths log to `console.warn` with the `atrib:` prefix per spec §5.8.

**Example:** `packages/integration/examples/vercel-ai-sdk/` ships a runnable `integration.ts` showing the four-step wiring (interceptor → createMCPClient → attributeVercelAiSdkMcp → tools), plus a README that recommends routing model calls through the Vercel AI Gateway via the `'provider/model'` string form (e.g. `'openai/gpt-5.4'`) for OIDC auth, automatic failover, and unified observability. The README shows both the implicit string form and the explicit `gateway('openai/gpt-5.4')` helper from `@ai-sdk/gateway`; both route through the Gateway with no provider API keys required. The `examples/` directory is excluded from `@atrib/integration`'s tsconfig so it typechecks against the user's installed AI SDK, not our test build (consistent with D021/D022 example handling).

**Test results:** 366 tests passing across all 4 packages (was 360; +6 vercel-ai-sdk-mcp unit tests). No regressions in mcp, verify, or integration.

**Followup:** With three framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK), the framework-adapter rollout is substantially complete. Remaining work: decide whether to add OpenAI Agents SDK and/or Mastra adapters based on the GitHub usage data from earlier research, then developer integration documentation and TypeDoc API reference. A pattern is emerging across D018/D021/D022/D023: each adapter required source-reading the host framework before deciding the integration shape, and in every case the initial guess from D020 was wrong in the specifics. The general approach (interceptor lifecycle + structural-shape adapters) holds, but the integration point varies per framework: server-side `setRequestHandler` patch (@atrib/mcp), in-process `McpServer` proxy (Claude Agent SDK Case B), in-place `client` field replacement (Cloudflare Agent), and `request()` monkey-patch (Vercel AI SDK).

---

## D024: LangChain JS MCP adapter: NOT docs-only. `MultiServerMCPClient` needs a proper helper because its internal Client references are `#private`

**Date:** 2026-04-06
**Context:** D020 asserted that LangChain would ship as a docs-only adapter because `loadMcpTools(name, rawClient)` accepts an injected `@modelcontextprotocol/sdk` Client, so `wrapMcpClient` from `@atrib/agent` would cover it transparently. After user pushback on "why docs-only instead of doing it properly", I unpacked `@langchain/mcp-adapters@1.1.3` and source-read the actual API. The docs-only claim was half right and half wrong.

**What the SDK actually exposes (verified against `@langchain/mcp-adapters@1.1.3`):**

LangChain has **two** MCP APIs, not one:

1. **Low-level: `loadMcpTools(serverName, client, options?)`**: second parameter is typed `Client | Client_from_mcp_sdk` at `dist/tools.d.ts:28`. Users construct their own Client, call `.connect(transport)`, then pass it in. For this path, `wrapMcpClient` works transparently because the user owns the Client and can substitute a wrapped version. D020's "docs-only" claim is correct for this path.

2. **High-level: `new MultiServerMCPClient({ mcpServers: {...} })`**: config-driven, used by the vast majority of LangChain agents because it handles multi-server setup, reconnection, and auth plumbing internally. The multi-client constructs `@modelcontextprotocol/sdk` Client instances behind `#private` fields (`dist/client.d.ts:12`). Users NEVER see the Client reference directly. There is a `getClient(serverName)` getter that returns the internal Client, but NO corresponding setter; `wrapMcpClient` (which returns a NEW Proxy-wrapped object) cannot be substituted because there is nowhere to put the new reference. D020's "docs-only" claim is WRONG for this path.

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

- **Docs-only for both paths (D020's original plan).** Rejected because it leaves `MultiServerMCPClient`, the idiomatic LangChain API, unsupported. Users following our docs would have to rewrite their agent to use `loadMcpTools` directly, which is a non-starter for existing LangChain apps.
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
7. §5.8 degradation: `onBeforeToolCall` failure does not break the call
8. Skips servers whose `getClient` returns undefined (not initialized)
9. Selective patching via `options.servers`

**Test results:** 375 tests passing across all 4 packages (was 366; +9 langchain-mcp). No regressions.

**Followup:** Four framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS). The unified `packages/agent/README.md` documents all adapters side-by-side under two coverage matrices (framework adapters + payment protocols), making the "one interceptor, any framework" story concrete and demonstrable. Remaining adapter work: OpenAI Agents SDK (deferred per D020; meaningfully different architecture, custom transports) and Mastra (deferred; smaller footprint, needs source verification). Next priority is developer integration docs, including the local log stub and end-to-end demo.

---

## D025: `@atrib/log-dev` + spec/code drift fix in submission wire format + `priority` wired to two real consumers

**Date:** 2026-04-06
**Context:** A runnable end-to-end demo for developer onboarding required a local Merkle log stub. While preparing to build that stub against spec §2.6, source-reading `@atrib/mcp/src/submission.ts` surfaced two real wire-format bugs that would have caused every submission from the existing client to be rejected by any spec-compliant log:

**Discrepancy 1: Request body shape was wrong.** Spec §2.6.1 specifies the POST body as a bare attribution record. The existing `submitWithRetry` was wrapping it as `{record, priority}`. The wrapping pattern was even codified in `packages/mcp/test/submission.test.ts` ("sends record and priority in request body"), meaning the test was written against the buggy code rather than against the spec.

**Discrepancy 2: Proof bundle field naming was wrong.** Spec §2.6.2 returns `{log_index, checkpoint, inclusion_proof, leaf_hash}` (snake_case). The existing `ProofBundle` interface used camelCase (`logIndex`, `inclusionProof`). This was less load-bearing because the cast to `ProofBundle` in the submission queue is opaque; nothing read the fields after caching, but `@atrib/verify`'s `GraphNode.log_index` already used snake_case correctly, so the two packages were inconsistent with each other and only one matched the spec.

**Decision:** Fix both discrepancies as part of this chunk and ship `@atrib/log-dev` as a faithful spec §2.6 reference implementation. Specifically:

1. **Wire format fix in `submission.ts`:** POST body is now a bare signed record per §2.6.1. The `ProofBundle` interface uses snake_case to match §2.6.2 exactly. Updated all consuming tests across `@atrib/mcp`, `@atrib/agent`, and `@atrib/integration` (test-harness mocked the wrong shape too; fixed there as well).

2. **`@atrib/log-dev`**: new private workspace package at `packages/log-dev/`. Implements `POST /v1/entries` with full §2.6.1 validation (Steps 2-6, skipping Step 1 cryptographic signature verification to avoid a circular dep on `@atrib/verify`), returns spec §2.6.2-shaped proof bundles with deterministic placeholder hashes, and exposes an inspection API (`entries`, `onSubmit`, `clear`) for tests and demos. Marked `private: true` so it cannot be `pnpm publish`'d to npm. README has a prominent ⚠️ NOT FOR PRODUCTION warning at the top.

3. **`priority` wired to two real consumers**: an early sketch dropped `priority` from the wire entirely after recognizing that the in-memory dev log cannot meaningfully consume it. That sketch was wrong: the field has two real consumers that justify keeping it on the wire:

   **Consumer #1: `flush()` retry ordering in `@atrib/mcp/src/submission.ts`.** When the process is shutting down and `pendingRecords` contains records whose initial submission failed, `flush()` now drains them in priority order: high (transactions) before normal (tool calls). If the process is killed mid-flush (container restart, OOM, deploy rollover), high-priority records have already had their final retry and are more likely to make it to the log. Losing a transaction record (the receipt of money moving) is meaningfully worse than losing a tool-call record, so this ordering is a real safety property. `pendingRecords` was changed from `Map<string, AtribRecord>` to `Map<string, {record, priority}>` to track priority across the failure→flush boundary. Verified by a new test in `submission.test.ts` ("flush() drains pendingRecords in priority order").

   **Consumer #2: `@atrib/log-dev`'s admission control under capacity.** The dev log accepts a `maxConcurrent` option (default `Infinity`). When capacity is finite and the in-flight submission count is at the cap, new submissions go into a priority queue inside `storage.ts` and high-priority records are admitted first when capacity frees up. This faithfully models the admission-control behavior a real Tessera-backed log would expose under load. Verified by a new test in `log-dev/test/server.test.ts` ("high-priority submissions are admitted before normal under capacity pressure") that uses `maxConcurrent: 1` and `processingDelayMs: 30` to deterministically demonstrate the priority ordering.

   The wire format is `X-atrib-Priority: high|normal` HTTP header, a non-conflicting extension to spec §2.6.1 that does not require a spec change because HTTP headers are a standard extension mechanism.

4. **End-to-end demo** at `packages/integration/examples/end-to-end/demo.ts`, runnable in a single command (`pnpm --filter @atrib/integration demo`), wires together the dev log + a fake merchant tool server (wrapped with `@atrib/mcp`'s `atrib()`) + a fake agent client (wrapped with `@atrib/agent`'s `wrapMcpClient`) + a stubbed x402 payment receipt that triggers the production transaction-detection logic in `transaction.ts`. CLI visualizer subscribes to the dev log via `onSubmit()` and pretty-prints each record with colored chain hashes as it lands. Verified end-to-end: one run produces 2 tool_call records + 1 transaction record, all chained, all visible in the CLI output.

**Why this matters strategically:**

The end-to-end demo answers "what can a developer hand a customer in 15 minutes?" Before this work, the protocol was implemented but a customer couldn't watch it work without standing up Tessera first (which doesn't exist). With the demo, `pnpm demo` produces a complete attribution chain visible in real time, with real signatures and real transaction detection, against a real (but in-memory) spec-compliant log. The fakery is in the surrounding environment: the merchant returns hardcoded search results, the agent issues hardcoded tool calls, the x402 payment is a stubbed header, but the protocol layer is real.

The spec/code drift fix is the kind of thing that only gets caught when you build a real reference implementation. Mocking `globalThis.fetch` in unit tests doesn't catch wire-format bugs because the mocks don't validate the request shape against the spec. The dev log is a real server that validates per §2.6.1; it caught the wrong wire format on the first integration attempt. This is a strong argument for keeping `@atrib/log-dev` in the test infrastructure permanently rather than treating it as a one-off demo helper.

**Alternatives considered:**

- **Drop `priority` from the wire entirely (option (a) from the priority discussion).** Initially leaned toward this on the grounds that no consumer existed. Rejected after a closer review surfaced two real consumers that DO exist, they just hadn't been wired yet.
- **Keep the broken wire format and note the spec drift in TODO.md.** Rejected per the radical-honesty rule. Shipping a known wire-format bug to customers because "we'll fix it later" is exactly the kind of avoidable failure the rule exists to prevent.
- **Build the dev log as a separate `services/log/dev-server/` directory rather than a workspace package.** Rejected after weighing trade-offs: option A (workspace package) wins because the demo can `import { startDevLog } from '@atrib/log-dev'` directly without spawning a child process, the inspection API is type-safe and ergonomic, and the existing `@atrib/mcp` and `@atrib/agent` test suites can reuse the dev log as a real fixture in the future instead of mocking `fetch`.
- **Build the dev log in Go (matching the future Tessera service).** Rejected for this chunk. The Go Tessera-backed log will live in `services/log/` when it ships; the dev log is a TypeScript fixture for in-process integration tests and demos. They have different operational profiles and can coexist; the dev log is not a stepping stone to the real one.
- **Implement signature verification (§2.6.1 Step 1) in the dev log.** Rejected because it would create a circular workspace dep: `@atrib/log-dev` would have to import from `@atrib/verify`, which already imports from `@atrib/mcp`. The dev log skips signature verification and is honest about it in the file header. Anyone using the dev log for end-to-end correctness testing should run `@atrib/verify` against the captured records separately.

**Test results:** 391 tests passing across all 5 packages (was 375 + 16 new):

- `@atrib/mcp`: 169 (was 166, +3 wire-format conformance tests + 1 priority ordering test, -1 deleted "wraps record/priority in body" test that asserted the wrong shape)
- `@atrib/agent`: 122 (unchanged)
- `@atrib/verify`: 82 (unchanged)
- `@atrib/log-dev`: **13 (new)**: wire-format conformance + priority queue ordering + inspection API
- `@atrib/integration`: 5 (unchanged; test harness updated to match new wire format)

Plus the demo runs end-to-end and produces the expected output (verified manually before commit).

**Followup:** With the spec/code drift fixed and the dev log in place, the next layer of customer-readiness work is (a) the `services/log/` Tessera-backed Go service for production deployments, and (b) publishing `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` to npm so customers can actually `pnpm add` them. The unified `packages/agent/README.md` is ready to be the customer-facing entry point once packages are published.

---

## D026: Spec §2.6.1 conformance corpus at `spec/conformance/2.6.1/` (shared between TS dev log and future Go log)

**Date:** 2026-04-06

**Context:** After D025 landed, a remaining gap surfaced: `@atrib/log-dev` and the future `services/log/` Tessera-backed Go service had no shared agreement on §2.6.1 behavior beyond the prose in the spec. Two implementations of "what does §2.6.1 reject" derived independently from the spec text would inevitably drift in subtle ways. The right move was to ship a conformance corpus immediately, even though the Go consumer doesn't yet exist, so when it arrives it has a fixed reference set to validate against.

**Decision:** Build a static, shared, language-neutral conformance corpus at `spec/conformance/2.6.1/` consisting of one JSON file per test case plus a manifest. Each case is a fully self-contained `{request, expected}` pair: the `request.body` is the bare signed `AtribRecord` ready to JSON.stringify, and `expected.status` is the canonical accept/reject outcome. A reference TypeScript consumer ships in `@atrib/log-dev`'s test suite today; the future Go service will consume the same files when it ships.

**Implementation details:**

1. **Corpus structure** (8 cases + 1 sequence at this writing, growable):
   - `cases/accept-tool-call.json` and `accept-transaction.json`: well-formed signed records
   - `cases/reject-bad-signature.json`: §2.6.1 Step 1 (Ed25519 verify fails)
   - `cases/reject-wrong-spec-version.json`: §2.6.1 Step 2
   - `cases/reject-unknown-event-type.json`: §2.6.1 Step 3
   - `cases/reject-future-timestamp.json`: §2.6.1 Step 4 (timestamp 20 minutes ahead of `reference_time_ms`)
   - `cases/reject-malformed-context-id.json`: §2.6.1 Step 5
   - `cases/reject-non-json-body.json`: pre-Step-1 sanity (raw string body, not parseable)
   - `sequences/idempotent-resubmission.json`: §2.6.1 Step 6 (same record twice, same proof, log_size stays at 1)

2. **Time handling.** The corpus stores fully-signed records with frozen timestamps, so the bytes are byte-deterministic across regenerations. Step 4 (the future-timestamp case) only produces stable validation outcomes if the consumer pretends "now" is the manifest's `reference_time_ms` (`2026-01-01T00:00:00Z`). The TS consumer uses `vi.useFakeTimers()` + `vi.setSystemTime()`. A Go consumer would inject a `clock.Clock` interface into its validator. The mock-clock requirement is documented in the corpus README and in the consumer code.

3. **Hardcoded signing seed.** The seed is `0x07` repeated 32 times, committed in `manifest.json` as `signing.seed_b64url`. This is so the corpus is regeneration-deterministic; successive runs of the generator produce byte-identical files unless the inputs change. The seed is loudly marked NEVER-FOR-PRODUCTION in both the README and the manifest.

4. **Per-implementation skip lists in the consumer, not in the corpus.** `@atrib/log-dev` cannot honor `reject-bad-signature` because it skips §2.6.1 Step 1 to avoid a circular workspace dep on `@atrib/verify`. The TS consumer maintains a `DEV_LOG_SKIPS` map keyed by case name, with a justification string. The corpus itself stays canonical; the Go service is expected to honor every case (its `DEV_LOG_SKIPS` equivalent will be empty). This keeps the corpus clean of implementation-specific notes.

5. **Generator at `packages/log-dev/scripts/generate-conformance-corpus.ts`** (run via `pnpm --filter @atrib/log-dev corpus`). It uses `signRecord` from `@atrib/mcp` (the canonical signer) so the test signatures are byte-identical to what a real `@atrib/mcp`-using merchant would produce. The generator imports nothing implementation-specific to the dev log; it only writes JSON.

6. **Consumer at `packages/log-dev/test/conformance.test.ts`** (9 tests, 1 skipped). Reads the manifest, iterates over `cases/` and `sequences/`, freezes the clock per test, and asserts the expected outcome.

**Why a separate corpus directory rather than a fixture directory inside `@atrib/log-dev`:**

The corpus is shared infrastructure between TypeScript and Go implementations of the same protocol. Putting it inside `packages/log-dev/test/fixtures/` would either force the future Go service to copy it (drift risk) or to reach across language boundaries (awkward). Sitting at `spec/conformance/2.6.1/` next to `atrib-spec.md` makes it discoverable from the spec itself and accessible to any subtree of the repo. The generator stays inside `@atrib/log-dev` because that's where the canonical signer is reachable as a workspace dep, but the output is implementation-neutral.

**What this DOESN'T solve:**

- Verification that the corpus is truly implementation-independent. We catch this only when the Go consumer ships and runs the same files. Until then, there's a small risk that I've encoded a TS-specific assumption into the JSON (e.g., header name casing, JSON field ordering). I've kept the consumer trivial enough that this risk is small but it exists.
- §2.6.2 proof bundle shape conformance beyond "is the type of each field correct?"; the dev log returns placeholder hashes, so the corpus can't assert specific bytes. A real Tessera service will produce real Merkle proofs that the corpus consumer would need to verify with `@atrib/verify`'s strict path, which is a different test layer.
- §2.5.1 (checkpoint endpoint), §2.5.2 (tile endpoints), and §2.9 (witnessing). These are deferred until the Go service ships; there's no point conformance-testing endpoints that no implementation has yet.

**Test results:** 8 conformance cases + 1 sequence = 9 new tests in `@atrib/log-dev`, of which 8 pass and 1 is skipped (the bad-signature case, with documented reason). Total package tests: 22 (was 13). Total workspace tests: 400 (399 passing, 1 documented skip), up from 391.

**Followup:** When `services/log/` ships, the Go service's test suite reads the same `spec/conformance/2.6.1/` directory. Any drift between the two implementations surfaces immediately as a test failure. If the spec grows new validation rules (e.g., a Step 7), regenerate the corpus with `pnpm --filter @atrib/log-dev corpus` and add a new case file in the same PR. The sync trigger for this is now in `CLAUDE.md`.

## D027: Protocol adapters as a parallel integration surface to framework adapters

**Date:** 2026-04-21

**Context:** The SDK ships framework adapters for each MCP host (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS, plus the raw `@modelcontextprotocol/sdk` client). These hook atrib INTO a host agent framework at runtime. They answer the question "how does atrib observe this agent's tool calls?"

A second, orthogonal question has come up in practice: "what does atrib observe about a specific payment protocol's ecosystem, independent of any single agent session?" For x402 specifically, there is rich public on-chain data that no existing dashboard analyzes contract-first, and attribution gaps no one has worked through. The same question applies to ACP, UCP, AP2, MPP: each has its own ecosystem-level observability problem distinct from runtime detection.

Runtime detection (already shipped in `@atrib/agent`, D008–D009) handles the "this session used x402" case. It does not answer "what is the x402 ecosystem's volume, who are the facilitators, and where does the attribution gap live?" Those questions require a retrospective ecosystem scanner, a canonical facilitator registry, and protocol-specific attribution machinery (e.g., decoding Permit2 witness calldata, sender-pattern clustering against on-chain recipient graphs).

**Decision:** Establish **protocol adapters** as a first-class architectural pattern in atrib, parallel to framework adapters. Each adapter provides observability FOR a specific payment protocol's ecosystem and has three canonical layers:

1. **Registry** — a versioned source of truth for which on-chain identifiers (wallets, signers, merchant accounts) belong to which protocol actor. Combines the protocol's canonical registry (when it exists), facilitator self-declaration endpoints (`/supported` for x402), and an overlay for entries absent or undisclosed in canonical sources.
2. **Scanner** — on-chain (or off-chain) aggregators that measure ecosystem-level activity. For x402 that means Dune SQL contract-first queries today and HyperSync-backed bulk scans next. Methodology is protocol-specific (wallet-first vs contract-first vs event-pattern), but every adapter outputs the same shape: `sender → {tx_count, transfer_count, value}` or equivalent.
3. **Attribution** — maps scanned observations to the registry's known actors, with an unattributed residual bucket. Attribution techniques are protocol-specific (witness decoding, sender-pattern clustering, payTo correlation) but every adapter emits `{attributed, unknown}` cleanly splittable output.

Two observation surfaces exist per protocol: **runtime** (via `@atrib/agent` framework adapters at an agent session) and **retrospective** (via protocol adapters across the entire ecosystem). They compose. A Cloudflare Agent using `@atrib/agent` to capture x402 payments at runtime participates in the same observability graph as the retrospective scan.

**Implementation details:**

1. **Pattern template**. Each protocol adapter has the same directory shape: `registry/`, `scanner/`, `attribution/`, `queries/`, `results/`, `README.md`. The top-level README frames the adapter as "atrib × `<protocol>`" and catalogs its layers against atrib's spec sections (§3 graph, §4 attribution calculation, §2 log as tamper-evidence for the dataset).

2. **Naming**. Protocol adapters are named by the protocol: `x402/`, `acp/`, `ucp/`, `ap2/`, `mpp/`. Standard layout is `atrib/packages/<protocol>/` for SDK code and `atrib/services/<protocol>-scanner/` for ecosystem scanner services.

3. **Scope of adapter vs spec**. A protocol adapter does NOT modify atrib's spec. The spec remains protocol-agnostic. Adapters are implementations of the spec's primitives against protocol-specific data. This preserves §3.6's fact/policy separation: protocol-specific attribution lives in the `attribution/` layer, never in the `registry/` or `scanner/`.

4. **Two demonstration paths.** For a protocol adapter to demonstrate the full spec end-to-end, it needs both:
   - **Path A (retrospective):** scanner + registry + attribution. Demonstrates §3 (graph) and §4 (attribution calculation) applied to ecosystem-level data. Does NOT demonstrate §1 (signed records) or §5 (SDK contract) because it observes, it doesn't transact.
   - **Path B (runtime reference agent):** a reference agent that makes real payments with `@atrib/agent` instrumented, signing records into a running atrib log, with merchant-side verification via `@atrib/verify`. Demonstrates §1, §2.6.1 submission, §5 SDK contract, and the verify flow.
   
   A complete protocol adapter artifact includes both paths. Path A alone is a dataset; Path B alone is a demo; together they prove the spec works end-to-end for that protocol.

**Rejected alternatives:**

1. *Bake protocol-specific scanning into `@atrib/agent`.* Rejected because runtime detection and retrospective scanning have different access patterns (hot path vs bulk analytical), different dependencies (host framework vs blockchain indexer), and different failure modes (pass-through on error vs partial-result on error). Coupling them would blur D008 (middleware pattern: zero ongoing surface area) and mix the detection-latency budget with ecosystem-scan latency.

2. *One universal scanner with protocol plugins.* Rejected because each protocol has a different settlement surface (EIP-3009 + Permit2 for x402, mandate-passing for AP2, payment-token flows for Stripe ACP) and different on-chain/off-chain observability properties. A universal scanner abstraction would either compromise to the lowest common denominator or become a pass-through with nothing shared, per D018's source-read-first principle.

3. *Move scanner data into the spec as a new section.* Rejected because the spec stays protocol-agnostic (§3.6, §4.1). The protocol-specific attribution rationale lives in the adapter's documentation, not the spec body. The spec only says "graph + policy → distribution"; how the graph is populated for a specific protocol is an adapter concern.

**What this DOESN'T solve:**

- Integration of scanned observations back into atrib's Merkle log. Today the log is fed by runtime-signed records. A scan could optionally emit observer-signed records into the log for tamper-evidence of the dataset, but that's a separate decision (future ADR if/when we implement it).
- A formal conformance corpus for adapter outputs (analogous to the §2.6.1 corpus in D026). Premature until the second protocol adapter ships and we have two data points to shape the corpus against.
- Unified cross-adapter attribution calculation. Each adapter today computes its own distribution against its own policy. A multi-protocol attribution (e.g., a session that spans x402 + ACP) is future work, tied to §3's graph derivation extending across adapters.

**First implementation:** the x402 adapter (2026-04-21). Registry (45 facilitators resolved, 92 attributed addresses, `/supported` enrichment), scanner (Dune contract-first query producing $5.4M Base 30d), attribution (baseline mapping + unknown-sender residual). Path A (retrospective surface) exercises §3 + §4; Path B (runtime reference agent using `@atrib/agent`) provides the second observation surface, exercising §1, §2.6.1, §5.

---

## D028: Log exposes its signing pubkey at `GET /v1/pubkey` for self-contained verification

**Date:** 2026-04-27
**Status:** Accepted; deployed to `log.atrib.dev` (image `01KQ6KWYDAC4ZNA6A6BY3BC0ZK`)

**Context.** A C2SP signed-note checkpoint commits the log to a (size, root) pair under an Ed25519 signature. To verify the signature, a third party needs the log's public key. Before this decision the only way to acquire that key was out-of-band — the operator had to publish it via a website, a known directory, or person-to-person. The signed-note signature line carries a 4-byte key_id (SHA-256(origin‖0x0A‖0x01‖pubkey)[:4]) but that's a one-way commitment, not a key.

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

A test verifies that the published `key_id` exactly matches the prefix in the live checkpoint signature line, AND that running `ed.verifyAsync(sig, body, public_key)` against the published pubkey succeeds — meaning the endpoint is real-cryptography-load-bearing and not just a status surface.

**Alternatives considered.**

1. *Publish the pubkey to a static `.well-known` file.* Rejected because it requires a second hosting surface and decouples the published key from the running signer. With `/v1/pubkey` reading from the live signer, the pubkey can never drift out of sync with the actual signature being produced.

2. *Embed the pubkey in every checkpoint body* (e.g. as a 4th line). Rejected because it changes the wire format of `/v1/checkpoint` — a breaking change to a published spec section (§2.4.1) for a problem that's solved cleanly with an additive endpoint.

3. *Require verifiers to derive the pubkey from the seed via a separate "trust root" service.* Rejected because it introduces a second trust dependency for what is fundamentally one log's accountability surface.

**Consequences.**

- Verifiers (third parties + dogfood scripts) can now run `Ed25519.verify(sig, body, pubkey)` against the checkpoint without out-of-band key acquisition. This closes the previously-named "GAP 1" in the dogfood verification loop.
- The endpoint adds zero attack surface: the public key is by design exposable; exposing it is what makes the checkpoint signature meaningful to anyone other than the operator.
- A future witnessing protocol (multiple signatures on one checkpoint) gets a per-witness `/v1/pubkey` analog for free, since the shape generalizes (each signer publishes its own).

**What this DOESN'T solve.** Key rotation. If the log's signing key changes, `/v1/pubkey` returns the new key, and historical checkpoints signed under the old key become unverifiable from this endpoint alone. A future ADR will specify either (a) a rotation log of `(key_id, public_key)` pairs returned by `/v1/pubkey`, or (b) a separate `/v1/keys` endpoint listing all keys ever used. Out of scope for V1.

---

## D029: `AtribOptions.onRecord(record)` observer hook on the middleware

**Date:** 2026-04-27
**Status:** Accepted; shipped in `@atrib/mcp` middleware

**Context.** The atrib log stores commitments only — `record_hash`, `creator_key`, `context_id`, `timestamp`, `event_type` — not the original signed record JSON. This is intentional (§3.6 fact/policy separation; the log is observability, not storage). But it leaves a verification gap: third parties have no way to prove "this record_hash is the hash of a record signed by that creator_key" without the original record bytes. The bytes exist transiently inside the middleware between sign and submit; once the submit returns, they're gone.

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

The hook is fired post-sign (so the `signature` field is present), pre-submit (so persistence happens before any network attempt), and wrapped in try/catch with promise-rejection capture. The §5.8 degradation contract is preserved: a `onRecord` observer that throws or rejects does not block the tool call, the attribution token in `_meta`, or the log submission.

The first consumer is an MCP wrapper service (kept outside this repo during pre-launch validation) that uses `onRecord` to append records as one JSON per line at a local jsonl mirror under `~/.atrib/records/`.

**Alternatives considered.**

1. *Return signed records from a side-channel API like `getRecord(hash)`.* Rejected because it requires the middleware to retain records in memory indefinitely (memory leak in long-running processes) or expose a query endpoint (new attack surface, new failure mode).

2. *Make the wrapper sign records itself instead of going through the middleware.* Rejected because it duplicates §1.4 signing logic outside `@atrib/mcp` (drift risk: future signing-format changes would have to land in N places). Keep one signer, expose one observer.

3. *Add a "tee" mode where the middleware writes records to a file path passed via `AtribOptions`.* Rejected because file paths are a host concern (sandboxing, permissions, log rotation, format) and embedding them in `@atrib/mcp` couples the protocol middleware to filesystem semantics. The hook lets each host decide how to persist.

4. *Make persistence on-by-default with a sensible path.* Rejected because most consumers of `@atrib/mcp` are server-side or browser-side and have no business writing to a default filesystem location. Opt-in via callback is the right default.

**Consequences.**

- The dogfood verifier's GATE F (`record.sig` Ed25519 replay) becomes runnable once any consumer wires `onRecord` to disk. This closes the previously-named "GAP 2".
- Other consumers (e.g. `@atrib/agent` framework adapters) can use the same hook for their own observability needs — auditing, metrics, replay debugging — without anything specific to the dogfood case being baked in.
- Two new tests in `packages/mcp/test/middleware.test.ts`: (a) records are observed post-sign with the right shape, (b) observer throws don't break tool calls (the §5.8 invariant). All 328 mcp tests continue to pass.

**What this DOESN'T solve.**

- A canonical persistence format. The wrapper writes JSON-per-line; an SDK consumer might write protobuf, ndjson with extra metadata, etc. There's no spec section for "the local audit log format" because that's a host concern.
- Replay protection. If a consumer's `onRecord` is slow or async-unbounded, records can pile up faster than they're persisted. The wrapper today writes synchronously per call, which is fine for a per-tool-call cadence but would need rethinking for high-throughput agent stacks. Out of scope for this ADR.

---

## D030: Log key publication serves both C2SP vkey and JSON, at distinct endpoints

**Date:** 2026-04-27
**Status:** Accepted; deployed alongside D028

**Context.** D028 shipped `GET /v1/pubkey` returning JSON `{origin, public_key, key_id, algorithm}` to close the dogfood verifier's checkpoint-signature gap. During the post-D028 spec sync (atrib-spec.md §2.4.2), an existing spec line surfaced that the D028 ADR had not acknowledged:

> "The verifier key string published at `log.atrib.dev/v1/log-pubkey` encodes the key name, key ID, and public key in the C2SP vkey format"

So the spec already committed the log to publishing its key — but at a different path (`/v1/log-pubkey`) and in a different format (a single C2SP vkey string, `<origin>+<hex(keyid)>+<base64(0x01||pubkey)>`, served as `text/plain`). The D028 implementation diverged from this without amending the spec. The two formats serve different audiences:

- The C2SP vkey form is parsed directly by `golang.org/x/mod/sumdb/note.NewVerifier`, sigsum, tlog-witness, and other tlog ecosystem tooling. These tools expect a key string they can read from a file or URL and pass to a verifier constructor.
- The JSON form is friendlier for hand-rolled verifiers (browser-based verify scripts, end-to-end verification harnesses, future graph-side audit code) that benefit from structured access.

**Decision.** Keep both endpoints, both serving the same key:

- `GET /v1/log-pubkey` returns the C2SP vkey string as `text/plain; charset=utf-8`, per the existing spec line.
- `GET /v1/pubkey` returns JSON as defined by D028.

Both MUST be backed by the same `CheckpointSigner` (same key bytes, same `key_id`, same `origin`). A new test verifies that the vkey-extracted public key bytes equal the bytes returned by the JSON endpoint, and that the vkey-extracted key actually verifies a real `/v1/checkpoint` signature. A new helper `formatVkey(origin, keyId, publicKey)` lives next to `formatCheckpointBody` in `services/log-node/src/checkpoint.ts`; both produce C2SP-formatted artifacts so they cohabit.

The spec was updated in §2.4.2 to document both endpoints, with normative MUSTs that they agree on `origin`, `key_id`, and the underlying public key, and that the published `key_id` equal the 4-byte hex prefix on every `/v1/checkpoint` signature line.

**Alternatives considered.**

1. *Rename `/v1/pubkey` to `/v1/log-pubkey` and switch its response to vkey text format (impl follows spec).* Rejected because the deployed JSON endpoint already has at least one consumer (the dogfood verifier) and changing both path and content type is observable. More importantly, the JSON form is genuinely useful for consumers that don't speak C2SP — converting it to vkey-only would force every such consumer to write a custom parser.

2. *Update §2.4.2 to drop the C2SP vkey reference and document JSON-only at `/v1/pubkey` (spec follows impl).* Rejected because dropping vkey breaks compatibility with existing C2SP-conformant tooling. Witness software, sumdb/note verifiers, and any future cosignature work expect to point at a URL and parse the response as a vkey string. JSON-only forces adapters everywhere.

3. *Single hybrid endpoint at `/v1/pubkey` returning JSON that includes the vkey as a string field.* Rejected because tools like `note.NewVerifier` expect to fetch a vkey directly, not extract one from JSON. Even if such a tool's plumbing could be wrapped to do the extraction, the friction is exactly the kind of "everyone has to write a custom adapter" that C2SP was designed to avoid. The fact that two endpoints cost ~30 lines of code and are both load-bearing for their respective audiences makes the duplication cheap.

**Consequences.**

- Adds a `formatVkey` helper and a `handleLogPubkey` handler. ~30 lines of code, four new tests covering format correctness and end-to-end signature verification under the vkey-extracted key.
- The dogfood verifier (D028 / D029 motivation) will exercise both endpoints to confirm they agree on the key bytes — a small additional gate that catches any future drift between the two surfaces.
- Future witness/cosignature work (planned for V2) gets the canonical vkey URL it needs without any new spec writing; the path was already committed in §2.4.2.

**What this DOESN'T solve.**

- Key rotation, still. D028 explicitly punted that to a future ADR; this resolution doesn't change that. When rotation is implemented, both endpoints will need to grow a versioned representation (likely an array of `{key_id, public_key, valid_from, valid_to}` for `/v1/pubkey` and a multi-line vkey list for `/v1/log-pubkey`). Out of scope.
- Witness key publication. If/when third parties cosign checkpoints, each witness will publish its own vkey from its own service. The atrib spec describes the format the log uses; witness operators apply the same shape to their own infrastructure.

**Acknowledged process failure.** D028 was drafted and shipped without grepping the spec for an existing key-publication contract. The §2.4.2 line was always there. A spec-sync pass should be part of "the ADR is done" rather than an after-the-fact cleanup. Recording this so the lesson outlives the moment.

---

## D031: Reconcile §2.4.3 signed-note divergence from C2SP

**Date:** 2026-04-27
**Status:** Accepted; implemented in commit `096c8a5`

**Context.**

atrib spec §2.4.3 opens with:

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

**Option A — Align implementation with C2SP (proposed and adopted).**

Change `createCheckpointSigner.sign` in `checkpoint.ts` to produce the C2SP encoding: concatenate the 4-byte key ID and 64-byte signature, base64-encode the resulting 68-byte blob, omit the `+` delimiter. Update spec [§2.4.3](atrib-spec.md#243-signed-note-format) to replace the hex+base64 description with the correct C2SP encoding. Update the `parseCheckpoint` function in `verify-loop.mjs` to decode the token as one base64 string and split at byte offset 4.

Consequences:
- `note.NewVerifier` and every C2SP-conformant tool (tlog-witness, sigsum, cosign tooling) parses atrib checkpoints without adapters.
- The witness/cosignature work in [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) uses standard C2SP tooling with no custom parsers. C2SP conformance for signed notes is a prerequisite for [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) implementation; this resolves that blocker.
- The production log requires a redeploy. Any consumer that parses the current signature format must update its parser.
- Existing tests that assert the old format string require one-time updates.

**Option B — Amend spec to own the divergence.**

Remove the "per the C2SP signed-note specification" claim from [§2.4.3](atrib-spec.md#243-signed-note-format). Replace it with an explicit definition of atrib's hex+base64 form as the protocol's own checkpoint signature format. No code change.

Consequences:
- No operational risk.
- atrib checkpoint signatures cannot be parsed by `note.NewVerifier` or any C2SP-conformant tool without a custom adapter. Every integrator who expected C2SP tooling to work needs that adapter explained.
- Witness/cosignature work ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures)) requires custom parsers in every participant's toolchain. Ongoing cost, not one-time transition.
- The C2SP tlog-tiles ecosystem claim in CLAUDE.md becomes inaccurate for the "signed notes" and "witnessing" clauses.

**Option C — Serve both formats.**

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

## D032: Witnessing posture for V1 — spec defined, no implementation

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

1. *Mandate a minimum threshold in the spec.* Rejected because it violates the no-thumb-on-the-scale invariant. Different consumers (a hobbyist project, a payments protocol, a regulator) genuinely need different thresholds; the protocol shouldn't pre-pick.

2. *Operator-aggregated cosignature delivery (Sigstore Rekor pattern).* Rejected because it does not survive threat 2. A compromised operator with the operator's signing key can hide unfavorable cosigs from `/v1/checkpoint` and present a forged checkpoint as uncosigned-but-genuine. Witness-published delivery moves the cosignature path off the operator entirely.

3. *Define a witness registry now.* Rejected because we have no witnesses and no non-operator verifiers. Different ecosystems pick different registry shapes (Sigsum: open; Sigstore: curated; sumdb: directory). Locking in one before knowing the first witness operator's actual needs would be a wrong abstraction.

4. *Implement a first-party witness service for log.atrib.dev.* Rejected because a witness operated by the same party as the log is structurally useless against threats 1, 2, and 3. Self-witnessing only matters once there is a second atrib log to cross-witness or a non-operator party with an incentive to witness. Neither exists today.

**Consequences.**

- [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) is now complete: normative format and delivery, informational verifier behavior, explicit V1 scope boundary on registry/discovery.
- A future witness operator can implement against the spec without further atrib coordination. The core code (fetch checkpoint, verify operator sig, verify consistency proof, sign cosig input, publish at `/v1/cosig/...`) parallels what `services/log-node/` already does and is ~200 lines of Node.
- The dogfood verifier does NOT yet check cosignatures. When a witness exists, adding the gate is mechanical: signature lines whose decoded payload is 76 bytes are cosigs; look up witness keyHash → trusted vkey; verify per [§2.9.2](atrib-spec.md#292-cosignature-format-normative); apply threshold.
- The Sigsum-pattern choice means atrib will not drop-in to ecosystems that assume operator-aggregated delivery (Rekor). The trade-off is honest: those ecosystems implicitly accept threat 2 in exchange for simpler verifier configuration. atrib chooses the harder configuration in exchange for surviving operator compromise.

**What this DOESN'T solve.**

- *Witness bootstrapping.* The first witness will exist when atrib has a second-party verifier that wants one. The spec describes the contract; the spec does not solve the social problem of recruiting witnesses.
- *Witness staleness and liveness.* A verifier checking cosig timestamps can detect an obviously dead witness, but a witness that goes dark for months is harder. V2 may add liveness expectations.
- *Witness key rotation.* Same gap as the log key rotation deferred from [D028](#d028-log-exposes-its-signing-pubkey-at-get-v1pubkey-for-self-contained-verification). Witnesses will need rotation when atrib does.
- *Cosignature retention windows.* How long must a witness keep its cosigs queryable? Verifiers may want historical cosigs to verify old settlement documents. V2.

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

1. *External CRL (certificate revocation list) maintained by the operator.* Rejected because it puts the operator in the trust path of revocation. A compromised operator could refuse to publish a creator's revocation. Putting revocation in the log inherits the log's tamper-evidence properties.

2. *Bound time-windows on creator keys (90-day expiry).* Rejected as overly prescriptive. Different creators have different operational realities. A managed-service creator may rotate weekly; a hobbyist may go years. The protocol should not impose a global rotation schedule. Operators can adopt one as policy without needing protocol enforcement.

3. *Treat all post-revocation records as silently invalid (drop verification_state to `'unsigned'`).* Rejected because it loses information. Distinguishing `'revoked_after_revocation'` from `'unsigned'` lets a verifier or auditor see that the record was technically signed correctly but post-revocation, which is meaningfully different from an unsigned record (no signature ever existed).

4. *Allow revocation by any party who can produce the public key.* Rejected because it creates a denial-of-service vector: anyone could revoke any creator's key. Requiring the revocation to be signed by the key being retired (or by an emergency key the creator registered up-front) prevents this.

5. *Mandate `successor_key` always.* Rejected because some revocations are terminal (creator going out of business, project deprecated). Forcing `successor_key` would force ceremonial bridging.

**Consequences.**

- Spec gains [§1.9](atrib-spec.md#19-key-rotation-and-revocation) with the format and semantics. Conformance corpus at `spec/conformance/1.9/` covers: valid rotation, valid retirement, valid compromise (signed by emergency key), invalid revocation signed by wrong key, post-revocation record correctly flagged.
- `@atrib/verify` and `services/graph-node` gain logic to detect and apply revocation records during graph construction. `verification_state` enum extends with `'revoked_after_revocation'`.
- `@atrib/cli` gains `atrib revoke --keychain --reason ROTATION --successor PUBKEY` for operator-driven rotation.
- `services/log-node` does not need changes: revocation records flow through the same submission path as any other record.
- Directory ([D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) consults revocations to update the active key for an identity claim.

**What this DOESN'T solve.**

- *Past records signed by a key compromised but used legitimately.* If a key was compromised on day 100 but used legitimately on days 0-99 and maliciously on days 100-150 before the revocation lands, days 100-150 still verify under the original key with no signal of compromise. The verifier sees `'revoked_after_revocation'` only post-150. A "compromise window" annotation is V2 work.
- *Forward-secret rotation.* Successor key inherits identity but the attacker who has the old key can still produce records that look legitimate under the old pubkey for the pre-revocation window. True forward secrecy would require a key-evolution scheme (e.g., HORS, hash chains). Out of scope.
- *Operator key rotation.* The log's signing key has the same problem as creator keys, plus an additional one: rotating the log key invalidates every prior inclusion proof's signature. Log-key rotation is its own ADR (deferred to V2).

**Implementation sequencing.** an upcoming implementation phase implements revocation + the directory together because they share data structures and verifier logic.

---

## D034: Public-key directory architecture (AKD unblinded; VRF-blinded mode available for downstream consumers)

**Date:** 2026-04-27
**Status:** Accepted; spec [§6](atrib-spec.md#6-key-directory) drafted, implementation in an upcoming implementation phase

**Context.** Atrib records carry `creator_key` as opaque base64url bytes. A verifier seeing such a record has no way to learn "who is this?" There is no canonical mapping from `creator_key` to identity. The post-B+C audit identified this as the most consequential infrastructure gap: without a directory, attribution is purely cryptographic and not semantically meaningful to anyone except the original signer.

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

1. *Roll an append-only registry on the existing Tessera log.* Rejected after the 80/20 analysis: the missing 20% (efficient lookup, non-membership proofs, latest-version proofs, per-label append-only semantics, operator-independent index correctness) is exactly the trustworthy-directory part. AKD provides all of these. Rolling our own would be partial and would need to be replaced anyway.

2. *Build a custom directory protocol.* Rejected because AKD is mature, audited, and reused by Meta in production for WhatsApp key transparency. Reinventing it is unjustified scope.

3. *Atrib uses unblinded forever; downstream privacy-preserving consumers fork to a different library.* Rejected because the two configurations share a substantive amount of operational infrastructure (witness model, append-only proof, rotation handling). Forking would mean maintaining two implementations of the same Merkle structure.

4. *Host the directory in the same Tessera log.* Rejected because directory entries form a different per-label append-only structure than tlog-tiles' entry-indexed structure. Conflating them would force one of them into the wrong abstraction. They share the witness pattern but not the data model.

5. *Defer directory until V2.* Rejected because the post-B+C audit identified it as load-bearing for the dogfood thesis. Without it, "agents reason from a past they can prove" is a cryptographic statement about bytes, not a semantic statement about identity.

**Consequences.**

- New service `services/directory-node/` (TypeScript wrapper around AKD via WASM bridge per the §3.1 benchmark dated 2026-04-29; rust-wasm via wasm-pack chosen).
- New package `@atrib/directory` exposing `publish`, `lookup`, `history`, `proveAbsence` SDK methods.
- `@atrib/verify` consumes the directory and annotates verification results with `identity_resolved`.
- The recall tool (an MCP server consumed by the host agent) annotates returned records with the resolved identity claim per record.
- Spec [§6](atrib-spec.md#6-key-directory) covers: claim format, AKD operations, witness model parity with [§2.9](atrib-spec.md#29-witnessing-and-cosignatures), verifier consultation algorithm.
- Downstream consumers requiring VRF-blinded lookup adopt the same AKD library configured for that mode, in their own service. Their configuration spec references [D034](#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers).

**What this DOESN'T solve.**

- *Identity verification beyond self-attestation.* The protocol records claims but does not enforce that claim subjects are who they say they are. Domain verification and DID resolution are spec'd but the trust comes from the underlying mechanism (DNS, DID method), not from atrib.
- *Privacy of unblinded mode.* atrib's directory is public by design. Anyone can enumerate registered creator_keys and their claims. This is correct for attribution (where keys appear on a public log anyway). It would be wrong for privacy-sensitive consumers, which is why AKD also offers VRF-blinded mode for them.
- *AKD's own implementation correctness.* atrib trusts the AKD crate. If AKD has a bug, atrib has the bug. Mitigation: pin the version, follow upstream advisories, run AKD's own conformance suite as part of CI.
- *Directory-key rotation.* The directory-signing key has the same rotation problem as the log-signing key. Same V2 deferral.

**Implementation sequencing.** Bridge benchmark (2026-04-29): WASM lookup at 100K labels measured at 1.8ms p95, comfortably under the 50ms threshold from §3.1. Decision: ship WASM via wasm-pack + wasm-bindgen. NAPI would be ~5x faster (typical native vs WASM ratio for crypto-heavy code) but the distribution simplicity (single .wasm artifact vs per-platform .node binaries), sandbox property, and zero-toolchain install requirement make WASM the right tradeoff. AKD parallelism is gated to `disabled()` in the WASM target because WASM runtimes lack a Tokio executor; insert throughput drops to ~6.3K labels/sec single-threaded, which is comfortably above the per-operation anchoring cadence (§6.2.4). Sequence: AKD WASM bridge crate → @atrib/directory package → services/directory-node service → wire into @atrib/verify → wire into recall.

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

1. *Closed enum with periodic additions per consumer request.* Solves no consumer's case fully and biases the enum toward whichever architectures arrive first. Each subsequent architecture either fits the existing types poorly (substrate-blindness pattern: misusing `tool_call` for non-tool primitives) or proposes its own additions, producing chronic spec churn.

2. *Closed enum, allow non-normative string values without canonicalization.* Spec says: "atrib's normative set is X, Y, Z; consumers MAY use other strings." Rejected because string-typed event_types lack namespacing; two consumers can mint the same string with conflicting semantics. The collision risk grows with adoption. URI typing solves this with no downside beyond field length.

3. *Add an optional `event_subtype` string field; keep `event_type` as the closed enum.* Rejected as a hybrid that has the worst of both. The split between normative `event_type` and freeform `event_subtype` creates an awkward indirection (verifiers always need to look at both); the subtype namespace still has the collision-risk problem of option 2; the closed `event_type` enum still becomes a bottleneck for any genuinely new top-level primitive.

4. *Drop `event_type` entirely; classification lives in content.* Rejected because the 1-byte log entry slot is genuinely useful for fast-path filtering at the log-byte level (regulators querying "all transactions" don't want to fetch every record). Removing it forces all type-based queries through content fetch. The byte stays; the question is what its values mean.

5. *URI-type but use a namespaced-token form (e.g., `atrib:v1:tool_call`, `vendor:observation`) instead of full URIs.* Rejected because the URI form is more standard, supports natural resolution to a schema document if the consumer provides one, and matches W3C VC / Sigstore in-toto / ActivityStreams precedent. The verbosity cost is negligible (~30-80 bytes per record).

6. *Add a fixed set of new normative types (e.g., `0x03`–`0x06`) for cognitive primitives now and revisit later.* Rejected because adding fixed normative types and later moving to URI typing produces a hybrid that all subsequent code must handle (some records have short-token event_types; others have URIs; both must be valid). Cleaner to make the structural change once.

**Consequences.**

- *Spec.* [§1.3](atrib-spec.md#13-canonical-serialization) (record format) updated: `event_type` is an absolute URI. [§2.3.1](atrib-spec.md#231-entry-serialization) (binary entry) updated: byte `0x03` reserved for `observation`, `0xFF` for extension. [§2](atrib-spec.md#2-merkle-log-protocol) normatively defines the byte→URI mapping for atrib's canonical set. [§1.7](atrib-spec.md#17-transaction-event-hooks) (payment-protocol detection) unchanged: still emits `transaction` URI on detection. New [§1.4.5](atrib-spec.md#145-event_type-uri-validation) added: URI validation requirements.
- *`@atrib/mcp`.* `types.ts` `EventType` becomes `string` (URI-typed) with a constant block exporting the three normative URIs. `signing.ts` `verifyRecord` checks URI is syntactically valid; rejects empty / relative URIs. `entry.ts` adds the `0x03` and `0xFF` byte mappings. Emitters default to URI form.
- *`@atrib/agent`.* All adapters automatically emit `tool_call` URI; transaction-detection logic emits `transaction` URI. No adapter API change.
- *`@atrib/verify`.* Verification output gains an `event_type_uri` field (always populated) and a `event_type_recognized` boolean (true iff URI is in atrib's normative set or a registered consumer set the verifier was configured with). Recognition is informational, not a verification-pass criterion.
- *log-node / log-dev.* `validateSubmission` updates: accepts URI-typed `event_type`; maps to byte for entry encoding (atrib normative URIs to `0x01`/`0x02`/`0x03`; everything else to `0xFF`). Rejects records with syntactically-invalid URIs.
- *Conformance.* `spec/conformance/1.4/` corpus contains URI-typed examples. New `spec/conformance/1.4-extension/` corpus with sample extension-namespace URIs. `spec/conformance/2.6.1/` validated against URI-typed submissions.
- *Downstream consumers.* Consumers needing primitives beyond atrib's normative set mint URIs in their own namespaces (e.g., a cognitive-substrate consumer might mint `https://example.com/v1/types/annotation`, `proposal`, `apply` under a domain it controls). The choice is theirs; atrib does not prescribe.

**What this DOESN'T solve.**

- *Cross-consumer semantic alignment.* Two consumers minting URIs for similar concepts (e.g., one's `assertion` vs another's `claim`) get no automatic alignment. Verifiers treating both as equivalent need their own mapping table. This is the same situation as MIME types or VC `@type`: namespacing prevents collision but doesn't enforce convergence.
- *Schema discovery.* atrib does not require URIs to resolve to a schema document. A consumer that wants schema-aware verification publishes their own schema and configures their verifier; atrib provides no resolution infrastructure.
- *Wire-format compatibility across implementations at a single point in time.* Implementations that have not yet adopted URI-typed `event_type` will reject these records as malformed. Cross-implementation upgrade is coordinated by the implementations involved.

**Implementation sequencing.** Spec [§1.3](atrib-spec.md#13-canonical-serialization) + [§2.3.1](atrib-spec.md#231-entry-serialization) + [§1.4.5](atrib-spec.md#145-event_type-uri-validation) update → `@atrib/mcp` types + signing + entry update → `@atrib/agent` smoke test that adapters produce valid records → log-node + log-dev validation update → conformance corpus regeneration → `@atrib/verify` URI-aware verification output → unit tests across the matrix.

## D036: Bar for promoting an extension URI to atrib's normative event_type vocabulary

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D035](#d035-extensible-event_type-vocabulary-via-uri-typing) established that anyone can mint extension `event_type` URIs. atrib's normative vocabulary remains open to additions, but the criteria for adding an extension URI to atrib's canonical core need to be defined explicitly. A poorly-defined bar produces either spec sprawl (every consumer's preferred primitive ends up canonical) or capture (one or two consumers' worldview gets picked as canonical and locks subsequent architectures into mismatched primitives).

The goal is a bar that produces coherent decisions over time without requiring re-litigation, while being permissive enough that genuine convergence is not blocked by procedural friction. Rigid numerical thresholds (e.g., "exactly 3 consumers must request it") fail the latter: real consensus rarely arrives in clean numerical form. Vague principles fail the former: future maintainers have nothing to anchor decisions to.

The chosen frame: principled criteria that depend on observation rather than petition. atrib promotes a URI to normative when the conditions described below are observably true, not when a consumer asks for promotion. Extension URIs do not require atrib's blessing to be valid; they are valid the moment they are minted. Promotion to atrib's namespace is purely a downstream tooling convenience.

**Decision.**

A type is eligible for promotion to atrib's normative URI namespace when the following indicators hold *together*. None is individually sufficient; they form a posture, not a checklist.

1. **Architecture-agnostic in practice.** The primitive appears across multiple independent consumer categories already in use, not within a single architectural lineage. Functional distinctness across categories (e.g., memory products + multi-agent orchestration + regulated AI) is the relevant signal; multiple implementations within a single category is not. The point is breadth across worldviews, not depth within one.

2. **Structurally distinct from existing normative types.** The primitive is not a special case of `tool_call` with metadata, not a status variant of `transaction`, not a sub-event of `observation`. If a careful read can model the primitive as one of the existing normative URIs plus a content field, it stays in extension namespace. Genuinely new structure is the bar; richer content is not.

3. **Filterable benefit at the log-byte level.** Verifiers running real queries gain meaningfully more from byte-level filtering than from content fetch + parse. A primitive that's queried frequently across the consumer base (e.g., regulators querying for "transactions") clears this; a primitive of interest mainly to one consumer's tooling does not.

4. **Atrib protocol load-bearing OR observably canonical in extension form.** Either atrib's own [§3](atrib-spec.md#3-graph-query-interface) graph derivation or [§4](atrib-spec.md#4-attribution-policy-format) calculation depends on distinguishing this primitive (load-bearing), or the same extension URI has been independently adopted by multiple consumer categories with consistent semantics across them (observably canonical). The first is rare and decisive; the second is the more common path.

5. **Promotion is non-disruptive.** The primitive's wire and graph behavior under its extension URI is consistent with what its normative URI would be. Consumers using the extension URI before promotion can swap to the normative URI without changing their semantics. If promotion would change behavior in a way existing extension users have to migrate around, the bar is not met (or the change is not a promotion, it is a redesign).

The rule is *additive*. atrib does not retire normative URIs; once promoted, they stay. The cost of promotion is therefore long-lived; this asymmetry is intentional and is what motivates the conservative posture.

**Posture and judgment.**

The five indicators describe a structural condition the protocol has reached, not steps a consumer has performed. Maintainers evaluating a candidate ask: do the indicators hold? not: did the consumer file the right paperwork? Accordingly:

- *No formal request process.* Anyone can write an issue or PR proposing promotion of an extension URI. The maintainers' response is an evaluation of the indicators, not a procedural pass/fail. A request is welcome but not required for consideration; observation is enough.
- *No fixed cadence.* Promotions happen when warranted, not on a schedule. atrib does not commit to "review extensions quarterly" or similar.
- *No tier system.* atrib does not maintain "candidate," "experimental," or "deprecated" sub-states for extension URIs. URIs are either in atrib's normative set (consequence: atrib protocol may treat them specially) or they are not (consequence: they are valid extension URIs, no special protocol behavior). Binary.
- *Promotion is reversible only via deprecation, not removal.* A normative URI deemed in retrospect unwise becomes deprecated (verifiers warn but accept) but never invalidated. Removing it would break records signed under it.

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

1. *Numerical threshold ("≥N independent consumers requesting promotion").* Rejected because real adoption rarely surfaces in petition form. A primitive could be in heavy use across many categories without anyone "requesting" anything; another could have many petitions from a single architectural lineage. The threshold rewards bureaucracy over signal.

2. *Formal RFC process.* Rejected as overhead that does not produce better decisions at the protocol's current scale. If atrib reaches an ecosystem size where a process is warranted, this ADR is replaced by a successor that defines one.

3. *Tier system (candidate / experimental / promoted / deprecated).* Rejected because it adds protocol-level state that downstream tooling has to handle. URIs are either normative or extension; atrib does not maintain a tier-tracking surface. Tier-like distinctions can exist informally in a registry document outside the spec.

4. *Fixed cadence ("evaluate extensions quarterly").* Rejected because most periods there will be nothing to promote. Forcing a cadence biases toward false-positive promotions.

5. *Anyone can promote their own URI by following a procedure.* Rejected because that's the same as having no normative core: if every consumer's URI is normative, the distinction collapses and atrib's vocabulary becomes the union of every downstream's vocabulary. Promotion has to be a deliberate act by atrib, with criteria observable from outside the consumer that benefits from it.

**Consequences.**

- atrib publishes its normative URI set in spec [§1.2.4](atrib-spec.md#124-event_type-values) with promotion history. Each entry includes: the URI, the date promoted, the byte mapping (if any), a one-sentence semantic statement, and a pointer to the ADR that promoted it.
- Promotion of a URI to atrib normative status requires a new ADR (or an amendment to [D035](#d035-extensible-event_type-vocabulary-via-uri-typing)) referencing this bar, with an evaluation against the five indicators recorded inline.
- The ADR referencing this bar serves as the historical record of the decision; future maintainers can re-evaluate whether the bar produced the right outcome by reading both the ADR and the subsequent observation period.
- Consumers proposing promotion get a transparent answer (the indicators above) without atrib needing to maintain a process.
- Maintainers facing a promotion proposal apply the bar in one document and either promote (new ADR + spec update) or explain (issue comment + close).

**What this DOESN'T solve.**

- *Disagreement between maintainers about whether an indicator holds.* The bar is interpretive; reasonable people can read the same evidence differently. The mitigation is: write down the evidence in the proposal, write down the maintainer's read in the response, and let the historical record show which judgments aged well.
- *Drift between extension URIs and atrib's normative set.* If atrib promotes `observation` but a consumer has been using `https://example.com/observation` with subtly different semantics, their existing records remain under their URI; their new records may target atrib's URI; verifiers comparing the two need their own mapping. atrib does not enforce migration.
- *Silent adoption.* atrib only knows about promotions when extension URIs become observable. Closed-source consumers using atrib in production may have URIs that should be promoted but are not visible to atrib's maintainers. The mitigation is: encourage consumers to publish their URI choices in their own documentation, but not as a normative requirement.

**Implementation sequencing.** [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) has no implementation. It is a governance ADR. The first application of the bar is the normative set defined in [D035](#d035-extensible-event_type-vocabulary-via-uri-typing): `tool_call`, `transaction`, `observation`. The next application will be whoever proposes the next promotion.

## D037: HSM/KMS operator profile

**Date:** 2026-04-30
**Status:** Accepted (design only; implementation gated)

**Context.** The `creator_key` Ed25519 seed is stored as 32 raw bytes — in env variables, in `~/.atrib/keys/`, or in macOS Keychain (per [D033](#d033-key-rotation-and-revocation)). In development this is acceptable under a single-machine compromise threat model (covered by Keychain + per-process file-mode 0600). In production, key material must never reside in process memory at all. The standard deployment profile uses HSM-backed signing: key material resides within a Cloud KMS, Vault Transit engine, or hardware YubiHSM; the wrapper requests signatures for canonical records without holding the raw bytes.

The `keystore: 'callback'` mode (designed and merged but not yet wired end-to-end) provides the wrapper-side hook. This ADR records the operator profile that closes the loop.

**Decision.**

1. **Three reference profiles.** atrib documents three operator profiles for HSM-backed signing, all using the same `keystore: 'callback'` middleware option:
   - **AWS KMS** — `Sign` API call against a `KEY_USAGE: SIGN_VERIFY` key with `KEY_SPEC: ECC_NIST_P256` initially (deferring Ed25519 KMS support, which AWS announced in 2023 but staged region-by-region; this profile lists Ed25519 as the long-term target). Latency: ~30-50ms per sign. Cost: ~$0.03 per 10K signs.
   - **HashiCorp Vault Transit** — `transit/sign/<key>` endpoint with `key_type: ed25519`. Latency: ~5-15ms when Vault is co-located. Cost: license-dependent; effectively free if Vault is already deployed.
   - **YubiHSM 2** — local-network HSM with PKCS#11 binding via `pkcs11js`. Latency: ~10ms. Cost: hardware capex (~$650 per unit) + zero ongoing.

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

3. **No coupling between profile and protocol.** atrib does not specify which HSM operators must use. Any backend that can produce a 64-byte Ed25519 signature over a 32+ byte canonical input qualifies. Non-Ed25519 HSMs (RSA-only, ECDSA-only) are not supported by atrib v1 — the Ed25519 choice ([§1.4.1](atrib-spec.md#141-key-format)) is normative.

4. **Where this lives in the spec.** [§7.6](atrib-spec.md#76-hsm-operator-profile) (new subsection) documents the callback contract and the three reference profiles. The profile section is informative; the callback signature is normative.

**Alternatives considered.**

1. *Operator-managed RFC 7468 PEM file with passphrase-encrypted seed.* Rejected — passphrase has the same memory-residency problem as the bare seed once decrypted, and adds a UX layer (passphrase prompt) that breaks unattended deployments.

2. *Atrib bundles its own HSM client per backend.* Rejected — proliferates dependencies and makes atrib responsible for HSM SDK upgrade cycles. The callback mode lets operators bring their own client.

3. *Bootstrap from cloud-provider IMDS.* Rejected as the default path because it ties atrib to specific cloud environments. Documented as "additional pattern: AWS Lambda may use IMDSv2 to fetch a session-scoped KMS key" but not the headline.

**Consequences.**

- *Spec.* New [§7.6](atrib-spec.md#76-hsm-operator-profile) subsection (informative profiles + normative callback contract).
- *Wrapper.* `keystore: 'callback'` is the load-bearing change — already designed, validation against a mock HSM signer closes the implementation gap.
- *Documentation.* Each profile gets a 1-2 page operator runbook in `docs/operator/hsm-<profile>.md`; runbooks are drafted privately and promoted to public at first non-operator adoption.
- *No breaking changes.* The `keystore: 'env' | 'file' | 'keychain'` modes remain available for solo operators / dev. Callback mode is additive.

**What this DOES NOT solve.**

- *Key escrow.* HSMs prevent extraction; they don't address "we lost access to the HSM and need our records to keep working." Per [§1.9.2](atrib-spec.md#192-signing-rules), the emergency-key path covers this — if the operator pre-registered an emergency key, they can revoke compromised + rotate to a successor without HSM access.
- *Multi-region HSM topology.* If the operator's wrapper is in us-east-1 and the HSM is in eu-west-1, every sign is a transatlantic round-trip. atrib doesn't prescribe topology; the latency tradeoff is the operator's call.
- *Auditability of HSM-side decisions.* AWS KMS, Vault, and YubiHSM each have their own audit log. atrib's [D039](#d039-audit-log-for-key-access) audit log is wrapper-side; it captures every sign request and the public key in use, but not the HSM's internal decision-making.

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

1. **Spec the derivation, defer the implementation to V2.** [§1.10](atrib-spec.md#110-per-conversation-key-derivation) (new subsection) is informative for v1 — implementations MAY support derivation but MUST NOT require it. The bare creator_key path remains the default.

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
         "info_format": "context_id || conversation_id"
       }
     }
   }
   ```
   Verifiers seeing `derivation` consult [§1.10](atrib-spec.md#110-per-conversation-key-derivation) to re-derive the expected per-conversation public key for the record being verified.

4. **Backward compatibility.** Identity claims WITHOUT `derivation` continue to be verified against the bare `creator_key`. Records WITH `conversation_id` but whose claim has no `derivation` are flagged `claim_derivation_mismatch: true` (soft signal per [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) failure semantics).

5. **No revocation propagation.** Revoking the master key revokes all derived keys (they share the master in their ancestry). Revoking a single derived key is NOT supported in this design — the granularity is per-master.

**Alternatives considered.**

1. *Per-record derivation (full forward secrecy).* Rejected for v1 — every record requires a fresh KDF call + signature against a fresh public key, which compounds verifier work (every record requires re-deriving and looking up). The per-conversation grain is the right balance: bounded number of derived keys per master, all derivable on demand.

2. *Threshold signatures (k-of-n cosigners).* Rejected as out of scope. Threshold schemes solve the operational continuity problem differently (no single key to compromise) but require significant cryptographic infrastructure. atrib v1 stays with single-key Ed25519.

3. *Stateful key derivation (chain forward like Signal).* Rejected because it requires synchronized state between the agent and the verifier — both must replay from the master to the current per-conv key. The HKDF design is stateless: any verifier can derive any per-conv key independently.

**Consequences.**

- *Spec.* New [§1.10](atrib-spec.md#110-per-conversation-key-derivation) subsection (informative for v1, normative if/when an implementation adopts it). New optional `conversation_id` record field. New optional `claim_subject.derivation` field.
- *Wrapper.* No code changes for v1. Future implementations add a `keyMode: 'derived' | 'master'` middleware option.
- *Verifier.* No code changes for v1. Future implementations re-derive per-conversation public keys when verifying records that carry `conversation_id`.
- *Directory.* No schema changes — `claim_subject` is already a free-form JSON object per [§6.1](atrib-spec.md#61-identity-claim-format).

**What this DOES NOT solve.**

- *Master key compromise.* If the master seed leaks, every derived key is reproducible. The compromise blast radius is reduced for short-lived derived keys (post-revocation new conversations get fresh keys), but the historical record signed under any conversation's pre-revocation derived key is forensically replayable from the leaked master.
- *Mixing modes within one identity.* An identity that has SOME records signed with the master and OTHERS signed with derived keys is permitted but operationally confusing. Recommend operators commit to one mode per identity.

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
     "ts": 1743850000000,           // ms since epoch
     "op": "sign",                  // 'sign' | 'load_seed' | 'derive'
     "pid": 12345,                  // process id
     "ppid": 12344,                 // parent process id
     "node_v": "v22.0.0",           // node version (helps trace)
     "creator_key": "<base64url>",  // public key (NEVER the seed)
     "context_id": "<32-hex>",      // when applicable; redacted to null for non-record-bound ops
     "record_hash": "sha256:..."    // for sign ops; null otherwise
   }
   ```
   Notably ABSENT: the canonical signing input bytes, the resulting signature, and any seed material.
3. **Optional remote sync.** The wrapper supports `ATRIB_AUDIT_FORWARD=<url>` for streaming each line to an operator's SIEM (e.g., a Splunk HEC endpoint, an OpenTelemetry collector). The forwarder is fire-and-forget per [§5.8](atrib-spec.md#58-degradation-contract); a failed forward warns once and continues.
4. **Rotation.** One file per UTC day. Implicit rotation at midnight; the wrapper does not delete old files (operator policy).
5. **Where this DOES NOT live.** The audit log lives wrapper-side (filesystem or organizational SIEM). It is NOT submitted to the public log — the contents (process IDs, parent process IDs, op timing) are operational data that stays local to the deploying organization.

**Alternatives considered.**

1. *No audit log; rely on the public log.* Rejected — the public log records the OUTCOME of signing (the record committed), not the wrapper-side ATTEMPT. Failed signs, retries, and idempotent cache hits never appear publicly. An operator investigating a compromise needs the wrapper's view.
2. *syslog / journald instead of JSONL.* Rejected — JSONL is portable across OSes, easy to grep, and trivially forwardable. syslog would couple atrib to OS-specific configuration.
3. *Encrypted audit file (AES-GCM with a separate audit key).* Rejected for v1 — adds a key-management problem to solve a problem most operators don't have. File-mode 0600 + filesystem encryption (FileVault, LUKS) is the v1 default. Operators with stricter requirements use the SIEM forward.

**Consequences.**

- *Wrapper.* New `audit.ts` module in `packages/mcp/`. New env vars: `ATRIB_AUDIT_PATH`, `ATRIB_AUDIT_FORWARD`. Audit calls hooked into `signRecord` + `loadSeed`.
- *No spec changes.* The audit log is a wrapper-implementation concern, not protocol.
- *Default-on.* The audit log is created on first sign operation. Operators who want to disable it set `ATRIB_AUDIT_PATH=/dev/null`.

**What this DOES NOT solve.**

- *Tamper-evident audit.* The JSONL file is plain text, append-only by convention only — an attacker with filesystem write access can rewrite history. For tamper-evidence, the operator forwards to a SIEM with cryptographic timestamping. Building atrib-side tamper-evidence (sign each line, chain via the previous line's hash) is V2 work.
- *Cross-host correlation.* When one logical "wrapper" runs across multiple processes (e.g., Node cluster mode), each process produces its own audit file. Correlation requires the operator to ship them all to the same SIEM.

**Implementation sequencing.** `audit.ts` module → hook `signRecord` + `loadSeed` → integration tests asserting line shape + file mode → operator runbook documenting the format and SIEM forwarding example.

## D040: Reserved

D040 is reserved for the harness reference implementation ADR: scope of `@atrib/recall`, why it's informative-not-normative. It will be authored when `@atrib/recall` is published to the `packages/recall/` directory.

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

1. *No primitive; consumers build out-of-band linkage.* Rejected because every consumer reinvents the same shape with different semantics. Verifiers cannot compose. Cross-consumer reasoning audit becomes impossible.

2. *Implicit derivation from chain order.* Rejected because chain order proves precedence, not consultation. Two records in chain order need not have informed each other; the agent may have ignored A entirely when deciding B.

3. *New normative event_type for "informed_by" claims.* Rejected because it shifts the question to a different layer without solving it. INFORMED_BY needs to be a structural property of any record, not a separate record type.

4. *Inline content references rather than record_hash.* Rejected because content references re-leak whatever the referenced records leak. Hash references say "this record informed me" without re-disclosing content.

5. *Auto-tracking only; no field.* Rejected because middleware can only track what flows through it. Records the agent reads via side channels (its own memory, external state) cannot be auto-tracked. The field is the only way to express the agent's complete claim.

**Consequences.**

- *Spec.* [§1.2](atrib-spec.md#12-the-attribution-record) (record format) gains `informed_by` field definition. [§1.3](atrib-spec.md#13-canonical-serialization) (canonical serialization) updates JCS field-order example. [§3.2.3](atrib-spec.md#323-edge-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) add INFORMED_BY edge type and derivation rule. [§3.2.1](atrib-spec.md#321-node-types) records that any node type may be the source or target of an INFORMED_BY edge.
- *`@atrib/mcp`.* Record type gains optional `informed_by: string[]`. Signing/verification updates JCS canonicalization to include the field when present. New helper `recordOptions.informedBy: string[]` to allow agent override of middleware auto-tracking ([D048](#d048-plug-and-play-enforcement-contract-for-adapters)).
- *`@atrib/agent`.* Adapters gain a context tracker that records hashes of records the agent has consumed via tool results, observations, and inbound provenance. Auto-populates `informed_by` on subsequent emissions. Agent override available via `recordOptions.informedBy`.
- *`@atrib/verify`.* Verification output gains `informed_by_resolution: { resolved: ResolvedRecord[], dangling: string[] }` per record. Dangling references are flagged but do not fail verification (the claim was signed; the referent's absence is a different question).
- *services/graph-node.* Edge derivation gains step 6 (INFORMED_BY). Node response includes `informed_by_count` for browseability.
- *Conformance.* `spec/conformance/1.4/` corpus gains vectors with and without `informed_by`. New `spec/conformance/3.2.4/informed-by/` corpus exercises the derivation rule.

**What this DOESN'T solve.**

- *Truthfulness of the claim.* atrib does not prove the listed records actually informed the action. A malicious or careless agent can claim records that did not inform, or omit records that did. Truthfulness verification is a downstream concern: cross-check content (when revealed) against the claimed action.
- *Reasoning between records.* `informed_by` says "these records informed me." It does not say what the agent reasoned about between them. Reasoning auditability is the harness-side pattern in [D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern).
- *Privacy of the linkage itself.* Listing record_hashes discloses the agent's claimed reasoning composition. This is the structural disclosure that makes auditability work; consumers wanting finer control commit to a hash of the sorted list (`informed_by_commitment`) and reveal selectively. The commitment-and-reveal pattern is harness-layer; [D045](#d045-privacy-postures-normative-spec-section) documents it as a privacy posture option.

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

1. *Keep observation excluded.* Rejected because the cost is concrete: INFORMED_BY edges pointing at observations would dangle, and the chain spine would have gaps where the natural context records belong. The original conservative choice was reasonable for v1 in isolation; [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) changes the calculus.

2. *Promote observation to the [§4.6](atrib-spec.md#46-the-calculation-algorithm) contributing set.* Rejected because observations are witnesses, not actions. Including them in attribution would inflate claimed contributions for any agent that records its own observations. The fact/policy boundary requires observations to be queryable but not weighted by default.

3. *Add observation to CONVERGES_ON.* Rejected for the same reason as #2: CONVERGES_ON is the structural prerequisite for [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation. If observations carry CONVERGES_ON edges, attribution policies that count CONVERGES_ON would over-count.

4. *Define a separate "OBSERVATION_PRECEDES" edge type.* Rejected as artificial taxonomy growth. The temporal/chain semantics are identical for tool_calls and observations; introducing a parallel edge type for one event_type is structural duplication without benefit.

**Consequences.**

- *Spec.* [§3.2.1](atrib-spec.md#321-node-types) node types entry for observation is updated: observation participates in CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL; does not participate in CONVERGES_ON or [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation; may be source or target of INFORMED_BY ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation steps add the inclusion clarification.
- *`@atrib/verify`.* [§4.6](atrib-spec.md#46-the-calculation-algorithm) implementation explicitly excludes observation from contributing set (was implicit; becomes explicit per the rule above).
- *services/graph-node.* Edge derivation includes observations in steps 1-3 (chain, session_precedes, session_parallel) but excludes from step 4 (CONVERGES_ON). Step 5 (CROSS_SESSION) already excluded observations because session_token semantics describe agent continuation, not witness continuation.
- *Conformance.* New `spec/conformance/3.2.4/observation-chained/` corpus exercises observation-in-chain derivation. New negative case: observation MUST NOT appear in [§4.6](atrib-spec.md#46-the-calculation-algorithm) contribution sets.

**What this DOESN'T solve.**

- *Whether observations should ever count for attribution.* Some consumers may want observation contributions (e.g., a research-credit policy that values reading prior work). Such consumers express the policy in their [§4](atrib-spec.md#4-attribution-policy-format) policy document; atrib's [§4.6](atrib-spec.md#46-the-calculation-algorithm) default stays clean. This is the fact/policy separation working as intended.
- *Cross-session observation linkage.* Observations do not carry session_token (typically) and so do not participate in CROSS_SESSION. If an observation needs to anchor cross-session work, the carrier is `provenance_token` ([D044](#d044-provenance_token-field-for-cross-session-causal-anchoring)) or `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)), not session_token.

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

1. *Continue excluding extension URIs from all graph edges.* Rejected because [§7](atrib-spec.md#7-harness-integration-patterns) harness-side patterns ([D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern)) need extension records in the chain spine. Excluding produces gaps where reasoning records belong.

2. *Include extension URIs in CONVERGES_ON.* Rejected because atrib does not bless extension semantics. Including extension records as contributors would imply atrib certifies their attribution claim.

3. *Require consumer to opt extension URIs into graph participation via a flag in the record.* Rejected as protocol overhead without clear benefit. The default-include-in-chain, default-exclude-from-contribution split is the right default for the substrate.

4. *Define a separate "extension chain" parallel to the main graph.* Rejected as taxonomy duplication. The chain spine is a structural property; semantics layer over it.

**Consequences.**

- *Spec.* [§3.2.1](atrib-spec.md#321-node-types) node types section gains an "Extension URI nodes" subsection clarifying participation. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation steps add the inclusion clarification.
- *services/graph-node.* Edge derivation includes extension records in chain steps. Already excluded from CONVERGES_ON since v1; no change.
- *`@atrib/verify`.* [§4.6](atrib-spec.md#46-the-calculation-algorithm) implementation explicitly excludes extension URIs from contributing set (matches existing behavior; becomes explicit).
- *Conformance.* New `spec/conformance/3.2.4/extension-chained/` cases exercise extension-record-in-chain derivation.

**What this DOESN'T solve.**

- *Cross-namespace alignment.* Two consumers minting different URIs for similar concepts (e.g., `https://a.example/proposal` vs `https://b.example/proposal`) appear as distinct node types in the graph. Verifiers wanting to treat them as equivalent maintain their own mapping. This matches MIME types and W3C VC `@type`.
- *Default [§4.6](atrib-spec.md#46-the-calculation-algorithm) participation for extension URIs that should arguably contribute.* If a consumer mints an "action" URI structurally identical to `tool_call`, atrib's [§4.6](atrib-spec.md#46-the-calculation-algorithm) still excludes it. The consumer's own policy may include it; atrib normative behavior does not change without a [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion.

**Implementation sequencing.** Spec [§3.2.1](atrib-spec.md#321-node-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules) update → `services/graph-node` derivation includes extensions in chain steps → conformance corpus gains extension-in-chain cases → integration test with extension records carrying informed_by + provenance_token.

## D044: provenance_token field for cross-session causal anchoring

**Date:** 2026-04-28
**Status:** Accepted (refactored from initial draft to resolve circular derivation)

**Context.** atrib v1 has one cross-session linkage mechanism: `session_token`, defined in [§1.2.1](atrib-spec.md#121-field-definitions) as "Base64url-encoded 16-byte opaque token identifying the logical session across OTel trace boundaries." session_token expresses *same logical session* across trace boundaries: an agent doing one continuous task that happens to span multiple OTel context_ids.

Several real cross-session patterns are NOT same-logical-session and need a different mechanism:

- **Workflow handoff:** agent A finishes its initial work, hands off to agent B for follow-up work. Different agents, different sessions, causal dependency.
- **Tool-result consumption across sessions:** agent A writes to a queue, agent B reads it later. Different agents, different times, causal dependency.
- **Webhook/event-driven:** agent A emits an event, agent B reacts later. Different agents, different times, causal dependency.

In all three patterns the downstream session is *causally anchored* on an upstream record but is not the *same logical session*. session_token does not fit. An earlier design considered `recommendation_token` for this purpose; it was discussed in spec [§3.2.4](atrib-spec.md#324-edge-derivation-rules) notes as a deferred mechanism but never normatively specified. The name overcommits to one specific use case (recommendations); the actual mechanic is broader.

[D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) introduced `informed_by` as the general "agent's claimed reasoning context" primitive. provenance_token is best understood as a stricter, ergonomically-specialized subset of informed_by: restricted to a single value, scoped to the session-genesis record only, and truncated for cross-session API ergonomics. The two coexist; provenance_token does not replace informed_by.

**Decision.**

1. **New optional field `provenance_token`** in the attribution record format. Carries a base64url-encoded 16-byte opaque token. The token is the truncated hash of an upstream record that the downstream session claims as its causal anchor.

2. **Token derivation (downstream-side only).** A downstream record carries `provenance_token = base64url(SHA-256(JCS(upstream_record))[:16])` where `upstream_record` is the complete signed record (including its signature) the downstream session anchors on. The first 16 bytes of the SHA-256 record hash provide 2^128 collision resistance, sufficient for the cross-session anchor space.

3. **Upstream records carry no special field to be anchorable.** Any signed record in the log can be referenced as an anchor by truncating its hash. The earlier draft of this ADR specified that upstream records carry their own `provenance_token` to "declare anchorability"; this would have been circular (the record's hash depends on the token field, which depends on the hash). The cleaner model: upstream is implicitly anchorable; only downstream records carry the token claim.

4. **Field MUST appear only on the genesis record of a session.** A session's ancestry is a session-level property. The genesis record is the natural place to declare it. Subsequent records in the session inherit ancestry implicitly via session membership (same context_id). Non-genesis records carrying `provenance_token` MUST be rejected as malformed; this constraint avoids ambiguity about which token represents the session's true ancestry.

5. **provenance_token as a stricter subset of informed_by.** Both fields express agent-claimed causal references. The distinctions:

   | Property | `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)) | `provenance_token` (this ADR) |
   |---|---|---|
   | Cardinality | Multi-valued (array) | Single-valued |
   | Scope | Per-record (any record may carry it) | Per-session (genesis record only) |
   | Hash form | Full record_hash (43 chars + prefix = ~71 chars per entry) | Truncated 16 bytes (22 chars base64url) |
   | Use case | "Records this action consulted" | "This session's ancestry anchor" |
   | Cross-session API ergonomics | Not optimized for env-var / header passing | Designed for env-var / header / URL-param passing |

   A consumer wanting full-precision cross-session references with multiple anchors uses `informed_by` (which can include record_hashes from any session). provenance_token is the ergonomic shorthand for the special case of declaring a session's single ancestral anchor, designed to be passed across session boundaries via environment variables, HTTP headers, or URL parameters.

6. **New graph edge type PROVENANCE_OF** derived from the field. For each genesis record D with `provenance_token: T`, search the record set for any record U where `base64url(SHA-256(JCS(U))[:16]) == T` and `U.context_id ≠ D.context_id`. If found, create PROVENANCE_OF D → U. If not found, create PROVENANCE_OF D → synthetic_dangling_node(T) with `dangling: true`. The direction reads as "D's session descends from U's anchor."

7. **JCS canonical position.** `provenance_token` slots after `informed_by` and before `session_token` lexicographically (i < p < s). Presence/absence affects the signature.

8. **session_token semantics unchanged.** session_token continues to mean *same logical session across traces* and continues to drive CROSS_SESSION edges. provenance_token is a distinct field with distinct semantics; the two MAY coexist on the same record (a session-genesis record may both belong to a multi-trace logical session AND descend from a prior session's anchor).

9. **Distinct from `recommendation_token`.** The `recommendation_token` mention in [§3.2.4](atrib-spec.md#324-edge-derivation-rules) (originally a deferred design note) is removed from the spec. This ADR formally supersedes it.

**Alternatives considered.**

1. *Reuse session_token for both same-session and cross-session-causal patterns.* Rejected because the semantics differ. session_token says "this is the same logical session"; the new mechanism says "this is a different session with causal dependency." Conflating them would force verifiers to disambiguate from context, defeating the point of explicit fields.

2. *Use `informed_by` exclusively (no separate provenance_token).* Rejected because the ergonomic case for a short, single-valued ancestry token is real: cross-session APIs (env vars, HTTP headers, URL parameters) have length limits and benefit from a 22-char anchor over a 71-char full-hash array entry. provenance_token is the specialized ergonomic form; informed_by remains the general-purpose primitive.

3. *Keep upstream-side broadcast (initial draft of this ADR).* Rejected because the derivation was circular: upstream record's hash depends on the token field, which depends on the hash. The downstream-only model is structurally clean; any signed record is implicitly anchorable.

4. *Allow provenance_token on any record, not just genesis.* Rejected because session ancestry is a session-level property. Allowing arbitrary records to carry different ancestry tokens within a single session would create ambiguity about which token represents the session's true origin. Constraining to genesis records keeps the semantic clean.

5. *Keep `recommendation_token` name.* Rejected because the name describes one use case (recommendations) when the mechanic is general. `provenance_token` is accurate across all the cross-session causal patterns.

6. *32-byte token (full record_hash) instead of 16-byte truncation.* Rejected as defeating the ergonomic purpose. The truncation is the whole point. 16 bytes give 2^128 collision resistance, which is sufficient for the global cross-session token space.

7. *Cryptographic signing of the token by the upstream agent.* Rejected as redundant. The token is derived from an already-signed record; anyone fetching the referenced upstream record can verify the hash matches. No additional signature on the token itself adds value.

**Consequences.**

- *Spec.* [§1.2](atrib-spec.md#12-the-attribution-record) (record format) gains `provenance_token` field definition. [§1.2.6](atrib-spec.md#126-provenance_token) gives the full semantics including the genesis-record constraint. [§1.3](atrib-spec.md#13-canonical-serialization) updates JCS field-order example. [§3.2.3](atrib-spec.md#323-edge-types) gains PROVENANCE_OF edge type. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) gains derivation step 7 (PROVENANCE_OF) after the existing 5 steps and the new INFORMED_BY step ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). [§3.2.4](atrib-spec.md#324-edge-derivation-rules) note about "recommendation_token" is removed.
- *`@atrib/mcp`.* Record type gains optional `provenance_token: string`. Helper `recordOptions.provenanceToken: string` lets a session's genesis record claim a known anchor token. Validation: middleware MUST reject `provenance_token` on non-genesis records.
- *`@atrib/agent`.* Adapters auto-derive provenance_token from inbound cross-session API state when the agent uses canonical subagent-spawn or workflow-handoff APIs ([D048](#d048-plug-and-play-enforcement-contract-for-adapters)). Other patterns require explicit opt-in via `recordOptions`.
- *`@atrib/verify`.* Verification output gains `provenance: { token, upstream_record_hash, upstream_resolved: ResolvedRecord | null }` for the genesis record carrying the token. Dangling references (token claimed but upstream record not in resolved set) are flagged.
- *services/graph-node.* Edge derivation gains step 7 (PROVENANCE_OF). Cross-session query semantics extended.
- *Conformance.* `spec/conformance/1.4/` corpus gains vectors with provenance_token on genesis records. New `spec/conformance/3.2.4/provenance/` corpus exercises derivation across context_ids. New negative case: provenance_token on non-genesis record MUST be rejected.

**What this DOESN'T solve.**

- *Truthfulness of the claim.* atrib certifies that downstream record D was signed and carries token T. atrib does not certify D's session was actually caused by U. Verifiers cross-check content (when revealed) against the claimed anchor.
- *Multi-anchor cross-session causation.* A session may genuinely descend from multiple upstream sessions (e.g., merging two task threads). provenance_token is single-valued; informed_by handles the multi-valued case (full hashes, any record can carry it).
- *Forward inference.* PROVENANCE_OF edges only exist when downstream genesis records explicitly claim a token. atrib does not infer provenance from content overlap or behavioral similarity.

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

1. *Keep all privacy mitigations harness-only; no spec changes.* Rejected because three of the leaky fields are required by current spec. Harnesses cannot mitigate without breaking spec compliance. Privacy must be a normative concept.

2. *Single configurable "privacy mode" enum on each record.* Rejected because privacy postures are independent (tool_name, commitments, timing). A single enum forces bundles that may not match consumer needs. Independent posture fields compose better.

3. *Mandatory privacy by default; downgrade opt-in.* Rejected because changing v1 default breaks existing tooling and corpus. Additive posture options preserve the default and allow opt-in.

4. *Defer privacy postures to a v1.1 spec.* Rejected because the gap is concrete now. The substrate's brand promise depends on configurable disclosure being a normative property. Pre-public, additive optional changes are essentially free.

5. *Use zero-knowledge commitments (Pedersen, KZG) for args/result.* Rejected as v1 spec material. ZK schemes have meaningful complexity and ecosystem dependency. They MAY be added as additional commitment schemes in [§8.3](atrib-spec.md#83-salted-commitment-posture) in future revisions; the spec defines the extensibility shape now.

**Consequences.**

- *Spec.* New [§8](atrib-spec.md#8-privacy-postures) section with five subsections defining the postures and threat model. [§1.2](atrib-spec.md#12-the-attribution-record) field definitions updated to allow the alternate forms (tool_name forms, optional salt/key fields). [§7](atrib-spec.md#7-harness-integration-patterns) gains posture-selection subsection.
- *`@atrib/mcp`.* Record type gains optional `args_salt`, `result_salt` fields. Signing/verification updates to detect commitment scheme from record shape. Helpers for each posture: `recordOptions.toolNameForm: "verbatim" | "opaque" | "hashed"`, `recordOptions.commitmentScheme: "plain-sha256" | "salted-sha256" | "hmac-sha256"`, `recordOptions.timestampGranularity: "ms" | "s" | "min" | "h" | "d"`.
- *`@atrib/verify`.* Verification output indicates the posture detected per record. Threat-model implications surfaced as informational warnings (not verification failures).
- *Conformance.* `spec/conformance/8/` corpus exercises each posture combination. Verifier MUST correctly detect posture from record bytes.

**What this DOESN'T solve.**

- *Identity privacy.* `creator_key` is required and discloses the agent's stable identity. The [§6](atrib-spec.md#6-key-directory) directory may resolve creator_key to a real-world identity claim. Identity privacy requires a different mechanism (key rotation, per-conversation derivation) addressed in [D033](#d033-key-rotation-and-revocation) and the deferred D038.
- *Linkage privacy.* `informed_by` and `provenance_token` disclose the agent's claimed reasoning composition. This is the structural disclosure that makes auditability work. Harness-layer mitigations (commitment-and-reveal patterns) are documented in [§7](atrib-spec.md#7-harness-integration-patterns).
- *Metadata privacy of the log itself.* The log entry ([§2.3.1](atrib-spec.md#231-entry-serialization)) discloses creator_key, context_id, timestamp, event_type byte even when the record content uses high-privacy postures. Mitigating this requires log-level changes outside this ADR's scope.

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

1. *Leave positioning ambient and let consumers infer from the spec body.* Rejected because the spec body uses precise language that consumers may not parse fully. Explicit positioning is cheap and removes ambiguity.

2. *State the limits in the README only.* Rejected because the spec is the authoritative reference; positioning belongs there too. README-only would create drift risk.

3. *Add a separate "Limitations" document.* Rejected because the limitations are not a separate concern; they are part of the substrate's positive definition. Splitting them invites readers to skip the limitations doc.

**Consequences.**

- *Spec.* [§0](atrib-spec.md#0-foundations) abstract update. New [§3](atrib-spec.md#3-graph-query-interface) subsection (positioning lock). Cross-references from [§1.1](atrib-spec.md#11-normative-requirements-language) (normative requirements language) to the positioning subsection.
- *README.md.* New section after the introductory paragraph: "What atrib chains, what it does not" mirroring the spec subsection.
- *Per-package READMEs.* `packages/mcp/README.md`, `packages/agent/README.md`, `packages/verify/README.md`, `packages/cli/README.md`, `services/log-node/README.md`, `services/graph-node/README.md` all gain the positioning block (or a link to the spec subsection).
- *ARCHITECTURE.md.* Trust model section gains explicit limit statement.

**What this DOESN'T solve.**

- *Future consumer misreadings.* Positioning lock prevents the most common misreadings; it does not prevent all of them. Continued consumer-facing communication is a brand discipline, not a spec property.
- *Drift across surfaces.* Doc propagation requires discipline. CLAUDE.md sync triggers ([D047](#d047-harness-side-reasoning-chains-as-informative-7-pattern) in cross-reference, also: this ADR triggers a positioning-block sync trigger) catch drift on subsequent edits.

**Implementation sequencing.** Spec [§0](atrib-spec.md#0-foundations) abstract + new [§3](atrib-spec.md#3-graph-query-interface) positioning subsection → README block → per-package README blocks → ARCHITECTURE.md trust model update → CLAUDE.md sync trigger registration.

## D047: Harness-side reasoning chains as informative §7 pattern

**Date:** 2026-04-28
**Status:** Accepted

**Context.** [D045](#d045-privacy-postures-normative-spec-section)'s "verifiable agent actions in proper context" framing requires reasoning auditability for the brand promise to be substantively honest. Promoting a `reasoning_step` URI to atrib normative (Path 2 from prior session discussion) fails [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)'s indicator 4: reasoning shapes vary too much across harnesses (ReAct, CoT, scratchpad, multi-agent debate, plan-and-execute) for any single shape to be observably canonical.

The right layer for reasoning chains is the harness, not the protocol. Consumers mint extension URIs in their own namespaces (e.g., `https://example.com/v1/types/reasoning_step`) and link them via `informed_by` ([D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type)). atrib's substrate makes this possible without standardizing what reasoning *is*.

[§7](atrib-spec.md#7-harness-integration-patterns) (Harness Integration Patterns) already exists in the spec as informative material. Adding a "Harness-side reasoning chains" subsection demonstrates the pattern concretely without elevating it to normative.

**Decision.**

1. **New [§7](atrib-spec.md#7-harness-integration-patterns) subsection titled "Harness-side reasoning chains."** Informative content showing how a harness mints an extension URI (e.g., `https://example.com/v1/types/reasoning_step`), emits records carrying the URI alongside `tool_call` records, links them via `informed_by`, and exposes them through recall-style consumer surfaces.

2. **Trust boundary statement is mandatory.** The subsection states plainly: "reasoning records live outside atrib's normative trust boundary. They prove the harness emitted these bytes. They do NOT prove the LLM actually reasoned this way." This sentence is load-bearing and MUST NOT be removed in subsequent edits without a successor ADR.

3. **No normative claims.** The pattern is illustrative. atrib does not bless any specific reasoning predicate. Consumers may adopt the pattern, vary it, or replace it with their own.

4. **Cross-reference to [D041](#d041-informed_by-linking-primitive-and-informed_by-edge-type) + [D043](#d043-extension-uri-participation-in-graph-derivation).** The pattern depends on `informed_by` (linking primitive) and extension URI graph participation ([D043](#d043-extension-uri-participation-in-graph-derivation)). The subsection cross-references both.

5. **Companion [§7](atrib-spec.md#7-harness-integration-patterns) subsection: "Outcome verification patterns."** Documents two opt-in patterns for closing the outcome-linkage gap: (a) tool-side response signing (the tool signs responses; the agent records signed-response-hash in `result_hash`), (b) external witness records (downstream observation references external proof such as a chain transaction ID). Same informative-not-normative posture.

**Alternatives considered.**

1. *Promote `reasoning_step` to atrib normative URI.* Rejected per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) indicator 4 (not observably canonical) and privacy concerns (prompt/response hash fingerprinting).

2. *Document the pattern in a separate guide outside the spec.* Rejected because [§7](atrib-spec.md#7-harness-integration-patterns) is the right place: it already exists as informative-pattern content, and consumers reading the spec find the pattern in context.

3. *No documentation; let consumers discover the pattern.* Rejected because discoverability is poor and the trust boundary statement is critical to get right. Spec-level documentation prevents misuse.

**Consequences.**

- *Spec.* [§7](atrib-spec.md#7-harness-integration-patterns) gains "Harness-side reasoning chains" subsection ([§7.5](atrib-spec.md#75-harness-side-reasoning-chains)) and "Outcome verification patterns" subsection ([§7.6](atrib-spec.md#76-outcome-verification-patterns)). Both informative.
- *`@atrib/agent`.* No code change. Adapters already support extension URIs; the documented pattern uses existing primitives.
- *`packages/recall` (when the package ships).* Reference implementation includes a reasoning-chain example in `packages/integration/examples/recall-with-reasoning/` to make the pattern concrete.

**What this DOESN'T solve.**

- *Cross-consumer reasoning predicate convergence.* Multiple consumers minting different reasoning URIs do not auto-converge. If usage establishes convergence over time, [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) may promote to atrib normative; until then, each consumer's URI is its own.
- *Trust of the LLM's reasoning.* The pattern proves the harness emitted reasoning bytes signed under a key. It does not prove the LLM's reasoning was truthful or coherent. That is a different evaluation layer.
- *Privacy of reasoning content.* Reasoning records may carry hashes of prompts/responses, which leak fingerprints. Consumers wanting privacy use the salted-commitment posture ([D045](#d045-privacy-postures-normative-spec-section)) on reasoning record hashes.

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

1. *No formal contract; document each adapter individually.* Rejected because consistency matters. A consumer using two different framework adapters expects the same observable behavior; a per-adapter contract drifts.

2. *Make every contract item the agent's responsibility.* Rejected because plug-and-play is the value proposition. Pushing fields and edge derivation to the agent defeats the substrate's purpose.

3. *Make every pattern auto-handled (including handoff, webhook).* Rejected because the middleware cannot reliably infer application intent. False auto-emissions are worse than missing ones (they create incorrect graph edges).

**Consequences.**

- *`@atrib/agent`.* Existing adapters audited against the contract; gaps closed in subsequent work. New context tracker (C5, C6) added to the middleware. New test file for conformance.
- *Spec.* [§5.4](atrib-spec.md#54-atribagent-agent-middleware) (adapter section) updated to reference the contract. [§5.7](atrib-spec.md#57-automation-triggers-normative) (Automation Triggers) extended with the new auto-emissions.
- *Documentation.* Contract published in `packages/agent/README.md` adapter table. Adapter authoring guide added.

**What this DOESN'T solve.**

- *Adapters built by third parties.* atrib does not control third-party adapter quality. The conformance test suite is published; users of third-party adapters can run it.
- *Frameworks that don't expose a tool-call interception point.* For frameworks where wrapping the tool path is impossible, the adapter cannot satisfy C3. Such frameworks fall back to manual emission with reduced auto-tracking.

**Implementation sequencing.** Contract documented in [§5.4](atrib-spec.md#54-atribagent-agent-middleware) + [§5.7](atrib-spec.md#57-automation-triggers-normative) → test suite skeleton in `packages/agent/test/conformance.test.ts` → existing adapters audited and gaps closed → CONTRIBUTING guide → conformance results table added to README.

## D049: Layered leak defense (regex + LLM-semantic + cloud audit + style guide)

**Date:** 2026-04-28
**Status:** Accepted

**Context.** Maintaining operator-state framing out of public protocol docs is a recurring class of cleanup work. Term-list audits are fundamentally upper-bounded by the auditor's imagination; a fixed-term cloud audit cannot anticipate new substitution patterns introduced by previous cleanup passes themselves. The recursion converges only when the audit becomes structural rather than literal.

A layered defense replaces the ad-hoc catch-up cycle with structural prevention. Four layers, each catching what the layer above misses, with a positive style guide as the source of truth that all layers reference.

**Decision.**

1. **Style guide as source of truth.** A prose style guide defines the *positive* spec for what public prose may contain: present-tense decisions and rationale; no operator-state framing (numeric ordinals tied to internal plans, timestamps with hour-of-day precision, narrative attributions to specific actors, commit/session self-reference, references to private planning artifacts); cross-references to other ADRs by number, spec by section, code by file path only. The denylist becomes derivative; the style guide is primary.

2. **Layer A: Pre-commit regex check.** Local git hook running on `git commit`. Pattern-based regex catches generic shapes (numeric ordinals tied to plans; self-referential commit/session/pass language; time-of-day patterns; actor-narration patterns; references to private planning artifact and memory-store identifiers; references to subagent-process framing). Hook blocks commit on flag; can be bypassed with `--no-verify` for emergency override.

3. **Layer B: Pre-push LLM-semantic audit.** Local git hook running on `git push`. Sends the diff to a hosted LLM API (free-tier model) with a prompt that asks "does this prose contain operator state, internal-process framing, or anything that doesn't belong in a public protocol spec?" Reads API credentials from local configuration. Blocks push on flag; can be bypassed with explicit override flag.

4. **Layer C: Cloud audit backstop.** A weekly remote audit runs against the public repo and includes the regex patterns from Layer A plus the LLM-semantic check from Layer B. Catches drift, regression after history rewrites, anything missed locally.

5. **Layer D: Documentation.** A leak-class catalog and audit-procedure document cross-references the four layers and is updated as new leak classes are discovered. The style guide and this document together form the prevention reference.

6. **Implementation sequencing.** Style guide drafted first (defines what the regex/LLM check against). Then Layer A (regex hook; cheap, fast, catches the common shapes). Then Layer B (LLM hook; catches the spirit). Then Layer C update (cloud audit gains the new patterns). Each layer is independently useful; the combination is what makes the defense robust.

**Alternatives considered.**

1. *Continue per-wave term-list expansion.* Rejected because each wave introduces new substitution patterns that future waves must catch. The recursion converges only when the audit becomes structural rather than literal.

2. *LLM-semantic check at the cloud audit only (no local hooks).* Rejected because catching leaks after they've been live in main for a week is much worse than catching them before push. Local hooks give immediate feedback.

3. *Regex check only; no LLM check.* Rejected because regex catches known shapes; LLM catches new categories. The combination handles both.

4. *Use Anthropic API for the LLM check (consistent with Claude Code's primary provider).* Rejected per cost. A free-tier hosted LLM is available via the operator's existing model-provider configuration; reuse the same path here. The check is run frequently (every push), so cost accumulates.

5. *Mandatory hook installation; no opt-out.* Rejected because emergency overrides are sometimes needed (e.g., fixing a hook itself). Documented overrides with audit-log entry.

**Consequences.**

- *Documentation artifacts.* New prose style guide. Updated leak-class catalog with the four-layer defense.
- *atrib (public repo).* New `.git-hooks/pre-commit` and `.git-hooks/pre-push` scripts (committed for transparency; users opt in via `git config core.hooksPath .git-hooks`). New `scripts/check-leaks.mjs` (regex check) and `scripts/check-leaks-semantic.mjs` (LLM check).
- *Cloud routine.* The weekly audit gains the new regex patterns and LLM-check step.

**What this DOESN'T solve.**

- *Operator override misuse.* `--no-verify` bypasses the hooks. The override is logged but not enforced. Discipline is required.
- *Hosted LLM availability.* If the API is unavailable, Layer B fails open (push proceeds). The cloud audit (Layer C) catches what Layer B missed.
- *Style guide drift.* The style guide itself can grow stale. Quarterly review (manual) checks alignment.

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

1. *Mandate cross-log replication for all records.* Rejected as adoption barrier. Single-log deployments are valuable; the mandate would block them.

2. *In-protocol cross-log gossip.* Rejected as protocol surface bloat. Logs do not coordinate at the protocol level; replication is consumer-side.

3. *Witnessing alone is sufficient.* Rejected because witnessing secures the checkpoint root, not record-level censorship by the operator. Cross-log replication addresses a strictly broader threat.

**Consequences.**

- *Spec.* New [§2.11](atrib-spec.md#211-cross-log-replication) "Cross-log replication" subsection. [§2.8](atrib-spec.md#28-proof-bundle-format) (proof bundle format) extended to allow a list of `(log_id, checkpoint, inclusion_proof)` tuples instead of a single tuple. [§2.4](atrib-spec.md#24-checkpoint-format) (checkpoint format) gains a normative `log_id` field referenced by replication.
- *`@atrib/mcp`.* Submission API gains `submitToLogs: LogConfig[]` option. Default behavior unchanged.
- *`@atrib/verify`.* Verification gains `cross_log_proof_count` and `cross_log_threshold_met` outputs. Equivocation detection MUST reject records when cross-log discrepancies are observed.
- *services/log-node.* No log-side changes; logs are oblivious to replication. Verifier-side does the work.
- *Conformance.* `spec/conformance/2.11/` corpus exercises cross-log proof bundles, threshold checks, and equivocation detection.

**What this DOESN'T solve.**

- *Collusion across logs.* If all N logs collude, replication does not help. Trust diversity is the consumer's responsibility (pick logs operated by independent parties with different incentives).
- *Submission-time censorship.* If the submitter is denied service by some logs, the bundle has fewer proofs but is not detectable as malicious. Threshold M handles this gracefully (require fewer than total).
- *Record-level retroactive removal.* If a log removes a previously-committed record, verifiers consulting the log later see "record not found" but cannot prove the log is lying about its history. Witnessing ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures)) and cross-log replication together address this when at least one cooperative log retains the record.

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

1. *Per-record `declared_capability` field instead of per-key envelope.* Rejected as field bloat and as harder for verifiers to validate (each record's declaration would be self-asserted; the envelope-as-published model lets a separate publication channel constrain claims).

2. *Mandatory envelopes for all identity claims.* Rejected as adoption barrier. Capability declaration is optional; consumers wanting it adopt it.

3. *Hard rejection of out-of-envelope records.* Rejected as too brittle for real-world envelope evolution and operator error. Signal-not-block is the right granularity.

4. *Envelope encoded in the record itself rather than the directory claim.* Rejected because envelope-in-record is self-asserted (the key author writes their own constraints); envelope-in-directory ties the constraint to the identity claim's separate publication channel, which is harder for an attacker compromising the key alone to forge.

**Consequences.**

- *Spec.* New [§6.7](atrib-spec.md#67-capability-declarations) "Capability declarations" subsection. [§6.1](atrib-spec.md#61-identity-claim-format) (identity claim format) extended with optional `capabilities` field.
- *`@atrib/cli`.* `atrib publish-claim --capabilities <file.json>` lets operators declare envelopes when publishing.
- *`@atrib/verify`.* Verification output gains `capability_check: { envelope: CapabilityEnvelope | null, in_envelope: bool, mismatches: string[] }` per record.
- *services/directory-node.* Directory publishes capability fields in identity claims; lookup returns them. No new endpoints required.
- *Conformance.* `spec/conformance/6.7/` corpus exercises capability declaration, envelope rotation, and out-of-envelope detection.

**What this DOESN'T solve.**

- *Coordinated compromise.* An attacker who compromises both the signing key AND the publication channel for identity claims can publish an updated envelope that whitelists the attacker's intended actions. Mitigation: identity-claim publication should be on a different operational footing than agent operation (e.g., manual re-publication on a hardware-isolated key).
- *Capability enforcement at signing time.* atrib does not refuse to sign out-of-envelope records; the envelope is a verifier-side annotation. Consumers wanting signing-time enforcement build it into their middleware.
- *Granular field-level constraints.* The envelope schema is intentionally narrow (tool_names, max_amount, counterparties, event_types). More granular constraints (e.g., "only between 9-5 PM UTC") are out of scope; consumers needing them publish a separate policy document and check externally.

**Implementation sequencing.** Spec [§6.7](atrib-spec.md#67-capability-declarations) + [§6.1](atrib-spec.md#61-identity-claim-format) update → `@atrib/cli` envelope publication command → `@atrib/verify` envelope check → directory-node serves capabilities in lookup → conformance corpus → integration test exercising envelope rotation.

## D052: Cross-attestation requirement for transaction records

**Date:** 2026-04-28
**Status:** Accepted

**Context.** Transaction records (`event_type = https://atrib.dev/v1/types/transaction`) are the highest-stakes record type in atrib: they are the record the [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation is normatively gated on. A single agent unilaterally signing a transaction record makes a cryptographically valid claim that "this transaction occurred for this amount with this counterparty" — without independent corroboration. An attacker who compromises one signing key can fabricate transactions out of thin air.

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

1. *Threshold signatures (M-of-N) for transactions.* Considered. The simpler 2-signer model covers the highest-frequency case (agent + merchant). M-of-N adds complexity (threshold key management, partial-signature aggregation) without proportionate gain at this stage. May revisit if usage establishes a multi-party need.

2. *Make cross-attestation OPTIONAL for transactions.* Rejected. Transactions are the [§4.6](atrib-spec.md#46-the-calculation-algorithm)-gated record type; the substrate's strongest robustness commitment belongs here. Optional weakens the guarantee.

3. *Apply cross-attestation to all record types.* Rejected as overhead for non-transaction records. The robustness gain is concentrated at the transaction layer.

4. *Use multi-signature schemes (Schnorr aggregation, BLS) instead of an explicit signers array.* Rejected as cryptographic complexity. The explicit-array form is auditable, debugable, and uses the same Ed25519 primitive as everywhere else in the spec.

5. *Canonicalize signing input by omitting `signers` entirely (rather than setting it to `[]`).* Considered. Both forms are unambiguous and reproducible. The explicit `signers: []` form was chosen because it makes the canonical-input shape uniform regardless of whether the record carries the `signers` field or not (every transaction record produces the same signing-input shape: `signers:[]`, signature omitted). The omit-entirely alternative would create two canonical-input shapes (one for transaction records, one for everything else) that implementations would need to branch on. The explicit-empty form simplifies signing/verification logic without changing the security properties.

**Consequences.**

- *Spec.* New [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) "Cross-attestation requirement for transaction records" subsection. [§1.2](atrib-spec.md#12-the-attribution-record) record format note extended to clarify that transaction records use `signers` array. [§4.6.2](atrib-spec.md#462-step-1-identify-contributing-nodes) contributing-set check extended to flag cross-attestation status.
- *`@atrib/mcp`.* Transaction record signing path emits `signers` array. Counterparty signature is collected via `recordOptions.counterpartySignature: { creator_key, signature }` (the application supplies the counterparty's signature obtained out-of-band).
- *`@atrib/agent`.* Payment-protocol adapters ([§1.7](atrib-spec.md#17-transaction-event-hooks)) extended to coordinate counterparty signature collection from their respective protocols' settlement responses.
- *`@atrib/verify`.* Verification of transaction records extended to verify each signer's signature and to surface `cross_attestation: { signer_count, all_verified, missing_required }`.
- *Conformance.* `spec/conformance/1.7.6/` corpus exercises 2-signer transaction records, single-signer flagging, signer mismatch detection.

**What this DOESN'T solve.**

- *Counterparty collusion.* If the agent and merchant collude to fabricate a transaction, both sign and the cross-attestation passes. Cross-log replication ([D050](#d050-cross-log-replication-for-equivocation-defense)) and external evidence ([§7.6](atrib-spec.md#76-outcome-verification-patterns) Pattern B) help here.
- *Counterparty key compromise.* If the merchant's signing key is compromised, the attacker can sign as the merchant. Identity attestation ([§6](atrib-spec.md#6-key-directory)) and key revocation ([§1.9](atrib-spec.md#19-key-rotation-and-revocation)) help.
**Implementation sequencing.** Spec [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) + [§1.2](atrib-spec.md#12-the-attribution-record) + [§4.6.2](atrib-spec.md#462-step-1-identify-contributing-nodes) update → `@atrib/mcp` transaction signing path extension → `@atrib/agent` payment-protocol adapter coordination → `@atrib/verify` multi-signature verification → conformance corpus.

## D053: Inclusion-proof aggregation (flagged for follow-up)

**Date:** 2026-04-28
**Status:** Flagged for follow-up; design subject to change

This ADR is a placeholder. It records that inclusion-proof aggregation has been considered and queued for future work, without committing to specific design details. When this ADR is formally written and the mechanism is implemented, the details below MAY change in any way; this entry documents the intent and the known-design-questions, not the final spec.

**Context.** [D050](#d050-cross-log-replication-for-equivocation-defense) (cross-log replication) and [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) (witnessing) defend against log-operator equivocation and selective censorship at the checkpoint level. A complementary mechanism — inclusion-proof aggregation — would defend at the record level: subsequent records cite the inclusion proofs of prior records, creating a web of mutual confirmation. If a log operator later removes or alters a referenced record, citing records still point at proof of the prior state.

**Sketch (subject to change).**

A new optional field `inclusion_proof_refs: [{ log_id, record_hash, checkpoint_root }, ...]` on records. Subsequent records cite the inclusion proofs of records they reference (via `informed_by` or `provenance_token` or chain). Verifiers MAY require that cited proofs resolve to records in the log; resolution failures are flagged.

**Why deferred.**

- The marginal robustness gain over [D050](#d050-cross-log-replication-for-equivocation-defense) (cross-log replication) plus [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) (witnessing) is real but smaller than the gain from those mechanisms individually.
- Sequencing is non-trivial: a record citing its parent's inclusion proof needs the parent to have been committed AND for a checkpoint covering it to have been published AND for that checkpoint to have been witnessed (depending on consumer policy). The chicken-and-egg patterns need careful design.
- Cross-log replication ([D050](#d050-cross-log-replication-for-equivocation-defense)) introduces multiple proofs per record; the citation field needs to specify which log(s) to cite.
- Field bloat: each record gains another reference list; storage and proof verification work scale.
- Adding a fourth robustness mechanism in the same session as [D050](#d050-cross-log-replication-for-equivocation-defense)-D052 increases interaction surface beyond what careful design supports.

**Known design questions for the formal ADR.**

1. Which proofs MUST be cited (parent only? all `informed_by` referents? all cross-session anchors?) versus MAY be cited.
2. How to handle cross-log replication: cite all logs' proofs, the trusted-set logs' proofs, or a single canonical log per record?
3. Sequencing: do citing records wait for witnessing, or accept un-witnessed checkpoint citations?
4. Storage and verification cost trade-offs at high record volumes.
5. Failure modes: how does a verifier surface "cited proof exists but doesn't verify against current checkpoint state"?

**Implementation sequencing.** None for now. When formally written: spec subsection (likely §2.12) → record format extension → verifier-side cross-checking → conformance corpus → operator guidance.

**Caveat on this entry.** Because this ADR is a placeholder, anything described above is a sketch, not a commitment. The formal ADR (when authored) will follow the standard format and may diverge from this placeholder in any technical detail. Cross-references to [D053](#d053-inclusion-proof-aggregation-flagged-for-follow-up) from other ADRs or the spec MUST treat the substance as forward-looking, not normative.

## D054: Unified public explorer (vs per-service admin UIs)

**Date:** 2026-04-29
**Status:** Accepted

**Context.** atrib's read-side data lives across three deployed services: log-node (entries + checkpoints + inclusion proofs), graph-node (graph queries derived from log entries), directory-node (identity claims + AKD proofs). All three serve public data per spec [§0](atrib-spec.md#0-foundations) ("anyone can verify"). None of them ships a human-readable inspection UI; the only interaction surface is JSON-over-HTTP designed for machine consumers (verifiers, agents, libraries).

The natural impulse is to add an admin/inspection UI to each service: a small HTML page on log-node, another on graph-node, another on directory-node. Each would let a human paste a record_hash / context_id / creator_key and see what the service knows about it.

This is the wrong shape. It produces three disconnected admin pages instead of solving the underlying "where do I look to see what's happening" problem. Humans understanding atrib activity care about the JOIN across the three services: "this record_hash was signed by THIS identity (directory) at THIS chain position (log) producing THESE graph edges (graph)." Three separate UIs force humans to do that join manually.

The right shape is a unified explorer that composes from the three services. This is the same pattern Certificate Transparency (crt.sh), Sigstore (rekor.sigstore.dev), and Ethereum (Etherscan) use: individual logs/services don't ship UIs; one explorer composes from all of them.

**Decision.**

1. **No per-service inspection UIs.** log-node, graph-node, and directory-node MUST NOT ship inline admin/dashboard HTML. Their interfaces stay JSON-over-HTTP for machine consumers.

2. **A unified explorer ships separately.** A standalone surface composes from all three services' read APIs and presents the joined views humans actually want. The five primary views: identity (anchored on `creator_key`), session (anchored on `context_id`), action (anchored on `record_hash`), anchoring (recent log checkpoints + directory anchors), and search (free-text resolving to identity / context / record).

3. **Read-only and unauthenticated.** The explorer reads only public data. Adding an auth wall would (a) break the spec [§0](atrib-spec.md#0-foundations) "verifiable by anyone" promise, (b) be security theater (the underlying APIs are public anyway), and (c) create false-restriction perception. Read views stay open forever.

4. **Public explorer, not personal dashboard.** Visiting the explorer URL shows aggregate public data with search-by-anything. There is no concept of "logged-in user" in the explorer. A SEPARATE PRODUCT (a personal dashboard, auth-gated by signature-challenge proving control of a creator_key) may be added later for users actively managing their own atrib presence; that product is out of scope for this ADR and lives at a different URL.

5. **Three-stage build sequence.** The deployment strategy proceeds in three stages. First: a minimal single-page HTML (no build step, no framework) **served inline by log-node at `https://explore.atrib.dev/`** so the first stage doesn't introduce a second hosting platform. Second: a Vite/Next.js SPA with proper routing + components, deployed to its own hosting (likely Cloudflare Pages at `dashboard.atrib.dev` or `atrib.dev/dashboard`); at that point the inline log-node route either redirects to the SPA or stays as a backup. Third: a full block-explorer-grade surface with search indexing, real-time updates, embedded chain visualizations. The first stage ships immediately; the second follows when dogfood metrics produce useful results to display; the third follows the broader implementation work.

6. **CORS allowed on all three services' read endpoints.** `Access-Control-Allow-Origin: *` is set on log-node, graph-node, directory-node so a browser-based explorer hosted from any origin can read the public APIs. The data is already public; CORS just makes browser-based composition possible.

7. **Future write actions require per-action auth.** If the explorer ever gains write actions (e.g., "publish an identity claim from the UI" instead of CLI), THOSE specific actions get authenticated per action — the read views stay open. This boundary is preserved through future iterations.

**Alternatives considered.**

1. *Per-service admin UIs.* Rejected as enumerated above. Three disconnected pages forces users to manually join across services. Conflates inspection (human surface) with API serving (machine surface) at the wrong layer.

2. *No inspection UI; just curl + scripts.* Rejected because the operator (and future users) need visibility into the system to debug and demo. Without a UI, the brand promise of "verifiable by anyone" is theoretical: humans see only JSON outputs, no holistic view. Block-explorer surfaces are the natural materialization of verifiability for human consumers.

3. *Build the personal dashboard now and skip the public explorer.* Rejected because public verifiability is structurally upstream of personal management. A personal dashboard without the explorer would mean users can manage their own data but external auditors/regulators/curious-parties have nothing to point at. The explorer comes first.

4. *Embed the explorer in the spec/docs site.* Rejected because they're different surfaces with different scopes. The docs site (operator intent, separate memory entry) is documentation. The explorer is operational data. Embedding either in the other creates conflation pressure as both grow.

**Consequences.**

- *Spec.* No spec changes for D054 itself; the explorer reads from the existing §2.5 / §3.4 / §6.2 read APIs. CORS clarification can land in those sections as a normative note (`Access-Control-Allow-Origin: *` is the canonical setting for the read endpoints).
- *log-node, graph-node, directory-node.* All three gain `Access-Control-Allow-Origin: *` headers on read endpoints (and OPTIONS preflight handling). Tests confirm headers present.
- *Repo.* New `apps/dashboard/` directory ships the explorer source. Option 1 is a single HTML file with embedded CSS + vanilla JS (no build step). Options 2 and 3 will introduce a framework + build step when they're built.
- *Hosting.* Option 1 is served inline by log-node at `https://explore.atrib.dev/` (also at `https://log.atrib.dev/dashboard` for legacy direct access). The Dockerfile copies `apps/dashboard/index.html` into the image; the server reads it once at startup, caches in memory, and returns with `Cache-Control: public, max-age=60`. The "no per-service inspection UIs" rule (point 1 above) bans per-service ADMIN HTML — page-shaped, service-private surfaces. Serving the unified explorer from a service is materially different: log-node is acting as a static-file host for the cross-service surface, not exposing a service-specific admin. The host-based routing is explicit: when the request `Host` header is `explore.atrib.dev` the dashboard is returned at `/`; otherwise log-node returns API responses at `/v1/*` and a 404 hint at `/`. When option 2 (SPA) ships it will get its own hosting (likely Cloudflare Pages); the inline route stays as a fallback. **Naming rationale:** `explore` was chosen over `dashboard` so that `dashboard.atrib.dev` is reserved for the actual auth-gated personal dashboard product (separate memory entry); `explore` reads as block-explorer and avoids the "dashboard implies my-account" connotation.
- *CLAUDE.md.* New sync trigger: "Explorer view changes" → update apps/dashboard/ + verify CORS unchanged on the underlying services.

**What this DOESN'T solve.**

- *Personal dashboard.* Out of scope. Tracked separately as a future product item; needed before public outreach to users (not before).
- *Real-time updates.* Option 1 + 2 are pull-on-load; option 3 may add WebSocket or SSE for live updates.
- *Search indexing at scale.* Option 1 + 2 do client-side filtering against API responses. Option 3 may need a server-side search index when the log volume makes client-side impractical.
- *Internationalization.* Out of scope for option 1. Option 2/3 may add when the user base warrants.
- *Mobile responsiveness.* Option 1 is desktop-first (best-effort viewport). Option 2/3 should be properly responsive.

**Implementation sequencing.**

Option 1 (now): single HTML file at `apps/dashboard/index.html`; CORS added to all three services; log-node serves the HTML at `/dashboard`; Dockerfile bundles the file; deployed to https://explore.atrib.dev/. The explorer loads against production (`log.atrib.dev`, `graph.atrib.dev`, `directory.atrib.dev`) by default with URL-param overrides for local services. Option 2 (when dogfood metrics are producing measurable signal): Vite/Next.js refactor of option 1's view components into a proper SPA; deploys to its own hosting (likely Cloudflare Pages). Option 3 (after the broader implementation work completes): full block-explorer-grade surface; search indexing, real-time updates, visualization. Personal dashboard tracks separately.

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

1. *Promote all three as atrib-normative (taking byte assignments).* Rejected. Single-harness adoption fails [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary). Would prematurely freeze a single consumer's vocabulary into atrib's spec without evidence that other harnesses converge on the same shape.

2. *Promote only `apply` (most generally-shaped).* Rejected. Same reasoning. `apply` does have cross-harness potential (any agent that executes a previously-proposed change has the same shape), but no second harness has surfaced it yet. Reassess if a second independent harness adopts an `apply` URI of its own.

3. *Defer the decision indefinitely (status quo via silence).* Rejected. The proposal had been open with no formal disposition. Recording the decision either way is better than letting it linger as ambiguous backlog state.

**Consequences.**

- *Spec.* No spec changes. [§1.2.4](atrib-spec.md#124-event_type-values) already accommodates extension URIs.
- *Consumer.* Continues using its own namespace URIs. No coordination with atrib spec maintainers required for vocabulary additions.
- *atrib explorer.* Extension-URI records render with their full URI string (not a normative type label). When a second harness adopts an `apply`-shaped type, revisit promotion via a fresh ADR.
- *Reopening criteria.* This decision is reopened automatically the moment a second independent harness uses the same URI shape (or an isomorphic one): i.e., the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar starts to clear. At that point write a new ADR; do not amend D055.

---

## D056: Promote `directory_anchor` to atrib-normative event_type (byte `0x04`)

**Date:** 2026-04-30
**Status:** Accepted

**Context.** [§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log) requires the directory operator to emit a `directory_anchor` record into the tlog after each operation, committing the directory's current root for downstream verifier consultation per [§6.3](atrib-spec.md#63-verifier-consultation-algorithm). The reference directory at `directory.atrib.dev` does this today: it signs records with `event_type: "https://atrib.dev/v1/types/directory_anchor"`. Until [D056](#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04), the URI was not in the normative set, so [§2.3.1](atrib-spec.md#231-entry-serialization) required encoding it with `event_type = 0xFF` (extension). The explorer ([D054](#d054-unified-public-explorer-vs-per-service-admin-uis)) consequently labels these rows "extension," which is misleading: `directory_anchor` is atrib-system substrate behavior defined in the spec, not a third-party extension.

This labeling artifact is symptomatic of a real spec gap: the URI is normatively defined and its emission is normatively required, but it lacked a byte slot. Verifiers running [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 (AKD anchor consistency check) need to find directory_anchor records efficiently; without a byte slot, they have to read every extension record's content to decide whether it's a directory_anchor or some other extension URI.

**Decision.** Promote `https://atrib.dev/v1/types/directory_anchor` to atrib's normative event_type vocabulary. Allocate byte `0x04` in the [§2.3.1](atrib-spec.md#231-entry-serialization) log entry encoding. Reserved range narrows from `0x04`–`0xFE` to `0x05`–`0xFE`.

**Evaluation against [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).**

1. **Architecture-agnostic in practice.** Does NOT clear under the cross-category-adoption reading. Today the only emitter is atrib's own reference directory. This is the indicator that's weakest — but the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) text on indicator 4 explicitly admits "Atrib protocol load-bearing" as an alternative path, "rare and decisive." `directory_anchor` is the canonical example of that path.

2. **Structurally distinct from existing normative types.** Holds. `directory_anchor` is not a `tool_call` (no caller-supplied arguments, no MCP tool invocation). Not a `transaction` (no commerce protocol detection). Not an `observation` (the directory is not "perceiving its environment"; it is committing its own state). The closest neighbor is `observation`, but `observation` carries "the agent received this from outside"; `directory_anchor` carries "this service committed its internal state at this moment." Different semantic shape.

3. **Filterable benefit at the log-byte level.** Holds. [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 (AKD consistency check) is a real verifier query that needs all directory_anchor records for a given directory key. Without a byte slot, verifiers fetch the content of every `0xFF` entry from the directory's `creator_key` and parse the URI. With a byte slot, the same query is a byte filter on the binary entry.

4. **Atrib protocol load-bearing.** Holds, decisively. [§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log) requires the emission. [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 7 requires consumption. [§3.2.4](atrib-spec.md#324-edge-derivation-rules) graph derivation excludes `directory_anchor` from session edges (system commitments are not session participants). Three normative spec sections distinguish the type today.

5. **Promotion is non-disruptive.** Holds. The URI does not change. Existing directory_anchor records (signed before the byte allocation, encoded as `0xFF`) remain valid: the URI in the record content is the authoritative type per [§2.3.1](atrib-spec.md#231-entry-serialization)'s "byte mapping is a fast-path filter; the authoritative type is the URI." New records get the new byte. Verifiers wanting comprehensive directory_anchor queries during the transition window filter by URI (always works) rather than by byte (works only for post-promotion records). Once the pre-promotion records age out of operational interest, byte filtering suffices.

Four of five indicators clear. Indicator 1 fails the literal cross-category reading but is moot because indicator 4's load-bearing branch holds — and [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) explicitly contemplates this case.

**Alternatives considered.**

1. *Leave as `0xFF` extension forever.* Rejected. The URI is in the atrib namespace and its emission is normatively required; encoding it identically to third-party extension URIs misrepresents the type and produces the misleading "extension" labeling in the explorer. Verifier filtering remains inefficient.

2. *Fix the explorer label only, no spec change.* Rejected as the standalone fix. The explorer fix lands separately ([D054](#d054-unified-public-explorer-vs-per-service-admin-uis) update) and is correct on its own, but it papers over the underlying byte-encoding misclassification rather than fixing it. Both fixes ship together.

3. *Promote in a batch with future system types (e.g., reserve `0x04`–`0x07` for "atrib system" types).* Rejected. [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) explicitly rejects pre-allocation and tier systems. Each promotion gets its own ADR; the next system type that needs a byte gets the next byte (`0x05`) when its own load-bearing case clears.

4. *Re-encode pre-promotion records to update the byte from `0xFF` to `0x04`.* Rejected. The log is append-only; rewriting historical entries breaks immutability and inclusion proofs. The spec is explicit that the URI is the source of truth; transition-window mismatches are tolerable.

**Consequences.**

- *Spec ([§1.2.4](atrib-spec.md#124-event_type-values)).* Add `https://atrib.dev/v1/types/directory_anchor` to the normative URI table with byte `0x04` and a one-sentence semantic.
- *Spec ([§2.3.1](atrib-spec.md#231-entry-serialization)).* Add row `0x04 = https://atrib.dev/v1/types/directory_anchor`. Narrow reserved range to `0x05`–`0xFE`.
- *`packages/mcp/src/types.ts`.* Add `EVENT_TYPE_DIRECTORY_ANCHOR_URI` constant; include it in `NORMATIVE_EVENT_TYPE_URIS`.
- *`packages/mcp/src/entry.ts`.* Add `EVENT_TYPE_DIRECTORY_ANCHOR = 0x04`; update `eventTypeUriToByte` mapping; update doc comment.
- *`packages/verify/src/types.ts`.* Extend `EventType` union with `'directory_anchor'`; add case in `graphLabelFromEventTypeUri`. Graph nodes for directory_anchor records get the new short label.
- *`services/log-node/src/server.ts`.* Decoder labels byte `0x04` as `'directory_anchor'`. `/v1/stats` `entries_by_event_type` gains a `directory_anchor` count.
- *`services/graph-node`.* No code change required; the URI-to-label mapping flows through `@atrib/verify`'s helper.
- *`services/directory-node`.* No code change. Already emits the URI.
- *`apps/dashboard`.* Chip color and label flow naturally from the new short-label string. The `renderEventChip` "atrib system" fallback (added under [D054](#d054-unified-public-explorer-vs-per-service-admin-uis)) becomes redundant for directory_anchor records but stays as the safety net for any future atrib-system URI that lands before its own byte allocation.
- *Existing records.* Pre-promotion directory_anchor records (encoded `0xFF`) remain valid. Verifiers wanting comprehensive queries filter by URI rather than byte for the transition window.
- *Conformance.* No `spec/conformance/2.3.1/` corpus exists yet. The spec change is small enough that the implementation tests in `packages/mcp/test/entry.test.ts` (existing) cover the regression risk; a corpus is a follow-up task if/when 2.3.1 gets formal vectors.

**Reopening criteria.** None. Promotion is irreversible (per [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary): "atrib does not retire normative URIs; once promoted, they stay"). If the URI is later deemed unwise, it becomes deprecated (verifiers warn, accept) but never invalidated.

---

## D057: Pre-call signing hook (`preCallTransform`) for cross-tool causal embedding

**Date:** 2026-05-04
**Status:** Accepted

**Context.** [§5.3](atrib-spec.md#53-atribmcp-mcp-server-middleware) describes the middleware as signing AFTER the upstream tool returns and adding the propagation token to the response `_meta`. This ordering is correct for the universal case: latency stays off the tool's critical path, and a failed tool call never produces an orphan signed record.

A class of useful integrations needs the inverse ordering. When an MCP tool writes data to durable storage (e.g., a row in a database, a message on a queue, a record in an external API), and downstream consumers want to anchor their own `informed_by` references to the row produced by that call, the row needs to carry the atrib receipt_id at the moment of insert, not as a follow-up update after the row already exists. Concrete example: an MCP server that posts to a shared-context database. A second agent reading that row immediately after the post should be able to extract the receipt_id and use it as an `informed_by` anchor for its own emission, closing a cross-repo causal edge in the graph. With post-call signing, the row briefly exists without the receipt_id; a fast consumer reads it before the column is filled in.

**Decision.** Add `preCallTransform?: PreCallTransform` to `AtribOptions`. When set, the middleware signs the record BEFORE forwarding the call to the upstream handler, computes the §1.5.2 propagation token (`receiptId`) and the canonical record_hash reference (`recordHash`), invokes the callback with `{ toolName, args, receiptId, recordHash, contextId }`, and replaces the upstream call's `arguments` with the return value. Post-success commit (onRecord, outbound context, log submission, autoChain bookkeeping) is unchanged: the same signed bytes that were committed pre-call to the host are queued for log submission post-success.

**Rationale.**

1. **Spec-orthogonal.** No on-disk record format changes, no spec section changes, no conformance corpus changes. The signed record is byte-identical to the post-call path; only the ordering of "produce signed bytes" vs. "forward to upstream" changes. Verifiers reading log entries cannot distinguish the two paths and do not need to.

2. **Opt-in keeps the default contract.** Tools without `preCallTransform` set retain post-call signing, preserving the universal-case latency guarantee. The pre-call latency tax (one Ed25519 signature on the critical path) is paid only when the host explicitly opts in for the cross-tool embedding benefit.

3. **Graceful degradation per [§5.8](atrib-spec.md#58-degradation-contract).** Errors thrown from `preCallTransform` (or any failure during pre-call signing) are caught; the middleware falls back to the standard post-call signing path so the tool call itself never fails because of attribution.

4. **No double-sign.** The pre-built record is cached and reused at commit time. Exactly one signed record is emitted per successful tool call, identical to the post-call path semantics.

5. **Failure semantics preserved.** If the upstream returns `isError: true` after pre-call signing, the pre-built record is discarded: no `onRecord` call, no log submission, no autoChain bookkeeping. The receipt_id may have been embedded into upstream args (and the tool may have done something with it), but no record claims that activity from the agent's side. This matches the post-call semantics: `isError` suppresses emission either way.

**Alternatives considered.**

1. *Two-phase commit via a follow-up `attach_atrib_receipt` tool on the upstream server.* Rejected. Two roundtrips per call; brief inconsistency window where the row exists without the receipt; requires every cross-tool-embedding upstream to expose a separate update tool; couples atrib's substrate to a specific upstream API shape.

2. *Manual signing path in the wrapper bypassing `createAtribProxy` for the affected tool.* Rejected. Wrapper code re-implements every middleware concern (autoChain, informedBy, onRecord, queue submission) for one tool. Drift risk: future middleware improvements (chain context handling, additional optional record fields) won't apply to the tools using the manual path until the manual path is updated.

3. *Default to pre-call signing for all tools.* Rejected. The universal-case contract is post-call signing per [§5.3](atrib-spec.md#53-atribmcp-mcp-server-middleware); changing the default would shift latency for every existing user of the middleware to gain a benefit only a small fraction of integrations need.

**Consequences.**

- *Spec.* No changes. The hook is implementation-side; on-the-wire records are identical.
- *`packages/mcp/src/middleware.ts`.* `buildSignedRecord` and `commitRecord` extracted as inner helpers; `makeWrappedHandler` gains the pre-call branch gated on `options.preCallTransform`.
- *`packages/mcp/src/index.ts`.* Exports `PreCallTransform` and `PreCallTransformContext` types alongside `AtribOptions` and `AtribServer`.
- *`packages/mcp/test/middleware.test.ts`.* Five new test cases cover: receipt_id format + shape, args mutation reaches upstream, no double-sign, throw → fallback to post-call, upstream isError → no commit and no autoChain bookkeeping. Existing 26 tests unchanged.
- *`packages/mcp/README.md`.* Adds a row to the `AtribOptions` table.
- *Reusable beyond Loop 5.* Any wrapper that needs to embed an atrib receipt into downstream-visible data (database rows, queue messages, external-API request bodies) gets the same hook for free. Future cross-tool causal-link work does not need to revisit this design.

**Reopening criteria.** None expected. The hook surface is small, opt-in, and on the SDK side rather than the spec side. If a future use case needs a different shape (e.g., the host needs to influence record fields beyond just args mutation), that is a separate addition rather than a revision of D057.

---

## D058: Promote `annotation` to atrib-normative event_type byte 0x05

**Date:** 2026-05-04
**Status:** Accepted

**Context.** Agents that read back their own signed records via the recall harness lose nuance compared to the agent that wrote them. The agent-at-write knew which records mattered, what topics they covered, what one-sentence summary captured them, what confidence applied. The agent-at-read sees a flat list of records of equal apparent weight and has to reconstruct importance from prose, often imperfectly.

The recall-fidelity primitive that closes this gap is *annotation*: a separate signed record pointing at any prior record via an `annotates` field, carrying structured metadata (importance, topics, summary) that downstream readers can filter and sort by. Annotation is the dual of `informed_by` — forward-pointing (a new record claims something *about* an earlier record) rather than backward-pointing (a new record claims earlier records *informed* it). Both are agent-declared causal links; both are surfaced as graph edges; their temporal orientation differs.

D055 ruled (2026-04-30) that `annotation` should stay as an extension URI in a single consumer's namespace because no second harness used the same shape. That ruling is reopened here: ANY atrib-using agent emitting "this record matters more than the others; weight it heavy in future recall" is using the same shape. Two independent harnesses (atrib-using agents in general, plus the original consumer specifically) need the identical semantic. The D036 promotion bar clears.

**Decision.** Promote `https://atrib.dev/v1/types/annotation` to the atrib-normative event_type vocabulary, taking byte `0x05` in the §2.3.1 log entry encoding. (D056 took `0x04` for `directory_anchor`; reserved range narrows from `0x05`–`0xFE` to `0x06`–`0xFE`.) Add the `annotates` optional field to the record format (§1.2.8): `sha256:<64-hex>` reference to the target record. Validators MUST require `annotates` on annotation records and MUST reject `annotates` on any other event_type. The graph layer derives `ANNOTATES` edges (the eighth edge type beyond §3.2.3's seven) per a new §3.2.4 step 8: for each annotation record A carrying `annotates: T`, create edge A → T; if T is not in the resolved set, create A → synthetic_dangling_node(T) with `dangling: true`.

**Rationale.**

1. **Recall fidelity is a substrate-level concern.** The "agents that reason from a past they can prove" tagline depends on that past being usefully readable, not just retrievable. Without structured annotation, every consumer reinvents the same importance-encoding pattern in prose, and readers can't filter by it without a domain-specific parser per consumer.

2. **Promotion bar (D036) is met.** Two independent harnesses need the identical semantic with no harness-specific divergence: (a) any atrib-using agent annotating its own prior records during recall workflows, (b) the original downstream consumer that minted the extension URI. The shape (`annotates` ref + structured importance/topics/summary) is identical across both.

3. **Dual-of-informed_by structure makes the cascade trivial.** Step 8 derivation mirrors Step 6 (INFORMED_BY) almost verbatim, modulo direction (forward vs backward) and the additional event_type filter. The dangling-node + reason annotation pattern from D056/Loop 5 carries over without modification.

4. **Byte allocation is the canonical fast-path filter.** Verifiers can byte-filter for annotations without fetching records, enabling fast queries like "all annotations on a session" without scanning every record. Pre-D058 annotation records (emitted under downstream-consumer extension URIs) remain valid signed records and remain queryable by URI; the byte filter only catches post-promotion records.

5. **Closes a downstream consumer's annotation-shape carryover.** Existing consumers emitting annotation-shaped records under `event_type=observation` (because the annotation URI wasn't normative) flip one URI string post-D058 and the records are correctly typed. The on-chain bytes are otherwise unaffected; the discontinuity is purely the event_type label.

**Alternatives considered.**

1. *Keep annotation as an extension URI per D055.* Rejected. The recall-fidelity insight provides the second-harness use case D055 was waiting for. Continuing to leave it as extension blocks structured recall queries across the atrib ecosystem.

2. *Add `annotates` field to `observation` event_type instead of minting a new type.* Rejected. Observation and annotation have distinct cognitive roles: observations are first-class signed events the agent witnessed, annotations are commentary about earlier records. Conflating them in the same event_type loses the queryability advantage and forces consumers to inspect every observation record's content shape to know which kind it is.

3. *Promote annotation but skip the `annotates` field requirement.* Rejected. Without a structured target reference, the graph layer can't derive ANNOTATES edges; consumers fall back to scanning content prose. The whole point of normative promotion is the structured queryability the field enables.

**Consequences.**

- *Spec.* §1.2.4 event_type table gains a row for annotation (byte 0x05). §1.2.8 added covering the `annotates` field. §2.3.1 byte mapping table gains a row, reserved range narrows. §3.2.3 edge types table gains ANNOTATES (eighth type). §3.2.4 derivation gets Step 8.
- *@atrib/mcp.* `EVENT_TYPE_ANNOTATION_URI` constant + `EVENT_TYPE_ANNOTATION = 0x05` byte + entry encoder switch case + types.ts `annotates` optional field. AtribRecord type extended.
- *@atrib/verify.* `EventType` union gains `'annotation'`. `EdgeType` union gains `'ANNOTATES'`. `graphLabelFromEventTypeUri` switch gains a case.
- *services/graph-node.* Step 8 derivation in graph-builder.ts. 8-edge regression guard updated (was 7-edge from D041+D044).
- *services/log-node.* Decoder switch + stats counter + endpoint doc + verify-loop validEventTypes Set + metrics.mjs per-byte filter.
- *apps/dashboard.* Chip color (teal) + `.chip.event-annotation` rule + Event-type chip block-comment refresh to reference D058.
- *Tests.* +4 graph-builder tests (resolved, dangling, malformed-on-non-annotation, multi-annotation). 8-edge regression guard now has the ANNOTATES leg.
- *Reusable beyond P003.* The forward-pointing dangling pattern is now established for any future link-via-field promotion.

**Reopening criteria.** None expected. Future cognitive primitives (e.g., revision per the parked P003.5 / 1.65 work) follow the same cascade pattern as new ADRs without revising D058.

---

## D059: Promote `revision` to atrib-normative event_type byte 0x06

**Date:** 2026-05-04
**Status:** Accepted

**Context.** Annotation (D058) addresses the recall-fidelity gap by letting agents weight, summarize, and topic-tag prior records. It does not address a distinct gap: when the agent's current position is *incompatible* with a prior claim, annotation comments without overturning, and informed_by acknowledges sources without contradicting them. There is no protocol-level primitive for "I held position X; I now hold not-X because of Z."

A recognized gap in prior approaches is the lack of a protocol-level primitive for explicitly signaling when an agent's position contradicts a prior claim. A revision record should be signed to declare: "P was my prior claim. C is my new claim. Reason for revision: Z." This enables future agents to locate and evaluate changes in stance as first-class graph nodes. Without a normative type, agents either smuggle the contradiction through observation prose (lossy) or skip emitting anything (the silent-override anti-pattern).

The promotion bar (D036) clears for the same reason annotation cleared: any atrib-using agent doing reasoning that involves position changes hits the same shape. The substrate generalizes; agent-specific divergence in semantics is unnecessary.

**Decision.** Promote `https://atrib.dev/v1/types/revision` to the atrib-normative event_type vocabulary, taking byte `0x06` in the §2.3.1 log entry encoding. (D058 took `0x05`; reserved range narrows to `0x07`–`0xFE`.) Add the `revises` optional field to the record format (§1.2.9): `sha256:<64-hex>` reference to the predecessor record this revision supersedes. Validators MUST require `revises` on revision records and MUST reject `revises` on any other event_type. The graph layer derives `REVISES` edges (the ninth edge type) per a new §3.2.4 step 9: for each revision record R carrying `revises: T`, create edge R → T; if T is not in the resolved set, create R → synthetic_dangling_node(T) with `dangling: true`. Multiple revisions of the same target are allowed (a chain of mind-changes).

**Rationale.**

1. **Mind-changes deserve first-class status.** The substrate's "agents that reason from a past they can prove" claim depends on being able to surface contradictions explicitly. Without REVISES, an agent reading back records sees inconsistent positions with no signal that one supersedes the other. Annotation is too weak to carry the semantic.

2. **D058 pattern is reusable verbatim.** Step 9 derivation mirrors Step 8 (ANNOTATES) modulo the field name (`revises` vs `annotates`) and event_type filter. The cascade across spec, mcp, verify, graph-node, log-node, dashboard is mechanical given the D058 precedent.

3. **Distinct semantic from annotation justifies a separate byte.** Conflating revision into annotation would force consumers to inspect content to know whether the new record overturns the old one or merely comments on it. Byte-level distinction keeps queries fast.

4. **No retroactive change to prior records.** Records remain immutable. A revision is a new signed record asserting the prior is no longer held; the prior stays on the log unchanged. This preserves the "atrib certifies what was signed, not what is currently true" invariant.

5. **Multiple revisions of the same target are allowed.** A chain of mind-changes (R1 revises P, R2 revises R1, R3 revises R2) produces a REVISES chain in the graph. Verifiers and recall consumers walk the chain to find the current position; the substrate doesn't normatively prescribe which revision "wins" because that's a downstream policy concern.

**Alternatives considered.**

1. *Use annotation for both commentary and revisions.* Rejected. Conflating commentary (no position change) with revision (position change) loses queryability and forces consumers into per-content parsing.

2. *Add a `revision_of` content field on observation records.* Rejected. Observations are first-class signed events, not commentary about prior records. Reusing observation for this would muddy its semantic and require consumers to filter every observation by content shape to find revisions.

3. *Skip the spec change and rely on agent prose to declare revisions.* Rejected. The whole point of normative promotion is making agent-declared causal links structurally derivable, not parseable-from-content. Without a field, no graph derivation; without graph derivation, no edge for verifiers and recall to query.

**Consequences.**

- *Spec.* §1.2.4 event_type table gains a row for revision (byte 0x06). §1.2.9 added covering the `revises` field. §2.3.1 byte mapping table gains a row, reserved range narrows to 0x07-0xFE. §3.2.3 edge types table gains REVISES (9 types now). §3.2.4 derivation gets Step 9.
- *@atrib/mcp.* `EVENT_TYPE_REVISION_URI` constant + `EVENT_TYPE_REVISION = 0x06` byte + entry encoder switch case + types.ts `revises` optional field. AtribRecord type extended.
- *@atrib/verify.* `EventType` union gains `'revision'`. `EdgeType` union gains `'REVISES'`. `graphLabelFromEventTypeUri` switch gains a case.
- *services/graph-node.* Step 9 derivation in graph-builder.ts.
- *services/log-node.* Decoder switch + stats counter + endpoint doc + scripts/verify-loop.mjs validEventTypes Set + scripts/metrics.mjs per-byte filter and label.
- *apps/dashboard.* Indigo chip color for revision + `.chip.event-revision` rule + Event-type chip block-comment refresh.
- *Tests.* +4 graph-builder tests (resolved, dangling, malformed-on-non-revision, multi-revision). 9-edge regression guard now expects the REVISES leg.

**Reopening criteria.** None expected. The pattern is now extensible to any future link-via-field event_type promotion (e.g., `delegation`, `apply`) following the same cascade with no reopening of D058 or D059.

---

# Pending decisions

These will get full ADRs when we act on them. Recorded here so they remain findable and don't silently drop. Per the global Deferred Decision Logging convention, this section uses the forward-looking pattern (forward-looking decisions that will become numbered ADRs when codified).

## P002: agent-bridge on atrib substrate

**Source:** Strategic question raised 2026-04-30 ("what if agent-bridge just used atrib for this stuff?"). Use Case 2: verifiable agent-to-agent coordination.

**The decision in question:** rebuild agent-bridge as `atrib-bridge` — a parallel implementation that uses atrib substrate (signed records + Merkle log + directory) instead of Postgres + Supabase as the storage and identity layer. Source becomes `creator_key` (cryptographic, not spoofable). Categories become `event_type` URIs in the agent-bridge namespace. Acks become signed records pointing at posts via `informed_by`. Postgres dependency disappears entirely.

**Strategic implications.** The substrate's reach was under-claimed by the original "verifiable tool calls" positioning. agent-bridge fitting on atrib substrate proves the substrate generalizes to verifiable agent-to-agent coordination. This is a concrete second use case beyond the original wrapper-on-MCP-tool-calls one and a flywheel for atrib adoption (every bridge user becomes an atrib user).

**Staging if accepted.** Build atrib-bridge as parallel implementation; dogfood for weeks; if it works, atrib-backed becomes the open-source default and the original Supabase-backed stays as legacy/development. Slots into the dogfooding sequencing as 6.5 + 6.6 (atrib-bridge prototype + atrib-bridge SKILL.md), after cross-session graph viz lands.

**Likely outcome (not committed):** accept; build the parallel implementation; let dogfood prove it out. The architectural and strategic case is strong; the open question is purely capacity (multi-week effort).

**ADR number** will be assigned when the decision is acted on. Do not pre-allocate.

## P004: human-direct signing as a first-class identity class (post-day-1)

**Source:** Signer-taxonomy design pass 2026-04-30, design question #8 (resolved: humans-direct allowed, post-day-1).

**The decision in question:** humans signing atrib records directly (distinct from agent-direction-of-human). Edge types to model the relationship: `AUTHORIZED_BY` (human → agent record), `ATTESTED_BY` (human → claim), `APPROVED_BY` (human → decision), `DELEGATED_TO` (human → agent). Spec changes: new edge types in [§3.2.3](atrib-spec.md#323-edge-types) + derivation rules in [§3.2.4](atrib-spec.md#324-edge-derivation-rules). Identity-resolution changes: humans get a distinct `claim_type` (currently `self_attested` covers both).

**Why deferred.** Day 1 dogfood doesn't require it. Compliance-shaped use cases (regulator wants on-graph proof of human authorization) need it; we're not pursuing those use cases yet.

**Reopening criteria.** First adopter that needs cryptographic distinction between "human authorized" and "agent did this autonomously." Likely candidates: payment-protocol counterparties, regulated financial actions, healthcare-adjacent automation.

**Likely outcome when acted on:** the spec changes are small (new edge types + derivation rules + claim_type extension); the operational change is bigger (humans need their own keys, key management UX, distinguishing identity from agent identities they direct). Defer until a real use case forces the operational work.

**ADR number** will be assigned when acted on.

## P005: reconcile @atrib/verify README per-record annotations with actual code surface

**Source:** Audit during the 2026-05-03 sign_record decoupling work. The package README documents per-record annotations the result object should surface (`informed_by_resolution`, `provenance`, `capability_check`, `cross_attestation`, `cross_log_proof_count`/`threshold_met`/`equivocation_detected`, posture detection from §8). Several of these decision references (D041, D044, D045, D051, D052) shipped to the spec but the corresponding code surface in `packages/verify/src/` is partial.

**Source state at audit (initial 2026-05-03):**

- `provenance` annotation: shipped 2026-05-03 via the new `verifyRecord(record, options)` per-record API in `packages/verify/src/verify-record.ts` + `spec/conformance/1.2.6/` corpus + `packages/verify/test/conformance-1.2.6.test.ts`.
- `informed_by_resolution`, `capability_check`, `cross_attestation`, `cross_log_*`, posture detection: documented in README, NOT yet in code.
- `resolveIdentity` and `CapabilityEnvelope` types ARE implemented but not surfaced through `VerificationResult`.

**Progress as of 2026-05-04:**

- `informed_by_resolution`: implemented (D041 surface) — `verifyRecord` populates `{ resolved, dangling }` from caller-supplied candidates.
- `posture` (timestamp_granularity, §8.4 + commitment forms, §8.3): implemented (D045 surface) — `verifyRecord` always populates `{ timestamp_granularity, timestamp_consistent, timestamp_granularity_explicit, args_commitment_form, result_commitment_form }`. Commitment-form detection is structural per §8.3: `args_salt` / `result_salt` presence ⇒ `salted-sha256`; absence ⇒ `plain-sha256` (the §8.3 hmac-sha256 variant is signaled out-of-band and not structurally detectable).
- `capability_check`: implemented (D051 surface) — `verifyRecord` populates `{ envelope, in_envelope, mismatches, unresolvable }` when caller passes a resolved `identityClaim`. Caller does the directory lookup; `@atrib/verify` has no `@atrib/directory` dependency. `tool_names` (against tool_call), `max_amount`, and `counterparties` (against transaction) flag `unresolvable: true` because the constraint inputs aren't on the standard record shape or aren't accessible without out-of-band protocol-event data.
- `tool_name_form` (§8.2): **BLOCKED** on a §1.2.1 spec extension to add `tool_name` as a MAY field. The current standard shape exposes only the derived `content_id`; verifier has no `tool_name` value to pattern-match against the §8.2 verbatim / opaque / hashed forms. Closing this requires a small normative ADR adding `tool_name` (and likely `args_hash` + `result_hash`) with JCS-canonical sort positions and backwards-compat semantics (absence = §8.1 default posture). Verifier surface is trivial once the inputs exist.
- `cross_attestation` (D052 / §1.7.6): **BLOCKED** on a `signers[]` field on `AtribRecord` plus a transaction-record canonicalization variant in `@atrib/mcp`. The §1.2 spec describes the transaction shape with `signers[]` instead of top-level `signature`, but the TypeScript type still uses the standard shape. Closing this requires the type extension, sign-side support for multi-signer transaction records, and verifier multi-signature path.
- `cross_log_*` (D050 / §2.11): **BLOCKED** on multi-log proof-bundle parsing infrastructure and a trusted-log-set config surface.

**Pattern.** P005.1 (capability_check) implemented cleanly because the constraint inputs were either (a) on the existing record (`event_type`, `timestamp`) or (b) supplied by the caller via the `identityClaim` option (which they fetch from `@atrib/directory`). The remaining surfaces all share a structural blocker: they need fields added to the canonical record shape first, which is downstream spec work, not verifier work. Tracked as separate ADRs when an external consumer needs the surface.

**The decision in question.** The README represents intended state. Two paths to reconcile:

1. **Land each annotation as a separate ADR-stamped piece of work** (D041 already covers informed_by; D051 covers capability_check; D052 covers cross_attestation; D050 covers cross_log_*; D045 covers posture). Each gets its own conformance corpus + verify code surface + test, in the same shape as D044's recently-completed work. Most rigorous.
2. **One sweep that wires everything currently-spec'd into `verifyRecord` at once.** Faster but loses the ADR-per-feature traceability.

**Why deferred.** No external consumer of `@atrib/verify` exists yet. The asymmetric README is correct as a design target; closing the gap now is investment for not-yet-existent verifiers. Day-1 dogfood works fine with `provenance` only (the D044 piece is shipped).

**Reopening criteria.** First external verifier integrator OR first external auditor reading the README and getting confused by the missing fields. At that point, whichever ADR corresponds to the missing surface gets prioritized.

**Likely outcome when acted on:** option 1, ADR-per-feature, since each feature already has a parent decision number to reference. The pattern set by D044's reconciliation (verify-record.ts + spec/conformance/1.2.6 + verify test) is reusable for each remaining annotation.

**ADR number** will be assigned per-feature when acted on.

## D060: CHANGELOG strategy — changesets per-package + GitHub Releases, no top-level CHANGELOG

**Supersedes:** P006 (pending decision, now acted on)

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
2. **release-please from conventional commits (P006 option 4).** Conflicts with changesets — both want to own version bumping.
3. **GitHub Releases only, no per-package CHANGELOGs (P006 option 3).** Loses per-package version history once a package's release notes scroll off the Releases tab.

### Consequences

- `createGithubReleases: true` added to the release job's `changesets/action` config in `.github/workflows/release.yml`.
- Future Version Packages PRs auto-create per-package GitHub Releases (e.g., `@atrib/mcp@0.1.3`) on merge, in addition to publishing to npm.
- DECISIONS.md doubles as the authoritative log for non-package architectural decisions; per-package CHANGELOGs cover code/release-level changes.
- If atrib-spec.md revision history becomes load-bearing (first external spec implementer raises it), open a follow-up ADR specifying the location and format.
