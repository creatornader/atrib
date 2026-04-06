# Atrib — Decision Log

Architectural and design decisions made during the Atrib protocol development. Each entry records what was decided, why, and what alternatives were considered.

---

## D001 — Agent-first sequencing, not browser-first

**Date:** 2026-04-05
**Context:** The protocol needed a go-to-market wedge. Browser/OS adoption requires convincing Google/Apple. Prior attempts (Brave, Coil, Flattr) failed by targeting human browsing.
**Decision:** Build for agent-to-agent transactions first. Agents don't have UX preferences, the volume is growing exponentially, and the protocol can be API-native from day one. Extend to human-facing content later.
**Alternatives considered:** Browser extension, browser fork, OS-level integration.

## D002 — Attribution layer, not payment layer

**Date:** 2026-04-05
**Context:** Agent-to-agent payments are a crowded space (Stripe, PayPal, Visa, x402, MPP, ACP, UCP). Competing on payment rails is a losing position.
**Decision:** Atrib is payment-rail agnostic. It sits above all payment protocols and answers "who should get paid and why" — not "how does money move." Settlement uses whatever rail the merchant already has.
**Alternatives considered:** Building a payment rail, integrating with a single rail (Stripe), issuing a token.

## D003 — Ed25519, not DIDs or PKI

**Date:** 2026-04-05
**Context:** Creator identity needs to be cryptographically verifiable. DIDs add complexity and dependency on DID resolution infrastructure. PKI requires certificate authorities.
**Decision:** Raw Ed25519 keypairs. Simple, fast, no external dependencies. 32-byte seed, deterministic public key derivation. Key rotation deferred to v2.
**Alternatives considered:** DIDs (too complex for v1), X.509 certificates (requires PKI), starting unsigned and adding signing later (insufficient trust).

## D004 — OTel trace-id as context_id, not a custom identifier

**Date:** 2026-04-05
**Context:** Attribution records need a session identifier to form chains. Could generate a custom ID or reuse existing infrastructure.
**Decision:** context_id IS the W3C Trace Context trace-id from OTel. Not derived from it — the same value. This means Atrib chains are automatically correlated with existing observability traces.
**Alternatives considered:** Custom Atrib session ID (duplicates existing infrastructure), hash of trace-id (prevents correlation).

## D005 — Structure not causality in the graph

**Date:** 2026-04-05
**Context:** The natural instinct is to encode causal relationships ("tool A influenced tool B which caused purchase"). But causality is an inference, not a verifiable fact.
**Decision:** The graph records observable structure only — chain linkage, shared session, timestamps. Causal interpretation belongs to the policy layer. Five edge types, all derived deterministically from record structure. No edge encodes a causal claim.
**Alternatives considered:** Explicit influence/transact action types (early design, rejected because it smuggled causal claims into the record), semantic analysis of tool names (rejected — not verifiable).

## D006 — Merkle log (C2SP tlog-tiles), not blockchain

**Date:** 2026-04-05
**Context:** Attribution records need global verifiability. Blockchain provides this but carries cultural and economic baggage (tokens, gas costs, crypto association).
**Decision:** Certificate Transparency-style append-only Merkle log using the C2SP tlog-tiles ecosystem. Same cryptographic guarantees as a blockchain for append-only verification, without tokens, gas, or crypto association. Tessera-based implementation.
**Alternatives considered:** Ethereum/Base (gas costs, crypto baggage), Sigstore Rekor (repurposing a software supply chain tool), blockchain with anchoring (complexity).

## D007 — Log stores commitments, not content

**Date:** 2026-04-05
**Context:** The log needs to prove records exist without revealing what they contain. This is the "observability without surveillance" principle.
**Decision:** Log entries are 90-byte fixed structs containing: record_hash, creator_key, context_id, timestamp, event_type. No tool call content, no response data, no user identity, no transaction amounts.
**Alternatives considered:** Storing full records (privacy-hostile), storing encrypted records (key management complexity), storing nothing (no verifiability).

## D008 — Middleware pattern, not method calls

**Date:** 2026-04-05
**Context:** Nader's core requirement: "it has to be literally automated." Developer adoption fails the moment someone has to decide when to call an attribution method.
**Decision:** The SDK is a middleware wrapper with one init call and zero ongoing surface area. `atrib(server, { creatorKey })` — everything else is automatic. No methods to call after init. No configuration for when to emit.
**Alternatives considered:** Explicit API methods (requires developer judgment), event hooks (requires configuration), decorator pattern (framework-specific).

## D009 — Fact/policy separation as an architectural boundary

**Date:** 2026-04-05
**Context:** For attribution to be trusted by both creators and merchants, each must be able to independently verify: (1) the graph accurately reflects what happened, and (2) the settlement was correctly calculated. Mixing fact and policy into one layer makes independent verification intractable.
**Decision:** The graph (§3) is a strict fact layer. The policy (§4) is a separate evaluation layer. Graph endpoints never return weighted data. The calculation algorithm is a pure function of graph + policy. Any party can verify independently.
**Alternatives considered:** Combined graph+policy API (simpler but unverifiable), policy enforcement in the protocol (makes Atrib an arbiter).

## D010 — Default policy: equal weight, zero for unsigned

**Date:** 2026-04-05
**Context:** The protocol needs a sensible default when no policies are published. The default must be uncontroversial and make no value judgments.
**Decision:** Equal weight (1.0) for all five edge types on signed nodes. Zero weight for unsigned gap nodes. No modifiers, no floors, no caps. The least opinionated possible baseline.
**Alternatives considered:** Weighted by edge type (already a value judgment), equal including unsigned (rewards non-participation), no default (cold-start problem).

## D011 — Dual transaction emission paths with anti-double-emission

**Date:** 2026-04-05
**Context:** Transaction records can be emitted by the merchant (if they have @atrib/mcp) or by the agent (if the merchant doesn't). Both paths must exist for cold-start adoption, but only one can fire per transaction.
**Decision:** Path 1 (merchant) is preferred. Path 2 (agent) is fallback. The agent detects Path 1 by checking if the checkout response contains an attribution token. If present, Path 2 is suppressed. This prevents duplicate transaction nodes.
**Alternatives considered:** Merchant-only (blocks adoption before merchant integration), agent-only (merchant key not on transaction), deduplication in the log (adds state to a stateless append-only system).

## D012 — Open spec, commercial product (Stripe model)

**Date:** 2026-04-05
**Context:** For the protocol to be trusted as infrastructure, it must be open. For the company to be sustainable, something must be commercial.
**Decision:** The spec, signing libraries, and log infrastructure are open and free. The queryable attribution graph (`graph.atrib.io`), analytics dashboard, and settlement resolution API (`resolve.atrib.io`) are commercial products. This follows the Stripe model: open standards, best implementation.
**Alternatives considered:** Fully open with donations (Wikipedia model — chronically underfunded), fully closed (no trust, no adoption), token-funded (crypto baggage).

## D013 — "Observability without surveillance" is delivered across three layers, not one

**Date:** 2026-04-05
**Context:** During Phase 1 implementation, we examined whether the core primitives alone deliver the spec's central privacy claim ("observability without surveillance" — §0). The answer is that the claim requires three layers working together, and it's important to track which layers are built and which aren't.
**Decision:** The privacy architecture is:

- **Layer 1 (record format):** The `AtribRecord` type captures structural metadata only — no tool call arguments, no response content, no user queries, no transaction amounts. Content never enters the hashing pipeline. This is implemented in Phase 1.
- **Layer 2 (log commitments):** The Merkle log stores 90-byte entries (record_hash, creator_key, context_id, timestamp, event_type) — commitments, not records. Full records stay with the parties. This is implemented via log submission in Phase 2.
- **Layer 3 (middleware discipline):** The degradation contract (§5.8) ensures errors, retries, and failure modes don't leak content through logs or error messages. Proof bundles serve inclusion proofs, not records. This is implemented in Phase 2.

All three layers are necessary. Layer 1 alone is necessary but not sufficient.

**Known tension:** `content_id = sha256(serverUrl + ":" + toolName)` reveals *which tool at which server* was called. The spec treats this as acceptable structural metadata (tool existence is public via MCP `tools/list`, same information exists in OTel spans), but it is the closest the protocol gets to the surveillance line. A future revision could explore blinded content_ids if this proves problematic.
**Alternatives considered:** Salting/blinding content_ids (would break independent reproducibility required by §4.6), encrypting log entries (adds key management complexity, deferred).

## D014 — Cross-package integration tests live in a private workspace package and re-derive primitives

**Date:** 2026-04-06
**Context:** The end-to-end test plan calls for an end-to-end test exercising the full attribution flow across all three SDK packages. The question was where this test should live and what it should import. Two options: (a) put it inside an existing package (e.g., `@atrib/verify/test/integration.test.ts`), reusing existing imports; (b) create a separate private workspace package that depends on all three SDK packages and re-derives shared primitives independently.
**Decision:** Created `@atrib/integration` as a private workspace package (`"private": true`, no `dist/`, only test runner). It depends on `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` as peers. Critically, its `graph-builder.ts` re-implements `recordHash()` from primitives (`sha256(canonicalRecord(...))`) rather than importing a hash function from `@atrib/mcp`. This mirrors what a real graph indexing service (`graph.atrib.io`) would do — index records arriving from arbitrary creators across the open log, without depending on the SDK that produced them.
**Why this matters:** The §4.6 calculation algorithm's correctness rests on the claim that "any party with the same inputs gets the same result." If integration tests reused the SDK's hash function, two implementations could silently agree because they share code. By re-deriving in the test, we validate that JCS canonicalization + SHA-256 produce identical output across two independent code paths. The end-to-end test passing demonstrates that the chain reconstructs (`A → B → tx`) precisely because `chain_root` references match record hashes derived independently.
**Alternatives considered:** Test inside `@atrib/verify` (would hide the boundary), test at the repo root (no package isolation), publish `@atrib/integration` as a public package (no value to consumers, only to the project).

## D015 — ACP and UCP detect on a unified completion shape, distinguished by the `ucp` envelope

**Date:** 2026-04-06
**Context:** cross-spec verification — the v1 SDK shipped with synthetic ACP/UCP detection rules (`response.data.object.object === 'checkout_session'`, `type === 'order.created'`, `event_type === 'ORDER_CREATED'`) that came from imagined Stripe-event-envelope shapes. We never cross-checked them against the real ACP and UCP specs. When we did the verification (via the `/agentic-commerce-protocol/agentic-commerce-protocol` and `/universal-commerce-protocol/ucp` repos), it turned out that (a) neither protocol uses any of those shapes, (b) ACP and UCP have converged on essentially the same checkout completion response, and (c) the `TransactionDetection.protocol` literal `'ACP/UCP'` was hiding a distinction that consumers actually care about.
**Decision:**
- Detection signal for both protocols is `status === 'completed'` AND `order.id` is a string. Webhook events `order_create` / `order_update` (snake_case, NOT `order.created`) are also accepted as ACP transaction events.
- UCP is distinguished from ACP by the presence of a top-level `ucp.version` envelope on the completion response.
- Split the protocol literal type into `'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'heuristic'` so consumers can switch on the actual protocol. The middleware's `emitTransactionRecord` switch was updated correspondingly.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/{acp,ucp}/`, with provenance README files citing the source URL and verification date.
- Spec §1.7.1 and §1.7.2 were rewritten to match real ACP/UCP shapes. The §5.4.5 detection pseudocode was updated to match.
- Because neither ACP nor UCP currently exposes a documented free-form metadata field on `POST /checkout_sessions/...` requests, the spec now requires `context_id` to travel via the `X-Atrib-Context` HTTP header (consistent with x402/MPP) and via `params._meta.atrib` for MCP-transport integrations. The earlier spec language describing `metadata.atrib_context_id` and `extensions["io.atrib/context_id"]` was speculative and has been removed.
**Alternatives considered:** Keeping the joint `'ACP/UCP'` literal (loses information consumers want), making detection lenient with multiple synonymous keys (false positives), waiting for ACP/UCP to add metadata fields before fixing the spec (blocks the SDK indefinitely on upstream protocol decisions).
**Followup work:** §2 (x402/MPP) and §3 (AP2) verification — pending in the same internal planning doc. The MPP-vs-x402 distinction in the new code uses an optional `Payment-Protocol` response header marker; this is an Atrib convention because both protocols share the same `Payment-Receipt` header on the response side and we need a way to distinguish them when both might be in use. If a future revision of x402 or MPP standardizes a different distinguisher, update this rule.

**Update (2026-04-06, same day):** D016 supersedes the "shared `Payment-Receipt` header" assumption above. Verification against the actual specs revealed that x402 and MPP use **different** response headers and there is no need for an Atrib-invented `Payment-Protocol` marker.

## D016 — x402 and MPP detect on different headers, not a shared one

**Date:** 2026-04-06
**Context:** x402/MPP cross-spec verification verification. The v1 SDK and the original §1.7.3/§1.7.4 spec text both claimed x402 and MPP use a shared `Payment-Receipt` response header. D015 even introduced an Atrib-invented `Payment-Protocol` distinguisher to tell them apart. When we cross-checked against the published specs, both claims turned out to be wrong.
**What the real specs say:**
- **x402** (`github.com/coinbase/x402`): the success-path response header is `PAYMENT-RESPONSE` in v2, renamed from v1's `X-PAYMENT-RESPONSE` per RFC 6648 (deprecation of the `X-` prefix). The value is base64-encoded JSON containing a `SettlementResponse` with `success`, `transaction`, `network`, `payer`, `requirements` fields.
- **MPP** (IETF `draft-ryan-httpauth-payment-01`, "The 'Payment' HTTP Authentication Scheme", co-authored by Tempo Labs and Stripe, launched March 2026): the success-path response header is `Payment-Receipt`, value is base64url-nopad JSON with required fields `{ status: "success", method, timestamp, reference }`. The draft explicitly states *"Servers MUST NOT return a Payment-Receipt header on error responses"*, which makes header presence a reliable detection signal.
- The two protocols are different. They both build on HTTP 402 Payment Required, but their on-wire mechanisms diverge: x402 uses custom `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, while MPP uses standard HTTP authentication (`WWW-Authenticate: Payment` / `Authorization: Payment`) plus the new `Payment-Receipt` response header.

**Decision:**
- Detection now checks `PAYMENT-RESPONSE` (or v1 legacy `X-PAYMENT-RESPONSE`) for x402 and `Payment-Receipt` for MPP, all matched case-insensitively per RFC 7230.
- The fictional `Payment-Protocol` marker introduced in D015's footnote was removed.
- Precedence rule when both headers are somehow present: x402 wins. This is documented in tests.
- Spec §1.7.3 and §1.7.4 rewritten to cite the real headers and source documents. The §5.4.5 detection pseudocode was updated to match. A note was added flagging the prior conflation as an error so future readers don't reintroduce it.
- Real captured payload shapes (decoded JSON for both `PAYMENT-RESPONSE` and `Payment-Receipt`) live under `packages/agent/test/fixtures/{x402,mpp}/` with provenance README files citing the canonical sources.
- Detection uses **header presence** as the on-wire signal. Decoding the base64 body to validate `success: true` (x402) or `status: "success"` (MPP) is not done in v1 — the spec language for both protocols treats the header as the authoritative signal, and the degradation contract (§5.8) means false positives from a misconfigured server are preferable to false negatives caused by overly strict shape matching. Higher-fidelity downstream tooling that needs to extract the transaction hash for content_id derivation can decode the body itself.

**Alternatives considered:**
- Decoding the header value and validating `success: true` / `status: "success"` (rejected — tightens detection at the cost of robustness; the degradation contract favors silent passes over silent fails)
- Treating `Payment-Receipt` as a synonym for `PAYMENT-RESPONSE` (rejected — they are different protocols with different wire formats and tooling, and the SDK consumer needs to know which one fired)
- Adding a single combined `'x402-or-mpp'` literal back to the protocol type (rejected for the same reason as the joint `'ACP/UCP'` literal in D015 — it hides information consumers care about)

**Followup:** §3 (AP2 / W3C VC) verification, then §4 (W3C Trace Context conformance) and §5 (MCP SDK extension API) per the internal planning doc.

## D017 — AP2 v0.1 uses A2A DataParts, not W3C Verifiable Credentials

**Date:** 2026-04-06
**Context:** AP2 cross-spec verification verification. The v1 SDK and the original spec §1.7.5 both assumed Google's AP2 (Agent Payments Protocol) would use W3C Verifiable Credentials with `type === 'VerifiableCredential'` and `credentialSubject.type === 'PaymentMandate'` to express a Payment Mandate. When verified against the actual AP2 v0.1 specification at `github.com/google-agentic-commerce/ap2`, this turned out to be wrong. AP2 v0.1 does not use W3C VCs at all.
**What the real AP2 spec says:**
- AP2 is built on top of A2A (Agent2Agent). The wire format for a Payment Mandate is an A2A `Message` containing one or more `parts`, where the `kind: "data"` part has a `data` object with the key `ap2.mandates.PaymentMandate` and the AP2 PaymentMandate schema as its value.
- The PaymentMandate schema includes `payment_details.payment_request_id`, `payment_details.merchant_agent_card.name`, `payment_details.amount`, etc. — all plain JSON, no JSON-LD `@context`, no `proof` field, no W3C VC machinery.
- AP2 also defines `IntentMandate` (intent capture, upstream of cart) and `CartMandate` (cart commitment, upstream of payment). These appear in the same A2A DataPart shape under `ap2.mandates.IntentMandate` and `ap2.mandates.CartMandate`. They are NOT transaction events and MUST NOT be detected as such.
- The extension URI is `https://github.com/google-agentic-commerce/ap2/tree/v0.1`.

**What a2a-x402 is:**
- a2a-x402 (`github.com/google-agentic-commerce/a2a-x402`) is the AP2 extension for crypto payments via x402, co-developed by Google with Coinbase, Ethereum Foundation, and MetaMask. It is NOT a separate protocol — it is the AP2 crypto payment path.
- The success-path message is an A2A task with `status.message.metadata["x402.payment.status"] === "payment-completed"` AND `status.message.metadata["x402.payment.receipts"]` containing at least one entry where `success: true`. A `payment-completed` status with only `success: false` receipts represents a failed settlement and is NOT a transaction event.
- Atrib reports a2a-x402 transactions as `protocol: 'AP2'` (not as a separate literal) because the on-wire mechanism is part of AP2.

**Decision:**
- Detection now checks two real AP2 paths: (1) `parts[].data["ap2.mandates.PaymentMandate"]` for the standard AP2 v0.1 shape, (2) the a2a-x402 task metadata shape requiring BOTH `payment-completed` status AND a successful receipt.
- Both paths report `protocol: 'AP2'`. We do not introduce a separate `'a2a-x402'` literal for the same reason D015 split joint literals: extra distinctions only when consumers care, and a2a-x402 IS AP2.
- The legacy W3C VC envelope check is kept as a fallback for research forks that may have implemented Payment Mandates as VCs (matching the obsolete spec language), but the canonical detection path is the A2A DataPart shape. The fallback accepts both VC v2 array form and v1 string form.
- IntentMandate and CartMandate are explicitly tested as non-transaction events to lock in the correct funnel semantics.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/ap2/` with a provenance README citing both the AP2 v0.1 spec and the a2a-x402 v0.1 spec.
- Spec §1.7.5 was rewritten to match real AP2 / a2a-x402 shapes with a clear note that the prior W3C VC assumption was wrong. The §5.4.5 detection pseudocode was updated correspondingly.

**Alternatives considered:**
- Detecting all three mandate types (Intent, Cart, Payment) as transaction events (rejected — would falsely close attribution chains on intent-capture or cart-commit events, violating §3.1's structure-not-causality rule)
- Treating a2a-x402 as a separate `'a2a-x402'` protocol literal (rejected — it is the AP2 crypto payment path; consumers care about AP2-vs-not-AP2, not AP2-card-vs-AP2-crypto)
- Decoding and validating the cart_mandate hash chain in the PaymentMandate (rejected — that's verification work belonging in `@atrib/verify`, not on the agent middleware critical path)
- Removing the legacy W3C VC fallback entirely (rejected — costs nothing to keep, costs developer trust to silently break a research-fork integration)

**Followup:** §4 (W3C Trace Context conformance) and §5 (MCP SDK extension API) per the internal planning doc. The handoff also calls out that this verification would touch `emitTransactionRecord` for AP2 content_id derivation; in the end no change was needed there because AP2 still uses the MCP server URL fallback (the PaymentMandate carries useful identifiers like `payment_request_id` but extracting them per-protocol is not required for v1 — see future v2 work in the open questions section of the handoff).

## D018 — W3C Trace Context and Baggage conformance: leftmost atrib, lenient parse, evict-from-end on overflow

**Date:** 2026-04-06
**Context:** W3C Trace Context conformance verification verification. The v1 SDK emitted W3C tracestate and baggage but had three classes of bugs against the W3C specs (`https://www.w3.org/TR/trace-context/` and `https://www.w3.org/TR/baggage/`), all flagged in the internal planning doc §4 success criteria.

**What the real specs say:**
- **Tracestate** (W3C trace-context):
  - List-member grammar is `key OWS "=" OWS value`, comma-separated. OWS around the `=` is allowed and receivers must accept it.
  - Maximum **32 list-members**. Vendors SHOULD propagate at least 512 characters total.
  - "One entry per key is allowed" — vendors MUST overwrite duplicate keys.
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
- The merge helpers are exported from `@atrib/mcp` so consumers can integrate Atrib into their own header-handling code without re-deriving the discipline. This becomes the canonical W3C-conformant API surface.

**Alternatives considered:**
- Validating tracestate/baggage on the way IN as well as on the way OUT (rejected — receivers should be lenient per Postel's principle, and rejecting malformed inbound state would break the degradation contract by silently dropping legitimate but slightly-off inputs from upstream vendors)
- Using a separate W3C trace-context library (rejected — adds a dependency for a small amount of straightforward parsing; we own the discipline and can keep it pinned to spec)
- Adding a runtime warning when truncation occurs (deferred — would require a logger plumbed through to the merge helpers; future-work item if observed in practice)

**Followup:** §5 (MCP SDK extension API) and §6 (framework adapters) per the internal planning doc.

## D019 — MCP SDK monkey-patch is documented and shape-tested against the real SDK

**Date:** 2026-04-06
**Context:** MCP SDK extension API verification verification. The v1 SDK monkey-patches `McpServer.server.setRequestHandler` and detects the tools/call request via Zod schema introspection (`schema.shape.method.value === 'tools/call'`). Both are internal implementation details of `@modelcontextprotocol/sdk` that could change between versions. The internal planning doc §5 success criteria asked for either (a) refactoring to a documented extension API, or (b) clear documentation plus a regression test that catches SDK upgrade breakage.

**What the SDK actually exposes** (verified against `@modelcontextprotocol/sdk@^1.29.0` with `context7` and direct inspection of `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/.../server/index.d.ts` and `server/mcp.d.ts`):
- `McpServer.registerTool(name, config, callback)` — current high-level API for registering tools (replaces deprecated `.tool()` overloads).
- `McpServer.tool(...)` — deprecated variadic API, still supported.
- `Server.setRequestHandler<T extends AnyObjectSchema>(requestSchema: T, handler)` — low-level API. Currently takes a Zod schema (e.g., `CallToolRequestSchema`) as the first argument. The v2 migration docs hint at a future string-based form (`setRequestHandler('tools/call', handler)`), but that has not landed in 1.x.
- **No documented middleware, interceptor, or `use(...)` extension API exists** in any current version of the SDK.
- McpServer internally accumulates tool callbacks from `registerTool` / `tool` and lazily registers a single dispatching `tools/call` handler on the underlying low-level Server. This is why our patch works: both the high-level `registerTool` path and direct low-level `setRequestHandler` use funnel through the same underlying call.

**Decision:** Take option (b) — keep the monkey-patch, but make it survivable across SDK changes:
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
- Refactoring to wrap `McpServer.registerTool` / `tool` directly was considered. It's slightly cleaner but requires more wrap surface area (two methods, two signatures each in 1.x), it doesn't cover users who use the low-level Server directly, and the regression risk is the same — both APIs are internal to McpServer and can change. The monkey-patch on `setRequestHandler` is the single chokepoint.
- A regression test that imports the real SDK is the strongest possible mitigation: any SDK upgrade that breaks our assumptions fails CI immediately, with a precise error message naming what changed.

**Tests added (6):**
- `McpServer.server` exists
- `McpServer.server.setRequestHandler` is a function
- `CallToolRequestSchema` matches at least one detection path
- `CallToolRequestSchema.safeParse` accepts a real tools/call request
- End-to-end: real SDK + atrib() + tool registration + dispatch + attribution record submission
- Graceful degradation: fake McpServer with missing `.server` triggers warning + pass-through

**Followup:** §6 (framework adapters) per the internal planning doc. After §6, the handoff also lists §7 (developer integration documentation) and §8 (TypeDoc API reference) as the remaining work.

## D020 — the framework-adapter rollout framework adapter targets: Claude Agent SDK, Cloudflare Agents, Vercel AI SDK (re-ranked from incomplete prior decision)

**Date:** 2026-04-06
**Context:** The internal planning doc doc and an earlier in-session "final decision" (an earlier ranking pass, recorded earlier in development) listed the §6 framework adapter targets as **Vercel AI SDK → Mastra → LangChain JS** with OpenAI Agents and Claude Agent SDK as tier-2 and Cloudflare Agents deferred. That decision was written **before** several rounds of GitHub code search results arrived, and its conclusions were never updated against the complete data. After a after a data refresh, the relevant searches were re-run with the refreshed data and the gap on OpenAI Agents (which had no GitHub data at all in the prior pass) was filled. The integrated picture changes the right answer materially.

**Methodology corrections to the prior decision:**
- The earlier in development "final decision" weighted purely on **npm package downloads of MCP-specific subpackages** (`@ai-sdk/mcp` 509K/wk, `@langchain/mcp-adapters` 261K/wk, `@mastra/mcp` 169K/wk). It explicitly noted "GitHub code search for framework-specific import patterns was blocked by authentication — no code search counts available."
- 5 minutes after the decision was recorded, GitHub CLI auth was confirmed working in the local environment and three batches of authenticated code searches ran (a later research pass–#28597, 3:26–later in development). The decision was not revisited against that data before the was paused.
- Two additional bugs in the prior search batches were also caught and fixed during the data-refresh pass: quoted-string queries in `gh search code` were returning `0` due to encoding issues (e.g. Cloudflare `from "agents/mcp"` returned 0 quoted, **892** unquoted), and the OpenAI Agents queries were never run at all because the a prior search batch had been auth-blocked and an earlier search pass only ran the Cloudflare/Anthropic/Vercel/Mastra/LangChain ones before stopping.
- The data-refresh pass re-ran the complete set authenticated against `gh api search/code` (which returns total counts directly via `total_count`), filling the OpenAI Agents gap and confirming all alternate-name queries.

**Complete GitHub real-usage data (TypeScript files, fetched 2026-04-06):**

| Framework | Primary signal | Files | Alternate-name signals |
|---|---|---|---|
| Claude Agent SDK | `"@anthropic-ai/claude-agent-sdk" McpServer` | **1,680** | `mcpServers` + `claude-agent-sdk` 1,376; pkg import 3,160; `ClaudeSDKClient` 98 |
| Cloudflare Agents | `agents/mcp` (client) + `MCPClientConnection` | **~1,050** | unquoted `agents/mcp` 892; `MCPClientConnection` 158; server `extends McpAgent` 868 |
| Vercel AI SDK | `experimental_createMCPClient` | **908** | bare `createMCPClient` 1,936 (overcounts non-Vercel); `@ai-sdk/mcp` 704 |
| OpenAI Agents | `MCPServerSSE` | **616** | `MCPServerStdio` 266; `MCPServerStreamableHttp` 171; `getAllMcpTools` 235; `connectMcpServers` 176; pkg import `@openai/agents` 2,768 |
| Mastra | `"@mastra/mcp" MCPClient` | **494** | pkg import `@mastra/mcp` 506; legacy `MastraMCPClient` 98 |
| LangChain | `MultiServerMCPClient` | **442** | `loadMcpTools` 408; pkg `@langchain/mcp-adapters` 374 |
| (substrate) | `@modelcontextprotocol/sdk/client` | 2,224 | already covered by `wrapMcpClient` in commit `c450672` |

**Decision:** Replace the prior tier list. The new §6 build order is:

1. **Claude Agent SDK** — highest GitHub footprint (1,680 files), bundles `@modelcontextprotocol/sdk` directly (an earlier dependency analysis confirmed dependency analysis), and the architecturally cleanest interception path. Because the SDK fully encapsulates MCP server setup from the consumer (users pass `mcpServers: {...}` config, never touch the Client themselves), the right interception point is **not** an agent-side wrapper — it is an **in-process proxy MCP server** that lives in `packages/mcp/` and re-uses the existing `atrib()` middleware. The user configures their Claude Agent SDK to point at the proxy, the proxy forwards to the real upstream MCP servers, and attribution records are emitted at the proxy layer. Zero changes to `packages/agent/` for this adapter.
2. **Cloudflare Agents** — second highest (~1,050 client-side files), also bundles `@modelcontextprotocol/sdk` directly. Same proxy architecture as Claude Agent SDK applies. The 892 figure was hidden from the prior decision by a quoted-query encoding bug; without that bug, Cloudflare would have ranked second from the start instead of being deferred.
3. **Vercel AI SDK** — third by GitHub footprint (908 `experimental_createMCPClient` files), strongest pure-npm signal (509K/wk for `@ai-sdk/mcp`). Different interception strategy: wrap the `tools()` record returned by `createMCPClient` rather than `callTool()` directly. Lives in `packages/agent/` as a thin export.
4. **(Deferred to a follow-up)** OpenAI Agents — has the largest *parent* framework footprint (2,768 import sites) but its MCP transport is custom and does not depend on `@modelcontextprotocol/sdk`. Adapter requires subclassing `MCPServerStdio`/`MCPServerSSE`/`MCPServerStreamableHttp` rather than wrapping a Client. This is the highest implementation cost per unit of coverage and should ship after the top three are validated against real users.
5. **(Deferred)** Mastra and LangChain JS — both have lower GitHub footprints than the top four. LangChain is technically the easiest adapter (`loadMcpTools(name, wrappedRawClient)` accepts an injected raw `@modelcontextprotocol/sdk` Client, so `wrapMcpClient` already covers it transparently), so it can be ticked off with a documentation page rather than new code. Mastra's API was 404 in earlier docs research and needs source verification before adapter work.

**Why the prior decision (#28586) reached a different answer:**
- It weighted only on **MCP-specific npm package downloads**, which favored frameworks that ship MCP support in a *separate* installable package (`@ai-sdk/mcp`, `@langchain/mcp-adapters`, `@mastra/mcp`) and disadvantaged frameworks that **bundle** MCP into the parent package (Claude Agent SDK, Cloudflare Agents). Bundling makes the per-package metric invisible but is architecturally a stronger signal — a bundled dependency is non-optional, while a separate package is opt-in.
- The 892-file Cloudflare client signal was missing entirely (quoted query bug returned 0).
- The OpenAI Agents data was missing entirely (auth-blocked and never re-run).
- The Mastra "highest attach ratio" claim (~29% of `@mastra/core` users install `@mastra/mcp`) was true but applied to a smaller absolute base (Mastra core has ~583K/wk vs. Claude Agent SDK at 3.6M/wk and Vercel AI SDK at 10.1M/wk).

**Alternatives considered:**
- **Stay with #28586 (Vercel/Mastra/LangChain).** Rejected: pure-npm-MCP weighting double-penalizes bundlers, and the GitHub data shows ~3x more developers configuring MCP via Claude Agent SDK than via Vercel's separate package. Following the npm ranking would mean shipping adapters for the smaller addressable populations first.
- **Hybrid (Claude SDK + Vercel AI SDK + one more).** Considered. The chosen plan is essentially this hybrid extended to three: it picks the highest GitHub-signal target (Claude SDK), the highest pure-npm target (Vercel AI SDK), and the second-highest GitHub-signal target (Cloudflare Agents) which the prior decision wrongly deferred.
- **Ship OpenAI Agents in the top three.** Rejected for the first cut: 2,768 parent imports is impressive but the custom-transport path means the adapter is structurally different from every other one we'd ship and produces no reusable patterns. Better to validate the proxy-server pattern (Claude + Cloudflare) and the tools-record-wrap pattern (Vercel) first.
- **Defer the re-ranking and ship #28586 anyway because it's already documented.** Rejected per the radical-honesty rule: shipping the wrong adapter set first because it was decided first is exactly the kind of avoidable mistake the rule exists to prevent. The cost of correcting this here is one DECISIONS.md entry; the cost of not correcting it is shipping examples for the wrong frameworks and potentially having to rip them out later.

**What this means architecturally:**
- The §6 work is **not** purely a `packages/agent/` problem. Two of the three top adapters (Claude Agent SDK and Cloudflare Agents) are *server-side proxy* plays that live in `packages/mcp/`. The §6 success criteria need to be expanded accordingly — "framework adapters" was a misleading shorthand.
- The proxy server pattern requires new code: a thin wrapper in `packages/mcp/` that constructs an `McpServer`, calls `atrib()` on it, registers handlers that fan out to one or more upstream MCP servers (via `Client` from `@modelcontextprotocol/sdk`), and propagates results back. This is reusable across both the Claude SDK and Cloudflare adapters and possibly more in the future.
- The Vercel AI SDK adapter is the smallest change: a single function in `packages/agent/` that takes the result of `createMCPClient` and wraps the `tools()` record's `execute` callbacks with the existing interceptor lifecycle.

**Followup:** Build the proxy server primitive, then the Claude Agent SDK adapter on top of it, then the Cloudflare Agents adapter on the same primitive, then the Vercel AI SDK `tools()` wrap. The handoff doc `thoughts/shared/handoffs/general/2026-04-06_01-00-00_internal-planning.md` §6 framework list should be updated to match this decision in a follow-up commit.

## D021 — Claude Agent SDK Case A is zero-new-code; Case B uses createAtribProxy() in-process forwarder

**Date:** 2026-04-06
**Context:** D020 set the the framework-adapter rollout build order as Claude Agent SDK → Cloudflare Agents → Vercel AI SDK and described the Claude Agent SDK adapter as "an in-process proxy MCP server living in `packages/mcp/`". Before writing code, the actual `@anthropic-ai/claude-agent-sdk` source was inspected (npm pack of v0.2.92) to verify how the SDK accepts and invokes user-provided MCP servers. The finding materially refines D020's plan: the Claude Agent SDK adapter splits cleanly into two cases, and the first case requires zero new code in `@atrib/mcp`.

**What the SDK actually does (verified against `@anthropic-ai/claude-agent-sdk@0.2.92`):**

1. The SDK accepts five MCP server config types in its `mcpServers` option: `stdio`, `sse`, `http`, `claudeai-proxy`, and `sdk`. The first three spawn a child or open a network connection externally to the SDK; `claudeai-proxy` is for Claude.ai-hosted servers.
2. The `sdk` type is structurally `{ type: 'sdk', name: string, instance: McpServer }` where `McpServer` is **the exact class from `@modelcontextprotocol/sdk/server/mcp.js`** (verified at `package/sdk.d.ts:7,357,716–720`):
   ```ts
   import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
   export declare function createSdkMcpServer(_options: CreateSdkMcpServerOptions): McpSdkServerConfigWithInstance;
   export declare type McpSdkServerConfigWithInstance = McpSdkServerConfig & { instance: McpServer; };
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

### Case A — User-built in-process tools (the common case for `createSdkMcpServer`)

**Zero new code in `@atrib/mcp`.** The user already has a real `McpServer` (returned as `sdkServer.instance` from `createSdkMcpServer`). They call `atrib(sdkServer.instance, { creatorKey })` exactly as they would for any other `McpServer`. Our existing `setRequestHandler` monkey-patch fires on every `tools/call` because the Claude Agent SDK invokes the standard dispatch path. The "adapter" is a documentation page and a runnable example — no library changes.

```ts
import { createSdkMcpServer, tool, query } from '@anthropic-ai/claude-agent-sdk'
import { atrib } from '@atrib/mcp'

const myTool = tool('my_tool', 'desc', schema, async (args) => { /* … */ })
const sdkServer = createSdkMcpServer({ name: 'my-tools', tools: [myTool] })

atrib(sdkServer.instance, { creatorKey, serverUrl: 'https://my.tools/' })

for await (const msg of query({
  prompt: '…',
  options: { mcpServers: { tools: sdkServer } },
})) { /* … */ }
```

### Case B — Third-party MCP servers (filesystem, fetch, custom stdio servers, etc.)

**New code: `createAtribProxy()`** in `packages/mcp/src/proxy.ts`. The user has an existing upstream MCP server (stdio child process or HTTP endpoint) and wants its tool calls attributed. The proxy is a thin in-process `McpServer` that:

1. Connects to the upstream via `Client` + the appropriate transport (`StdioClientTransport`, `StreamableHTTPClientTransport`).
2. Snapshots the upstream's tool catalog at construction time via `listTools()`.
3. Uses **low-level `setRequestHandler`** registration on its underlying `Server` for both `tools/list` (returns the snapshot) and `tools/call` (forwards to the upstream client). It deliberately bypasses `McpServer.registerTool()` because that API expects Zod-shape input schemas while the upstream returns JSON Schema; converting JSON Schema → Zod is lossy and fragile.
4. Has `atrib()` middleware applied **before** the `tools/call` handler is registered, so the existing `setRequestHandler` patch wraps the forwarding handler with the standard attribution lifecycle.
5. Returns `{ server: AtribServer, upstreamClient: Client, close(): Promise<void> }`. The host owns connecting `proxy.server` to its own transport (the host calls `proxy.server.connect(hostTransport)`); the proxy only owns the upstream client lifecycle.

The user passes the proxy to Claude Agent SDK as `{ type: 'sdk', name, instance: proxy.server }` — same shape as Case A.

**Why the architecture splits this way:**
- For Case A, the user already constructs the `McpServer`, so middleware can be applied directly. Adding a Claude-SDK-specific adapter would be a strict downgrade — more API surface for no benefit.
- For Case B, the upstream `McpServer` lives in another process or network endpoint and the host can't see it. We need an in-process surrogate. The proxy is that surrogate; it exists specifically to pull the call dispatch into a process where our middleware can sit on it.
- The proxy primitive is **reusable for Cloudflare Agents**, which has the same architectural shape (host accepts in-process MCP servers, third-party upstreams need a surrogate). This is why the new code lives in `@atrib/mcp` rather than in a Claude-SDK-specific package.

**Alternatives considered:**
- **A Claude-SDK-specific wrapper helper** like `wrapClaudeAgentSdkMcpServer(sdkConfig)`. Rejected: it would only repackage the one-line `atrib(sdkServer.instance, opts)` call into a less explicit form, hiding the fact that the user already owns a real `McpServer`. Worse, it would create the false impression that Atrib needs Claude-Agent-SDK-aware code — discouraging users from understanding that the same `atrib()` function works against any MCP host.
- **A JSON-Schema → Zod converter** so `createAtribProxy` could use `McpServer.registerTool()`. Rejected: `registerTool` is not the only path to register a `tools/call` handler (the low-level `setRequestHandler` is supported and more honest about what we're doing), the conversion is lossy for JSON Schema features Zod doesn't model cleanly (e.g., `oneOf`, `not`), and it adds a new failure mode for v1 with no real upside.
- **Forwarding upstream tool definitions through `registerTool` with a permissive `z.any()` schema.** Rejected: `z.any()` schemas defeat the entire purpose of the schema validation that the SDK does at registration time; tool inputs would be passed through unchecked. The low-level approach is structurally identical without misleading about validation.
- **Multi-upstream fan-out per proxy.** Rejected for v1 (D020 already locked this in). Each proxy maps 1:1 to an upstream; users with N upstreams create N proxies. Simpler reasoning, no namespace-collision logic, easier failure isolation per upstream.
- **Dynamic tool list refresh.** Deferred to V2. The proxy snapshots `listTools()` once at construction. Restart the proxy if the upstream catalog changes. The upstream-driven `tools/list_changed` notification path can be added later without breaking the public API.

**Files added:**
- `packages/mcp/src/proxy.ts` (~250 lines)
- `packages/mcp/test/proxy.test.ts` — 5 unit tests using `InMemoryTransport.createLinkedPair()` against a real upstream `McpServer`:
  1. `tools/list` is forwarded from the upstream snapshot
  2. `tools/call` forwards arguments and returns the response unchanged
  3. Attribution records are emitted on the proxy side (verified via mocked submission `fetch` and outbound `_meta.atrib` token)
  4. §5.8 degradation: upstream `isError: true` results propagate without record emission (per §5.3.3)
  5. `close()` disconnects the upstream client cleanly

**Files modified:**
- `packages/mcp/src/index.ts` — exports `createAtribProxy`, `AtribProxy`, `AtribProxyOptions`, `UpstreamTransport`

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
- The MCP SDK's `SSEClientTransport` is marked `@deprecated` as of `@modelcontextprotocol/sdk@1.29.0` in favor of Streamable HTTP. We do **not** add a `type: 'sse'` upstream option to avoid baking a deprecated transport into our public API. Users with a legacy SSE upstream construct their own `SSEClientTransport` and pass it via `{ type: 'inMemory', transport: theirSseTransport }` — that path works and isolates the deprecation concern in user code rather than our package API.
- The `StreamableHTTPClientTransport` returned by `createUpstreamTransport` requires a structural cast through `unknown` because its `sessionId?: string` getter is structurally incompatible with the `Transport` interface's `sessionId?: string` declaration under `exactOptionalPropertyTypes: true` (the getter returns `string | undefined`, the interface expects `string` when present). Runtime conformance is guaranteed by `implements Transport` on the SDK's class declaration.

**Followup:** Build the runnable Claude Agent SDK example (Case A and Case B side-by-side), update `README.md` with a "Use with Claude Agent SDK" section pointing at the example, then start the Cloudflare Agents adapter on the same `createAtribProxy` primitive. The handoff doc §6 framework list still needs to be synced to D020/D021 in a follow-up commit.
