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
**Decision:** The graph (§3) is a strict fact layer. The policy (§4) is a separate evaluation layer. Graph endpoints never return weighted data. The calculation algorithm is a pure function of graph + policy. Any party can verify independently.
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
**Context:** During the implementation, we examined whether the core primitives alone deliver the spec's central privacy claim ("observability without surveillance," §0). The answer is that the claim requires three layers working together, and it's important to track which layers are built and which aren't.
**Decision:** The privacy architecture is:

- **Layer 1 (record format):** The `AtribRecord` type captures structural metadata only: no tool call arguments, no response content, no user queries, no transaction amounts. Content never enters the hashing pipeline. This is implemented in .
- **Layer 2 (log commitments):** The Merkle log stores 90-byte entries (record_hash, creator_key, context_id, timestamp, event_type): commitments, not records. Full records stay with the parties. This is implemented via log submission in .
- **Layer 3 (middleware discipline):** The degradation contract (§5.8) ensures errors, retries, and failure modes don't leak content through logs or error messages. Proof bundles serve inclusion proofs, not records. This is implemented in .

All three layers are necessary. Layer 1 alone is necessary but not sufficient.

**Known tension:** `content_id = sha256(serverUrl + ":" + toolName)` reveals _which tool at which server_ was called. The spec treats this as acceptable structural metadata (tool existence is public via MCP `tools/list`, same information exists in OTel spans), but it is the closest the protocol gets to the surveillance line. A future revision could explore blinded content_ids if this proves problematic.
**Alternatives considered:** Salting/blinding content_ids (would break independent reproducibility required by §4.6), encrypting log entries (adds key management complexity, deferred).

## D014: Cross-package integration tests live in a private workspace package and re-derive primitives

**Date:** 2026-04-06
**Context:** The end-to-end test plan calls for an end-to-end test exercising the full attribution flow across all three SDK packages. The question was where this test should live and what it should import. Two options: (a) put it inside an existing package (e.g., `@atrib/verify/test/integration.test.ts`), reusing existing imports; (b) create a separate private workspace package that depends on all three SDK packages and re-derives shared primitives independently.
**Decision:** Created `@atrib/integration` as a private workspace package (`"private": true`, no `dist/`, only test runner). It depends on `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` as peers. Critically, its `graph-builder.ts` re-implements `recordHash()` from primitives (`sha256(canonicalRecord(...))`) rather than importing a hash function from `@atrib/mcp`. This mirrors what a real graph indexing service (`graph.atrib.dev`) would do: index records arriving from arbitrary creators across the open log, without depending on the SDK that produced them.
**Why this matters:** The §4.6 calculation algorithm's correctness rests on the claim that "any party with the same inputs gets the same result." If integration tests reused the SDK's hash function, two implementations could silently agree because they share code. By re-deriving in the test, we validate that JCS canonicalization + SHA-256 produce identical output across two independent code paths. The end-to-end test passing demonstrates that the chain reconstructs (`A → B → tx`) precisely because `chain_root` references match record hashes derived independently.
**Alternatives considered:** Test inside `@atrib/verify` (would hide the boundary), test at the repo root (no package isolation), publish `@atrib/integration` as a public package (no value to consumers, only to the project).

## D015: ACP and UCP detect on a unified completion shape, distinguished by the `ucp` envelope

**Date:** 2026-04-06
**Context:** cross-spec verification. The v1 SDK shipped with synthetic ACP/UCP detection rules (`response.data.object.object === 'checkout_session'`, `type === 'order.created'`, `event_type === 'ORDER_CREATED'`) that came from imagined Stripe-event-envelope shapes. We never cross-checked them against the real ACP and UCP specs. When we did the verification (via the `/agentic-commerce-protocol/agentic-commerce-protocol` and `/universal-commerce-protocol/ucp` repos), it turned out that (a) neither protocol uses any of those shapes, (b) ACP and UCP have converged on essentially the same checkout completion response, and (c) the `TransactionDetection.protocol` literal `'ACP/UCP'` was hiding a distinction that consumers actually care about.
**Decision:**

- Detection signal for both protocols is `status === 'completed'` AND `order.id` is a string. Webhook events `order_create` / `order_update` (snake_case, NOT `order.created`) are also accepted as ACP transaction events.
- UCP is distinguished from ACP by the presence of a top-level `ucp.version` envelope on the completion response.
- Split the protocol literal type into `'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'heuristic'` so consumers can switch on the actual protocol. The middleware's `emitTransactionRecord` switch was updated correspondingly.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/{acp,ucp}/`, with provenance README files citing the source URL and verification date.
- Spec §1.7.1 and §1.7.2 were rewritten to match real ACP/UCP shapes. The §5.4.5 detection pseudocode was updated to match.
- Because neither ACP nor UCP currently exposes a documented free-form metadata field on `POST /checkout_sessions/...` requests, the spec now requires `context_id` to travel via the `X-atrib-Context` HTTP header (consistent with x402/MPP) and via `params._meta.atrib` for MCP-transport integrations. The earlier spec language describing `metadata.atrib_context_id` and `extensions["io.atrib/context_id"]` was speculative and has been removed.
  **Alternatives considered:** Keeping the joint `'ACP/UCP'` literal (loses information consumers want), making detection lenient with multiple synonymous keys (false positives), waiting for ACP/UCP to add metadata fields before fixing the spec (blocks the SDK indefinitely on upstream protocol decisions).
  **Followup work:** §2 (x402/MPP) and §3 (AP2) verification, pending in the same internal planning doc. The MPP-vs-x402 distinction in the new code uses an optional `Payment-Protocol` response header marker; this is an atrib convention because both protocols share the same `Payment-Receipt` header on the response side and we need a way to distinguish them when both might be in use. If a future revision of x402 or MPP standardizes a different distinguisher, update this rule.

**Update (2026-04-06, same day):** D016 supersedes the "shared `Payment-Receipt` header" assumption above. Verification against the actual specs revealed that x402 and MPP use **different** response headers and there is no need for an atrib-invented `Payment-Protocol` marker.

## D016: x402 and MPP detect on different headers, not a shared one

**Date:** 2026-04-06
**Context:** x402/MPP cross-spec verification verification. The v1 SDK and the original §1.7.3/§1.7.4 spec text both claimed x402 and MPP use a shared `Payment-Receipt` response header. D015 even introduced an atrib-invented `Payment-Protocol` distinguisher to tell them apart. When we cross-checked against the published specs, both claims turned out to be wrong.
**What the real specs say:**

- **x402** (`github.com/coinbase/x402`): the success-path response header is `PAYMENT-RESPONSE` in v2, renamed from v1's `X-PAYMENT-RESPONSE` per RFC 6648 (deprecation of the `X-` prefix). The value is base64-encoded JSON containing a `SettlementResponse` with `success`, `transaction`, `network`, `payer`, `requirements` fields.
- **MPP** (IETF `draft-ryan-httpauth-payment-01`, "The 'Payment' HTTP Authentication Scheme", co-authored by Tempo Labs and Stripe, launched March 2026): the success-path response header is `Payment-Receipt`, value is base64url-nopad JSON with required fields `{ status: "success", method, timestamp, reference }`. The draft explicitly states _"Servers MUST NOT return a Payment-Receipt header on error responses"_, which makes header presence a reliable detection signal.
- The two protocols are different. They both build on HTTP 402 Payment Required, but their on-wire mechanisms diverge: x402 uses custom `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, while MPP uses standard HTTP authentication (`WWW-Authenticate: Payment` / `Authorization: Payment`) plus the new `Payment-Receipt` response header.

**Decision:**

- Detection now checks `PAYMENT-RESPONSE` (or v1 legacy `X-PAYMENT-RESPONSE`) for x402 and `Payment-Receipt` for MPP, all matched case-insensitively per RFC 7230.
- The fictional `Payment-Protocol` marker introduced in D015's footnote was removed.
- Precedence rule when both headers are somehow present: x402 wins. This is documented in tests.
- Spec §1.7.3 and §1.7.4 rewritten to cite the real headers and source documents. The §5.4.5 detection pseudocode was updated to match. A note was added flagging the prior conflation as an error so future readers don't reintroduce it.
- Real captured payload shapes (decoded JSON for both `PAYMENT-RESPONSE` and `Payment-Receipt`) live under `packages/agent/test/fixtures/{x402,mpp}/` with provenance README files citing the canonical sources.
- Detection uses **header presence** as the on-wire signal. Decoding the base64 body to validate `success: true` (x402) or `status: "success"` (MPP) is not done in v1. The spec language for both protocols treats the header as the authoritative signal, and the degradation contract (§5.8) means false positives from a misconfigured server are preferable to false negatives caused by overly strict shape matching. Higher-fidelity downstream tooling that needs to extract the transaction hash for content_id derivation can decode the body itself.

**Alternatives considered:**

- Decoding the header value and validating `success: true` / `status: "success"` (rejected; tightens detection at the cost of robustness; the degradation contract favors silent passes over silent fails)
- Treating `Payment-Receipt` as a synonym for `PAYMENT-RESPONSE` (rejected; they are different protocols with different wire formats and tooling, and the SDK consumer needs to know which one fired)
- Adding a single combined `'x402-or-mpp'` literal back to the protocol type (rejected for the same reason as the joint `'ACP/UCP'` literal in D015; it hides information consumers care about)

**Followup:** §3 (AP2 / W3C VC) verification, then §4 (W3C Trace Context conformance) and §5 (MCP SDK extension API) per the internal planning doc.

## D017: AP2 v0.1 uses A2A DataParts, not W3C Verifiable Credentials

**Date:** 2026-04-06
**Context:** AP2 cross-spec verification verification. The v1 SDK and the original spec §1.7.5 both assumed Google's AP2 (Agent Payments Protocol) would use W3C Verifiable Credentials with `type === 'VerifiableCredential'` and `credentialSubject.type === 'PaymentMandate'` to express a Payment Mandate. When verified against the actual AP2 v0.1 specification at `github.com/google-agentic-commerce/ap2`, this turned out to be wrong. AP2 v0.1 does not use W3C VCs at all.
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
- Both paths report `protocol: 'AP2'`. We do not introduce a separate `'a2a-x402'` literal for the same reason D015 split joint literals: extra distinctions only when consumers care, and a2a-x402 IS AP2.
- The legacy W3C VC envelope check is kept as a fallback for research forks that may have implemented Payment Mandates as VCs (matching the obsolete spec language), but the canonical detection path is the A2A DataPart shape. The fallback accepts both VC v2 array form and v1 string form.
- IntentMandate and CartMandate are explicitly tested as non-transaction events to lock in the correct funnel semantics.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/ap2/` with a provenance README citing both the AP2 v0.1 spec and the a2a-x402 v0.1 spec.
- Spec §1.7.5 was rewritten to match real AP2 / a2a-x402 shapes with a clear note that the prior W3C VC assumption was wrong. The §5.4.5 detection pseudocode was updated correspondingly.

**Alternatives considered:**

- Detecting all three mandate types (Intent, Cart, Payment) as transaction events (rejected; would falsely close attribution chains on intent-capture or cart-commit events, violating §3.1's structure-not-causality rule)
- Treating a2a-x402 as a separate `'a2a-x402'` protocol literal (rejected; it is the AP2 crypto payment path; consumers care about AP2-vs-not-AP2, not AP2-card-vs-AP2-crypto)
- Decoding and validating the cart_mandate hash chain in the PaymentMandate (rejected; that's verification work belonging in `@atrib/verify`, not on the agent middleware critical path)
- Removing the legacy W3C VC fallback entirely (rejected; costs nothing to keep, costs developer trust to silently break a research-fork integration)

**Followup:** §4 (W3C Trace Context conformance) and §5 (MCP SDK extension API) per the internal planning doc. The handoff also calls out that this verification would touch `emitTransactionRecord` for AP2 content_id derivation; in the end no change was needed there because AP2 still uses the MCP server URL fallback (the PaymentMandate carries useful identifiers like `payment_request_id` but extracting them per-protocol is not required for v1; see future v2 work in the open questions section of the handoff).

## D018: W3C Trace Context and Baggage conformance: leftmost atrib, lenient parse, evict-from-end on overflow

**Date:** 2026-04-06
**Context:** W3C Trace Context conformance verification verification. The v1 SDK emitted W3C tracestate and baggage but had three classes of bugs against the W3C specs (`https://www.w3.org/TR/trace-context/` and `https://www.w3.org/TR/baggage/`), all flagged in the internal planning doc §4 success criteria.

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

**Followup:** §5 (MCP SDK extension API) and §6 (framework adapters) per the internal planning doc.

## D019: MCP SDK monkey-patch is documented and shape-tested against the real SDK

**Date:** 2026-04-06
**Context:** MCP SDK extension API verification verification. The v1 SDK monkey-patches `McpServer.server.setRequestHandler` and detects the tools/call request via Zod schema introspection (`schema.shape.method.value === 'tools/call'`). Both are internal implementation details of `@modelcontextprotocol/sdk` that could change between versions. The internal planning doc §5 success criteria asked for either (a) refactoring to a documented extension API, or (b) clear documentation plus a regression test that catches SDK upgrade breakage.

**What the SDK actually exposes** (verified against `@modelcontextprotocol/sdk@^1.29.0` with `context7` and direct inspection of `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/.../server/index.d.ts` and `server/mcp.d.ts`):

- `McpServer.registerTool(name, config, callback)`: current high-level API for registering tools (replaces deprecated `.tool()` overloads).
- `McpServer.tool(...)`: deprecated variadic API, still supported.
- `Server.setRequestHandler<T extends AnyObjectSchema>(requestSchema: T, handler)`: low-level API. Currently takes a Zod schema (e.g., `CallToolRequestSchema`) as the first argument. The v2 migration docs hint at a future string-based form (`setRequestHandler('tools/call', handler)`), but that has not landed in 1.x.
- **No documented middleware, interceptor, or `use(...)` extension API exists** in any current version of the SDK.
- McpServer internally accumulates tool callbacks from `registerTool` / `tool` and lazily registers a single dispatching `tools/call` handler on the underlying low-level Server. This is why our patch works: both the high-level `registerTool` path and direct low-level `setRequestHandler` use funnel through the same underlying call.

**Decision:** Take option (b): keep the monkey-patch, but make it survivable across SDK changes:

1. **Robust schema detection**: a new `isToolsCallSchema(schema)` helper accepts FOUR known forms: `schema === 'tools/call'` (v2 string form), `schema.shape.method.value === 'tools/call'` (1.x Zod literal), `schema.shape.method._def.value === 'tools/call'` (deeper Zod traversal), and `schema.method === 'tools/call'` (pre-parsed). The patch survives both the v2 migration AND any of several common Zod-version variations without code change.
2. **Runtime sanity check at init time**: the middleware now checks that `server.server` exists and `server.server.setRequestHandler` is a function. If not, it logs a loud warning identifying the SDK shape change and degrades to pass-through mode (per §5.8) instead of throwing or silently doing nothing.
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

**Followup:** §6 (framework adapters) per the internal planning doc. After §6, the handoff also lists §7 (developer integration documentation) and §8 (TypeDoc API reference) as the remaining work.

## D020: the framework-adapter rollout framework adapter targets: Claude Agent SDK, Cloudflare Agents, Vercel AI SDK (re-ranked from incomplete prior decision)

**Date:** 2026-04-06
**Context:** The internal planning doc doc and an earlier in-session "final decision" (an earlier ranking pass, recorded earlier in development) listed the §6 framework adapter targets as **Vercel AI SDK → Mastra → LangChain JS** with OpenAI Agents and Claude Agent SDK as tier-2 and Cloudflare Agents deferred. That decision was written **before** several rounds of GitHub code search results arrived, and its conclusions were never updated against the complete data. After a after a data refresh, the relevant searches were re-run with the refreshed data and the gap on OpenAI Agents (which had no GitHub data at all in the prior pass) was filled. The integrated picture changes the right answer materially.

**Methodology corrections to the prior decision:**

- The earlier in development "final decision" weighted purely on **npm package downloads of MCP-specific subpackages** (`@ai-sdk/mcp` 509K/wk, `@langchain/mcp-adapters` 261K/wk, `@mastra/mcp` 169K/wk). It explicitly noted "GitHub code search for framework-specific import patterns was blocked by authentication; no code search counts available."
- 5 minutes after the decision was recorded, GitHub CLI auth was confirmed working in the local environment and three batches of authenticated code searches ran (a later research pass–#28597, 3:26–later in development). The decision was not revisited against that data before the was paused.
- Two additional bugs in the prior search batches were also caught and fixed during the data-refresh pass: quoted-string queries in `gh search code` were returning `0` due to encoding issues (e.g. Cloudflare `from "agents/mcp"` returned 0 quoted, **892** unquoted), and the OpenAI Agents queries were never run at all because the a prior search batch had been auth-blocked and an earlier search pass only ran the Cloudflare/Anthropic/Vercel/Mastra/LangChain ones before stopping.
- The data-refresh pass re-ran the complete set authenticated against `gh api search/code` (which returns total counts directly via `total_count`), filling the OpenAI Agents gap and confirming all alternate-name queries.

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

**Decision:** Replace the prior tier list. The new §6 build order is:

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

- The §6 work is **not** purely a `packages/agent/` problem. Two of the three top adapters (Claude Agent SDK and Cloudflare Agents) are _server-side proxy_ plays that live in `packages/mcp/`. The §6 success criteria need to be expanded accordingly; "framework adapters" was a misleading shorthand.
- The proxy server pattern requires new code: a thin wrapper in `packages/mcp/` that constructs an `McpServer`, calls `atrib()` on it, registers handlers that fan out to one or more upstream MCP servers (via `Client` from `@modelcontextprotocol/sdk`), and propagates results back. This is reusable across both the Claude SDK and Cloudflare adapters and possibly more in the future.
- The Vercel AI SDK adapter is the smallest change: a single function in `packages/agent/` that takes the result of `createMCPClient` and wraps the `tools()` record's `execute` callbacks with the existing interceptor lifecycle.

**Followup:** Build the proxy server primitive, then the Claude Agent SDK adapter on top of it, then the Cloudflare Agents adapter on the same primitive, then the Vercel AI SDK `tools()` wrap. Internal planning notes for the framework list should be updated to match this decision in a follow-up commit.

## D021: Claude Agent SDK Case A is zero-new-code; Case B uses createAtribProxy() in-process forwarder

**Date:** 2026-04-06
**Context:** D020 set the the framework-adapter rollout build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Claude Agent SDK adapter as "an in-process proxy MCP server living in `packages/mcp/`". Before writing code, the actual `@anthropic-ai/claude-agent-sdk` source was inspected (npm pack of v0.2.92) to verify how the SDK accepts and invokes user-provided MCP servers. The finding materially refines D020's plan: the Claude Agent SDK adapter splits cleanly into two cases, and the first case requires zero new code in `@atrib/mcp`.

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

**Followup:** Build the runnable Claude Agent SDK example (Case A and Case B side-by-side), update `README.md` with a "Use with Claude Agent SDK" section pointing at the example, then start the Cloudflare Agents adapter on the same `createAtribProxy` primitive. The handoff doc §6 framework list still needs to be synced to D020/D021 in a follow-up commit.

## D022: Cloudflare Agents adapter: McpAgent server-side is zero-code; Agent client-side uses attributeCloudflareAgentMcp() (NOT createAtribProxy)

**Date:** 2026-04-06
**Context:** D020 set the the framework-adapter rollout build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Cloudflare adapter as "the same proxy server pattern as Claude Agent SDK", i.e. expected to reuse the `createAtribProxy()` primitive shipped in D021. Before writing code, the actual `agents@0.9.0` source was inspected (npm pack + grep on `dist/index-BtHngIIG.d.ts` and `dist/client-BwgM3cRz.js`). The findings make the right architecture noticeably different from D020's prediction in two ways: the proxy isn't needed for either of Cloudflare's two MCP surfaces, and the client-side surface is even smaller than expected.

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
**Context:** the framework-adapter rollout, third framework adapter, after Claude Agent SDK (D021) and Cloudflare Agents (D022). The Vercel AI SDK exposes MCP integration through `createMCPClient()` in `@ai-sdk/mcp` (and the legacy `experimental_createMCPClient()` re-exported from `ai`). My initial assumption (anchored to the followup note in D022) was that this would be a `tools()`-record-wrapping job: replace each tool's `execute()` callback with one that runs through atrib's interceptor. Source-reading `@ai-sdk/mcp@1.0.35`'s `dist/index.mjs` invalidated that plan and surfaced two structural facts that ruled out both `wrapMcpClient` and the `tools()`-wrap approach.

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

**Followup:** With three framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK), the framework-adapter rollout is substantially complete. Remaining §6 work: decide whether to add OpenAI Agents SDK and/or Mastra adapters based on the GitHub usage data from the prior research session. Then §7 (developer integration documentation) and §8 (TypeDoc API reference). A pattern is emerging across D018/D021/D022/D023: each adapter required source-reading the host framework before deciding the integration shape, and in every case my initial guess from D020 was wrong in the specifics. The general approach (interceptor lifecycle + structural-shape adapters) holds, but the integration point varies per framework: server-side `setRequestHandler` patch (@atrib/mcp), in-process `McpServer` proxy (Claude Agent SDK Case B), in-place `client` field replacement (Cloudflare Agent), and `request()` monkey-patch (Vercel AI SDK).

---

## D024: LangChain JS MCP adapter: NOT docs-only. `MultiServerMCPClient` needs a proper helper because its internal Client references are `#private`

**Date:** 2026-04-06
**Context:** D020 asserted that LangChain would ship as a docs-only adapter because `loadMcpTools(name, rawClient)` accepts an injected `@modelcontextprotocol/sdk` Client, so `wrapMcpClient` from `@atrib/agent` would cover it transparently. After a closer review on "why docs-only instead of doing it properly", I unpacked `@langchain/mcp-adapters@1.1.3` and source-read the actual API. The docs-only claim was half right and half wrong.

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

**Followup:** Four framework adapters shipped (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS). With the unified `packages/agent/README.md` (shipped in this change) now documenting all adapters side-by-side under two coverage matrices (framework adapters + payment protocols), the "one interceptor, any framework" story is concrete and demonstrable. Remaining §6 work: OpenAI Agents SDK (deferred per D020; meaningfully different architecture, custom transports) and Mastra (deferred; smaller footprint, needs source verification). Next priority is §7 developer integration docs, including the local log stub and end-to-end demo that unblocks customer conversations (per an earlier strategic review).

---

## D025: `@atrib/log-dev` + spec/code drift fix in submission wire format + `priority` wired to two real consumers

**Date:** 2026-04-06
**Context:** Strategic review session concluded that the highest-leverage next chunk was a runnable end-to-end demo a customer can watch in 15 minutes, and that the demo required a local Merkle log stub because the production Tessera-backed log at `log.atrib.dev/v1` doesn't exist yet. While preparing to build that stub against spec §2.6, source-reading `@atrib/mcp/src/submission.ts` surfaced two real wire-format bugs that would have caused every submission from the existing client to be rejected by any spec-compliant log:

**Discrepancy 1: Request body shape was wrong.** Spec §2.6.1 specifies the POST body as a bare attribution record. The existing `submitWithRetry` was wrapping it as `{record, priority}`. The wrapping pattern was even codified in `packages/mcp/test/submission.test.ts` ("sends record and priority in request body"), meaning the test was written against the buggy code rather than against the spec.

**Discrepancy 2: Proof bundle field naming was wrong.** Spec §2.6.2 returns `{log_index, checkpoint, inclusion_proof, leaf_hash}` (snake_case). The existing `ProofBundle` interface used camelCase (`logIndex`, `inclusionProof`). This was less load-bearing because the cast to `ProofBundle` in the submission queue is opaque; nothing read the fields after caching, but `@atrib/verify`'s `GraphNode.log_index` already used snake_case correctly, so the two packages were inconsistent with each other and only one matched the spec.

**Decision:** Fix both discrepancies as part of this chunk and ship `@atrib/log-dev` as a faithful spec §2.6 reference implementation. Specifically:

1. **Wire format fix in `submission.ts`:** POST body is now a bare signed record per §2.6.1. The `ProofBundle` interface uses snake_case to match §2.6.2 exactly. Updated all consuming tests across `@atrib/mcp`, `@atrib/agent`, and `@atrib/integration` (test-harness mocked the wrong shape too; fixed there as well).

2. **`@atrib/log-dev`**: new private workspace package at `packages/log-dev/` (option A from the "where should the log stub live?" sanity check, after feedback indicated on "this seems more proper"). Implements `POST /v1/entries` with full §2.6.1 validation (Steps 2-6, skipping Step 1 cryptographic signature verification to avoid a circular dep on `@atrib/verify`), returns spec §2.6.2-shaped proof bundles with deterministic placeholder hashes, and exposes an inspection API (`entries`, `onSubmit`, `clear`) for tests and demos. Marked `private: true` so it cannot be `pnpm publish`'d to npm. README has a prominent ⚠️ NOT FOR PRODUCTION warning at the top.

3. **`priority` wired to two real consumers**: this was the most impactful direction-correction in the session. My initial plan was to drop `priority` from the wire entirely after recognizing that the in-memory dev log can't meaningfully consume it. Direction was reconsidered: "can you find a real consumer today? Just do it all properly." Re-thinking, I found two real consumers that ship in this change:

   **Consumer #1: `flush()` retry ordering in `@atrib/mcp/src/submission.ts`.** When the process is shutting down and `pendingRecords` contains records whose initial submission failed, `flush()` now drains them in priority order: high (transactions) before normal (tool calls). If the process is killed mid-flush (container restart, OOM, deploy rollover), high-priority records have already had their final retry and are more likely to make it to the log. Losing a transaction record (the receipt of money moving) is meaningfully worse than losing a tool-call record, so this ordering is a real safety property. `pendingRecords` was changed from `Map<string, AtribRecord>` to `Map<string, {record, priority}>` to track priority across the failure→flush boundary. Verified by a new test in `submission.test.ts` ("flush() drains pendingRecords in priority order").

   **Consumer #2: `@atrib/log-dev`'s admission control under capacity.** The dev log accepts a `maxConcurrent` option (default `Infinity`). When capacity is finite and the in-flight submission count is at the cap, new submissions go into a priority queue inside `storage.ts` and high-priority records are admitted first when capacity frees up. This faithfully models the admission-control behavior a real Tessera-backed log would expose under load. Verified by a new test in `log-dev/test/server.test.ts` ("high-priority submissions are admitted before normal under capacity pressure") that uses `maxConcurrent: 1` and `processingDelayMs: 30` to deterministically demonstrate the priority ordering.

   The wire format is `X-atrib-Priority: high|normal` HTTP header, a non-conflicting extension to spec §2.6.1 that does not require a spec change because HTTP headers are a standard extension mechanism.

4. **End-to-end demo** at `packages/integration/examples/end-to-end/demo.ts`, runnable in a single command (`pnpm --filter @atrib/integration demo`), wires together the dev log + a fake merchant tool server (wrapped with `@atrib/mcp`'s `atrib()`) + a fake agent client (wrapped with `@atrib/agent`'s `wrapMcpClient`) + a stubbed x402 payment receipt that triggers the production transaction-detection logic in `transaction.ts`. CLI visualizer subscribes to the dev log via `onSubmit()` and pretty-prints each record with colored chain hashes as it lands. Verified end-to-end: one run produces 2 tool_call records + 1 transaction record, all chained, all visible in the CLI output.

**Why this matters strategically:**

The end-to-end demo is the answer to "what can I hand a customer in 15 minutes?", the question we identified in the strategic review earlier in development. Before this commit, the protocol was implemented but a customer couldn't watch it work without standing up Tessera first (which doesn't exist). After this commit, `pnpm demo` produces a complete attribution chain visible in real time, with real signatures and real transaction detection, against a real (but in-memory) spec-compliant log. The fakery is in the surrounding environment: the merchant returns hardcoded search results, the agent issues hardcoded tool calls, the x402 payment is a stubbed header, but the protocol layer is real.

The spec/code drift fix is the kind of thing that only gets caught when you build a real reference implementation. Mocking `globalThis.fetch` in unit tests doesn't catch wire-format bugs because the mocks don't validate the request shape against the spec. The dev log is a real server that validates per §2.6.1; it caught the wrong wire format on the first integration attempt. This is a strong argument for keeping `@atrib/log-dev` in the test infrastructure permanently rather than treating it as a one-off demo helper.

**Alternatives considered:**

- **Drop `priority` from the wire entirely (option (a) from the priority discussion).** Initially leaned toward this on the grounds that no consumer existed. A closer review surfaced two real consumers that had not yet been wired. Rejected after that pushback because two real consumers DO exist, they just hadn't been wired yet.
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

**Followup:** With the spec/code drift fixed and the dev log in place, the next layer of customer-readiness work is (a) the `services/log/` Tessera-backed Go service for production deployments, and (b) publishing `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` to npm so customers can actually `pnpm add` them. Both are out of scope for this chunk but are the next logical steps after this commit. The unified `packages/agent/README.md` is ready to be the customer-facing entry point once packages are published.

---

## D026: Spec §2.6.1 conformance corpus at `spec/conformance/2.6.1/` (shared between TS dev log and future Go log)

**Date:** 2026-04-06

**Context:** During the docs sync that followed D025, the question raised was what gaps remained that a docs sync couldn't fix. One was that `@atrib/log-dev` and the future `services/log/` Tessera-backed Go service had no shared agreement on §2.6.1 behavior beyond the prose in the spec. Two implementations of "what does §2.6.1 reject" derived independently from the spec text would inevitably drift in subtle ways. Direction was to shipping the corpus immediately even though the Go consumer doesn't yet exist: "is that something you can do now or do you need to wait?"

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

1. **Registry**, a versioned source of truth for which on-chain identifiers (wallets, signers, merchant accounts) belong to which protocol actor. Combines the protocol's canonical registry (when it exists), facilitator self-declaration endpoints (`/supported` for x402), and an overlay for entries absent or undisclosed in canonical sources.
2. **Scanner**, on-chain (or off-chain) aggregators that measure ecosystem-level activity. For x402 that means Dune SQL contract-first queries today and HyperSync-backed bulk scans next. Methodology is protocol-specific (wallet-first vs contract-first vs event-pattern), but every adapter outputs the same shape: `sender → {tx_count, transfer_count, value}` or equivalent.
3. **Attribution**, maps scanned observations to the registry's known actors, with an unattributed residual bucket. Attribution techniques are protocol-specific (witness decoding, sender-pattern clustering, payTo correlation) but every adapter emits `{attributed, unknown}` cleanly splittable output.

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

**Context.** A C2SP signed-note checkpoint commits the log to a (size, root) pair under an Ed25519 signature. To verify the signature, a third party needs the log's public key. Before this decision the only way to acquire that key was out-of-band, the operator had to publish it via a website, a known directory, or person-to-person. The signed-note signature line carries a 4-byte key_id (SHA-256(origin‖0x0A‖0x01‖pubkey)[:4]) but that's a one-way commitment, not a key.

This was discovered while building a reproducible end-to-end verifier (`services/atrib-wrapper/scripts/verify-loop.mjs`): the verifier could prove tree integrity (locally re-derived root == checkpoint root) but had to SKIP the checkpoint-signature gate because no key was reachable.

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

A test verifies that the published `key_id` exactly matches the prefix in the live checkpoint signature line, AND that running `ed.verifyAsync(sig, body, public_key)` against the published pubkey succeeds, meaning the endpoint is real-cryptography-load-bearing and not just a status surface.

**Alternatives considered.**

1. *Publish the pubkey to a static `.well-known` file.* Rejected because it requires a second hosting surface and decouples the published key from the running signer. With `/v1/pubkey` reading from the live signer, the pubkey can never drift out of sync with the actual signature being produced.

2. *Embed the pubkey in every checkpoint body* (e.g. as a 4th line). Rejected because it changes the wire format of `/v1/checkpoint`, a breaking change to a published spec section (§2.4.1) for a problem that's solved cleanly with an additive endpoint.

3. *Require verifiers to derive the pubkey from the seed via a separate "trust root" service.* Rejected because it introduces a second trust dependency for what is fundamentally one log's accountability surface.

**Consequences.**

- Verifiers (third parties + dogfood scripts) can now run `Ed25519.verify(sig, body, pubkey)` against the checkpoint without out-of-band key acquisition. This closes the previously-named "GAP 1" in the dogfood verification loop.
- The endpoint adds zero attack surface: the public key is by design exposable; exposing it is what makes the checkpoint signature meaningful to anyone other than the operator.
- A future witnessing protocol (multiple signatures on one checkpoint) gets a per-witness `/v1/pubkey` analog for free, since the shape generalizes (each signer publishes its own).

**What this DOESN'T solve.** Key rotation. If the log's signing key changes, `/v1/pubkey` returns the new key, and historical checkpoints signed under the old key become unverifiable from this endpoint alone. A future ADR will specify either (a) a rotation log of `(key_id, public_key)` pairs returned by `/v1/pubkey`, or (b) a separate `/v1/keys` endpoint listing all keys ever used. Out of scope for V1.

