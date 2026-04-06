# Atrib, Decision Log

Architectural and design decisions made during the Atrib protocol development. Each entry records what was decided, why, and what alternatives were considered.

---

## D001, Agent-first sequencing, not browser-first

**Date:** 2026-04-05
**Context:** The protocol needed a go-to-market wedge. Browser/OS adoption requires convincing Google/Apple. Prior attempts (Brave, Coil, Flattr) failed by targeting human browsing.
**Decision:** Build for agent-to-agent transactions first. Agents don't have UX preferences, the volume is growing exponentially, and the protocol can be API-native from day one. Extend to human-facing content later.
**Alternatives considered:** Browser extension, browser fork, OS-level integration.

## D002, Attribution layer, not payment layer

**Date:** 2026-04-05
**Context:** Agent-to-agent payments are a crowded space (Stripe, PayPal, Visa, x402, MPP, ACP, UCP). Competing on payment rails is a losing position.
**Decision:** Atrib is payment-rail agnostic. It sits above all payment protocols and answers "who should get paid and why", not "how does money move." Settlement uses whatever rail the merchant already has.
**Alternatives considered:** Building a payment rail, integrating with a single rail (Stripe), issuing a token.

## D003, Ed25519, not DIDs or PKI

**Date:** 2026-04-05
**Context:** Creator identity needs to be cryptographically verifiable. DIDs add complexity and dependency on DID resolution infrastructure. PKI requires certificate authorities.
**Decision:** Raw Ed25519 keypairs. Simple, fast, no external dependencies. 32-byte seed, deterministic public key derivation. Key rotation deferred to v2.
**Alternatives considered:** DIDs (too complex for v1), X.509 certificates (requires PKI), starting unsigned and adding signing later (insufficient trust).

## D004, OTel trace-id as context_id, not a custom identifier

**Date:** 2026-04-05
**Context:** Attribution records need a session identifier to form chains. Could generate a custom ID or reuse existing infrastructure.
**Decision:** context_id IS the W3C Trace Context trace-id from OTel. Not derived from it, the same value. This means Atrib chains are automatically correlated with existing observability traces.
**Alternatives considered:** Custom Atrib session ID (duplicates existing infrastructure), hash of trace-id (prevents correlation).

## D005, Structure not causality in the graph

**Date:** 2026-04-05
**Context:** The natural instinct is to encode causal relationships ("tool A influenced tool B which caused purchase"). But causality is an inference, not a verifiable fact.
**Decision:** The graph records observable structure only, chain linkage, shared session, timestamps. Causal interpretation belongs to the policy layer. Five edge types, all derived deterministically from record structure. No edge encodes a causal claim.
**Alternatives considered:** Explicit influence/transact action types (early design, rejected because it smuggled causal claims into the record), semantic analysis of tool names (rejected, not verifiable).

## D006, Merkle log (C2SP tlog-tiles), not blockchain

**Date:** 2026-04-05
**Context:** Attribution records need global verifiability. Blockchain provides this but carries cultural and economic baggage (tokens, gas costs, crypto association).
**Decision:** Certificate Transparency-style append-only Merkle log using the C2SP tlog-tiles ecosystem. Same cryptographic guarantees as a blockchain for append-only verification, without tokens, gas, or crypto association. Tessera-based implementation.
**Alternatives considered:** Ethereum/Base (gas costs, crypto baggage), Sigstore Rekor (repurposing a software supply chain tool), blockchain with anchoring (complexity).

## D007, Log stores commitments, not content

**Date:** 2026-04-05
**Context:** The log needs to prove records exist without revealing what they contain. This is the "observability without surveillance" principle.
**Decision:** Log entries are 90-byte fixed structs containing: record_hash, creator_key, context_id, timestamp, event_type. No tool call content, no response data, no user identity, no transaction amounts.
**Alternatives considered:** Storing full records (privacy-hostile), storing encrypted records (key management complexity), storing nothing (no verifiability).

## D008, Middleware pattern, not method calls

**Date:** 2026-04-05
**Context:** Nader's core requirement: "it has to be literally automated." Developer adoption fails the moment someone has to decide when to call an attribution method.
**Decision:** The SDK is a middleware wrapper with one init call and zero ongoing surface area. `atrib(server, { creatorKey })`, everything else is automatic. No methods to call after init. No configuration for when to emit.
**Alternatives considered:** Explicit API methods (requires developer judgment), event hooks (requires configuration), decorator pattern (framework-specific).

## D009, Fact/policy separation as an architectural boundary

**Date:** 2026-04-05
**Context:** For attribution to be trusted by both creators and merchants, each must be able to independently verify: (1) the graph accurately reflects what happened, and (2) the settlement was correctly calculated. Mixing fact and policy into one layer makes independent verification intractable.
**Decision:** The graph (§3) is a strict fact layer. The policy (§4) is a separate evaluation layer. Graph endpoints never return weighted data. The calculation algorithm is a pure function of graph + policy. Any party can verify independently.
**Alternatives considered:** Combined graph+policy API (simpler but unverifiable), policy enforcement in the protocol (makes Atrib an arbiter).

## D010, Default policy: equal weight, zero for unsigned

**Date:** 2026-04-05
**Context:** The protocol needs a sensible default when no policies are published. The default must be uncontroversial and make no value judgments.
**Decision:** Equal weight (1.0) for all five edge types on signed nodes. Zero weight for unsigned gap nodes. No modifiers, no floors, no caps. The least opinionated possible baseline.
**Alternatives considered:** Weighted by edge type (already a value judgment), equal including unsigned (rewards non-participation), no default (cold-start problem).

## D011, Dual transaction emission paths with anti-double-emission

**Date:** 2026-04-05
**Context:** Transaction records can be emitted by the merchant (if they have @atrib/mcp) or by the agent (if the merchant doesn't). Both paths must exist for cold-start adoption, but only one can fire per transaction.
**Decision:** Path 1 (merchant) is preferred. Path 2 (agent) is fallback. The agent detects Path 1 by checking if the checkout response contains an attribution token. If present, Path 2 is suppressed. This prevents duplicate transaction nodes.
**Alternatives considered:** Merchant-only (blocks adoption before merchant integration), agent-only (merchant key not on transaction), deduplication in the log (adds state to a stateless append-only system).

## D012, Open spec, commercial product (Stripe model)

**Date:** 2026-04-05
**Context:** For the protocol to be trusted as infrastructure, it must be open. For the company to be sustainable, something must be commercial.
**Decision:** The spec, signing libraries, and log infrastructure are open and free. The queryable attribution graph (`graph.atrib.io`), analytics dashboard, and settlement resolution API (`resolve.atrib.io`) are commercial products. This follows the Stripe model: open standards, best implementation.
**Alternatives considered:** Fully open with donations (Wikipedia model, chronically underfunded), fully closed (no trust, no adoption), token-funded (crypto baggage).

## D013, "Observability without surveillance" is delivered across three layers, not one

**Date:** 2026-04-05
**Context:** During the implementation, we examined whether the core primitives alone deliver the spec's central privacy claim ("observability without surveillance", §0). The answer is that the claim requires three layers working together, and it's important to track which layers are built and which aren't.
**Decision:** The privacy architecture is:

- **Layer 1 (record format):** The `AtribRecord` type captures structural metadata only, no tool call arguments, no response content, no user queries, no transaction amounts. Content never enters the hashing pipeline. This is implemented in .
- **Layer 2 (log commitments):** The Merkle log stores 90-byte entries (record_hash, creator_key, context_id, timestamp, event_type), commitments, not records. Full records stay with the parties. This is implemented via log submission in .
- **Layer 3 (middleware discipline):** The degradation contract (§5.8) ensures errors, retries, and failure modes don't leak content through logs or error messages. Proof bundles serve inclusion proofs, not records. This is implemented in .

All three layers are necessary. Layer 1 alone is necessary but not sufficient.

**Known tension:** `content_id = sha256(serverUrl + ":" + toolName)` reveals *which tool at which server* was called. The spec treats this as acceptable structural metadata (tool existence is public via MCP `tools/list`, same information exists in OTel spans), but it is the closest the protocol gets to the surveillance line. A future revision could explore blinded content_ids if this proves problematic.
**Alternatives considered:** Salting/blinding content_ids (would break independent reproducibility required by §4.6), encrypting log entries (adds key management complexity, deferred).

## D014, Cross-package integration tests live in a private workspace package and re-derive primitives

**Date:** 2026-04-06
**Context:** The end-to-end test plan calls for an end-to-end test exercising the full attribution flow across all three SDK packages. The question was where this test should live and what it should import. Two options: (a) put it inside an existing package (e.g., `@atrib/verify/test/integration.test.ts`), reusing existing imports; (b) create a separate private workspace package that depends on all three SDK packages and re-derives shared primitives independently.
**Decision:** Created `@atrib/integration` as a private workspace package (`"private": true`, no `dist/`, only test runner). It depends on `@atrib/mcp`, `@atrib/agent`, and `@atrib/verify` as peers. Critically, its `graph-builder.ts` re-implements `recordHash()` from primitives (`sha256(canonicalRecord(...))`) rather than importing a hash function from `@atrib/mcp`. This mirrors what a real graph indexing service (`graph.atrib.io`) would do, index records arriving from arbitrary creators across the open log, without depending on the SDK that produced them.
**Why this matters:** The §4.6 calculation algorithm's correctness rests on the claim that "any party with the same inputs gets the same result." If integration tests reused the SDK's hash function, two implementations could silently agree because they share code. By re-deriving in the test, we validate that JCS canonicalization + SHA-256 produce identical output across two independent code paths. The end-to-end test passing demonstrates that the chain reconstructs (`A → B → tx`) precisely because `chain_root` references match record hashes derived independently.
**Alternatives considered:** Test inside `@atrib/verify` (would hide the boundary), test at the repo root (no package isolation), publish `@atrib/integration` as a public package (no value to consumers, only to the project).

## D015, ACP and UCP detect on a unified completion shape, distinguished by the `ucp` envelope

**Date:** 2026-04-06
**Context:** cross-spec verification, the v1 SDK shipped with synthetic ACP/UCP detection rules (`response.data.object.object === 'checkout_session'`, `type === 'order.created'`, `event_type === 'ORDER_CREATED'`) that came from imagined Stripe-event-envelope shapes. We never cross-checked them against the real ACP and UCP specs. When we did the verification (via the `/agentic-commerce-protocol/agentic-commerce-protocol` and `/universal-commerce-protocol/ucp` repos), it turned out that (a) neither protocol uses any of those shapes, (b) ACP and UCP have converged on essentially the same checkout completion response, and (c) the `TransactionDetection.protocol` literal `'ACP/UCP'` was hiding a distinction that consumers actually care about.
**Decision:**
- Detection signal for both protocols is `status === 'completed'` AND `order.id` is a string. Webhook events `order_create` / `order_update` (snake_case, NOT `order.created`) are also accepted as ACP transaction events.
- UCP is distinguished from ACP by the presence of a top-level `ucp.version` envelope on the completion response.
- Split the protocol literal type into `'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'heuristic'` so consumers can switch on the actual protocol. The middleware's `emitTransactionRecord` switch was updated correspondingly.
- Real captured fixtures from the published spec examples live under `packages/agent/test/fixtures/{acp,ucp}/`, with provenance README files citing the source URL and verification date.
- Spec §1.7.1 and §1.7.2 were rewritten to match real ACP/UCP shapes. The §5.4.5 detection pseudocode was updated to match.
- Because neither ACP nor UCP currently exposes a documented free-form metadata field on `POST /checkout_sessions/...` requests, the spec now requires `context_id` to travel via the `X-Atrib-Context` HTTP header (consistent with x402/MPP) and via `params._meta.atrib` for MCP-transport integrations. The earlier spec language describing `metadata.atrib_context_id` and `extensions["io.atrib/context_id"]` was speculative and has been removed.
**Alternatives considered:** Keeping the joint `'ACP/UCP'` literal (loses information consumers want), making detection lenient with multiple synonymous keys (false positives), waiting for ACP/UCP to add metadata fields before fixing the spec (blocks the SDK indefinitely on upstream protocol decisions).
**Followup work:** §2 (x402/MPP) and §3 (AP2) verification, pending in the same internal planning doc. The MPP-vs-x402 distinction in the new code uses an optional `Payment-Protocol` response header marker; this is an Atrib convention because both protocols share the same `Payment-Receipt` header on the response side and we need a way to distinguish them when both might be in use. If a future revision of x402 or MPP standardizes a different distinguisher, update this rule.

**Update (2026-04-06, same day):** D016 supersedes the "shared `Payment-Receipt` header" assumption above. Verification against the actual specs revealed that x402 and MPP use **different** response headers and there is no need for an Atrib-invented `Payment-Protocol` marker.

## D016, x402 and MPP detect on different headers, not a shared one

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
- Detection uses **header presence** as the on-wire signal. Decoding the base64 body to validate `success: true` (x402) or `status: "success"` (MPP) is not done in v1, the spec language for both protocols treats the header as the authoritative signal, and the degradation contract (§5.8) means false positives from a misconfigured server are preferable to false negatives caused by overly strict shape matching. Higher-fidelity downstream tooling that needs to extract the transaction hash for content_id derivation can decode the body itself.

**Alternatives considered:**
- Decoding the header value and validating `success: true` / `status: "success"` (rejected, tightens detection at the cost of robustness; the degradation contract favors silent passes over silent fails)
- Treating `Payment-Receipt` as a synonym for `PAYMENT-RESPONSE` (rejected, they are different protocols with different wire formats and tooling, and the SDK consumer needs to know which one fired)
- Adding a single combined `'x402-or-mpp'` literal back to the protocol type (rejected for the same reason as the joint `'ACP/UCP'` literal in D015, it hides information consumers care about)

**Followup:** §3 (AP2 / W3C VC) verification, then §4 (W3C Trace Context conformance) and §5 (MCP SDK extension API) per the internal planning doc.
