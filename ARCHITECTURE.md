# atrib architecture

How the protocol works, what the trust model actually guarantees, and why the design is the way it is. If you want the pitch, read the [README](README.md). If you want every normative detail, read the [spec](atrib-spec.md). This is the middle layer: enough to evaluate whether atrib is worth building on.

Architectural decisions and rejected alternatives are logged in [DECISIONS.md](DECISIONS.md).

---

## System overview

Three protocol layers, one SDK layer that automates them. Data flows in one direction: tool call happens, record gets signed, record gets committed to the log, graph gets built, policy gets applied, settlement recommendation comes out.

```
                          ┌──────────────────────────────────────────┐
                          │           Agent Session                  │
                          │                                          │
                          │  tool_call → tool_call → ... → purchase  │
                          └────────────┬───────────────────┬─────────┘
                                       │                   │
                           signed records              transaction
                           (Ed25519 + JCS)             detection
                                       │                   │
                                       ▼                   ▼
                ┌─────────────────────────────────────────────────────┐
                │  Layer 1: Record Signing (§1)                       │
                │                                                     │
                │  AtribRecord → JCS canonicalize → Ed25519 sign      │
                │  → propagate via tracestate / _meta.atrib           │
                └────────────────────────┬────────────────────────────┘
                                         │
                              90-byte commitment
                              (hash, key, ctx, ts, type)
                                         │
                                         ▼
                ┌─────────────────────────────────────────────────────┐
                │  Layer 2: Transparency Log (§2)                     │
                │                                                     │
                │  Append-only Merkle tree (C2SP tlog-tiles / Tessera)│
                │  → inclusion proof returned to submitter            │
                │  → checkpoints signed by log operator               │
                │  → witnesses cosign for cross-operator trust        │
                └────────────────────────┬────────────────────────────┘
                                         │
                              committed records
                              with inclusion proofs
                                         │
                                         ▼
                ┌─────────────────────────────────────────────────────┐
                │  Layer 3: Attribution Graph (§3)                     │
                │                                                     │
                │  9 edge types, deterministic derivation              │
                │  Structure + agent-claimed causation, no inferred    │
                └────────────────────────┬────────────────────────────┘
                                         │
                              graph + policy
                                         │
                                         ▼
                ┌─────────────────────────────────────────────────────┐
                │  Policy & Settlement (§4)                           │
                │                                                     │
                │  Pure function: graph + policy = distribution        │
                │  Any party can run locally and verify independently │
                └─────────────────────────────────────────────────────┘
```

### Layer 1: Record signing (Section 1)

Every tool call produces a signed attribution record. The record is a JSON object with eight fields: `spec_version`, `content_id`, `creator_key`, `chain_root`, `event_type`, `context_id`, `timestamp`, and `signature` (plus an optional `session_token` for cross-trace sessions). See Section 1.2 for the full schema.

The signing procedure:

1. Construct the record without the `signature` field.
2. Canonicalize via JCS (RFC 8785) -- deterministic JSON serialization with lexicographic key ordering and no whitespace.
3. Sign the canonical bytes with Ed25519 using the creator's 32-byte seed.
4. Encode the signature as base64url and set the `signature` field.

Records chain together: each non-genesis record sets its `chain_root` to the SHA-256 hash of the previous record's canonical form. Genesis records use `SHA-256(UTF-8(context_id))` as their `chain_root`. This creates a hash chain within each creator's contribution to a session.

Context propagates via W3C `tracestate` headers (HTTP) or MCP `params._meta.atrib` (MCP transport). The token format is `base64url(sha256(jcs(signed_record))) + "." + base64url(creator_key_bytes)` -- 87 characters max, fits the W3C tracestate value limit. See Section 1.5.

### Layer 2: Transparency log (Section 2)

The log is a public, append-only Merkle tree following the [C2SP tlog-tiles](https://c2sp.org/tlog-tiles) specification. It stores commitments, not content. Each log entry is a fixed 90-byte binary struct:

```
struct AtribLogEntry {
  u8  version;         // 0x01
  u8  record_hash[32]; // SHA-256 of JCS-canonical signed record
  u8  creator_key[32]; // raw Ed25519 public key
  u8  context_id[16];  // raw bytes from 32-char hex context_id
  u64 timestamp_ms;    // big-endian Unix milliseconds
  u8  event_type;      // 0x01 tool_call, 0x02 transaction, 0x03 observation, 0x04 directory_anchor (D056), 0xFF extension URI
}
// Total: 90 bytes
```

The log proves that a signed record existed at a specific position in the tree. It does not reveal what the record contained. A third party can verify inclusion without reading the content. The full record stays with the creator.

The reference implementation uses [Tessera](https://github.com/transparency-dev/tessera) (maintained by Google's transparency team). Any operator can run a compatible log -- the spec defines the wire format, not the implementation.

### Layer 3: Attribution graph (Section 3)

The graph is a directed property multigraph with eight node types (`tool_call`, `transaction`, `observation`, `annotation`, `revision`, `directory_anchor`, `extension`, `gap_node`) and nine edge types, all derived deterministically from record structure:

| Edge type          | Direction | Derivation                                                                                                                                                                                                                                                                                           |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAIN_PRECEDES`   | A -> B    | B's `chain_root` = SHA-256(JCS(A)). Explicit hash chain link.                                                                                                                                                                                                                                        |
| `SESSION_PRECEDES` | A -> B    | Same `context_id`, no chain link, A's timestamp < B's timestamp.                                                                                                                                                                                                                                     |
| `SESSION_PARALLEL` | A <-> B   | Same `context_id`, no chain link, no temporal ordering.                                                                                                                                                                                                                                              |
| `CONVERGES_ON`     | N -> T    | N is a tool_call or gap_node, T is the transaction node, same session. observation and extension nodes do NOT participate ([D042](DECISIONS.md#d042-lift-observation-graph-participation-restriction), [D043](DECISIONS.md#d043-extension-uri-participation-in-graph-derivation)).                   |
| `CROSS_SESSION`    | A -> T    | Different `context_id`, same explicit `session_token`. Same logical session across traces. Never inferred.                                                                                                                                                                                           |
| `INFORMED_BY`      | A -> B    | A's `informed_by` array contains the record_hash of B. Agent-declared reasoning context ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)). Intra- or cross-session. Source/target may be any node type.                                                            |
| `PROVENANCE_OF`    | D -> U    | D and U both carry the same `provenance_token` value, different `context_ids`, U is the token's source record. Cross-session causal anchoring ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)).                                                                 |
| `ANNOTATES`        | A -> R    | A is an annotation record (event_type=annotation, byte 0x05) with `annotates: sha256:<R-hash>`. Forward-pointing commentary on a prior record ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)).                                                                |
| `REVISES`          | V -> P    | V is a revision record (event_type=revision, byte 0x06) with `revises: sha256:<P-hash>`. Supersedure of a prior stance, predecessor stays immutable on the log; consumers choose whether to honor the revision ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)). |

The derivation rules are normative (Section 3.2.4). Two implementations processing identical records must produce identical edge sets. This is what makes independent verification possible: you do not need to trust the graph service, because you can rebuild the graph yourself and check.

Gap nodes represent unsigned hops, tool calls evidenced by OTel spans but lacking a signed attribution record. They make the absence of attribution visible rather than hiding it. Gap nodes participate in temporal and convergence edges but not chain or cross-session edges.

`INFORMED_BY` and `PROVENANCE_OF` are agent-declared causal anchors (the agent's claim, structurally derived from declared fields). atrib certifies the claim was signed; it does not certify the truthfulness of the claim. This preserves the [§3.1](atrib-spec.md#31-design-principles-and-rationale) invariant (the graph records structure, not inferred causality) while letting consumers express the reasoning chains the brand promise of "verifiable agent actions in proper context" requires.

### Derived evidence products

Some useful agent experiences are built from the graph, but are not part of the
graph itself. Examples include prior-work packets, root-cause suspect reports,
macro-eval summaries, support/RCA continuation packets, and task-start evidence
briefs.

These products can rank records, reject stale or wrong-signer evidence, require
body commitments, fetch inclusion proofs, and assign labels such as severity,
owner candidate, or promotion decision. They should sign their conclusions when
a future agent or auditor needs to replay the analysis. They should not add
semantic edge types or weights to the base graph.

The boundary is practical: record validity, deterministic edge derivation, and
verifier behavior belong in the protocol. Task-specific usefulness belongs in an
analyzer, harness, or product layer over signed records.

---

## Trust model

The goal is simple: every claim the protocol makes should be independently verifiable. Here is what actually is, and what isn't:

**Verifiable by anyone:**

Record signatures: each record is Ed25519 signed. The public key is embedded in the record itself, so anyone can verify. No certificate authority, no PKI.

Log inclusion: the Merkle log returns RFC 6962 inclusion proofs. A hash path from the leaf to the root. Pure math. If you have the checkpoint, you can verify that a record was committed at a specific index.

Log consistency: consecutive checkpoints can be verified for consistency. This proves the log only grew and nothing was modified or deleted between checkpoints. Same mechanism Certificate Transparency uses.

Graph edges: all nine edge types are deterministically derived from record fields. Given the same records, any implementation following Section 3.2.4 must produce the same graph. You can verify by rebuilding it yourself.

Settlement calculation: the algorithm (Section 4.6) is a pure function. Graph + policy in, distribution out. No network calls, no randomness. Any party with the same inputs gets the same answer. `@atrib/verify` exists so merchants can run this locally and check.

**Trusted (but auditable):**

The log operator's append-only behavior. The operator could theoretically refuse entries (censorship) or show different views to different parties (equivocation). Both are detectable: censorship is obvious to the submitter (no inclusion proof comes back), and equivocation is caught by consistency proofs and the witnessing protocol (Section 2.9). The trust assumption is that the operator doesn't equivocate, and the audit mechanism makes equivocation a bad bet.

**Not trusted at all:**

atrib. The protocol is an open spec. The signing libraries are open source. The log format is a public standard. The calculation algorithm is published and locally executable. Nobody, including the team that wrote the spec, has privileged access or override capability.

---

## Why Certificate Transparency, not blockchain

People always ask this. CT Merkle logs give you the same cryptographic guarantees (append-only, tamper-evident, publicly auditable) without tokens, gas fees, block times, or the cultural baggage of crypto.

Here is why, specifically:

**Same math.** Both CT logs and blockchains use Merkle trees to provide tamper evidence. An entry committed to either structure cannot be altered without invalidating the root hash. Both support inclusion proofs (proving a specific entry exists) and consistency proofs (proving the tree only grew, never mutated).

**Different economics.** A blockchain requires a consensus mechanism (proof-of-work or proof-of-stake) to determine who appends the next block. That consensus mechanism requires an incentive token, which requires a token economy. CT logs have a simpler trust model: a single operator appends entries, and anyone can audit the operator's behavior via consistency proofs and witnessing. The trust assumption is weaker (you trust one operator not to equivocate, rather than trusting a majority of stake), but equivocation is detectable and the operator is publicly identified -- the same trust model that secures the web's TLS certificate ecosystem.

**Different performance.** CT log submission is an HTTP POST that returns an inclusion proof. There is no block time, no gas auction, no mempool. Latency is bounded by network round-trip time, not by consensus finality.

**Different packaging.** No tokens to list, no wallets to integrate, no securities lawyers to retain. Tessera (the implementation) is maintained by Google's transparency team and runs in production for Certificate Transparency, Go module checksums, and Sigstore. Boring infrastructure. That's the point.

The decision is documented in [D006](DECISIONS.md#d006-merkle-log-c2sp-tlog-tiles-not-blockchain).

---

## Payment protocol integration

atrib detects transaction events from six agent commerce protocols simultaneously:

| Protocol                | Detection signal                                          | Source                       |
| ----------------------- | --------------------------------------------------------- | ---------------------------- |
| ACP (Stripe/OpenAI)     | `status === "completed"` + embedded `order`               | Checkout completion response |
| UCP                     | Same as ACP + top-level `ucp.version` envelope            | Checkout completion response |
| x402 (Coinbase)         | `PAYMENT-RESPONSE` HTTP header                            | Tool call response headers   |
| MPP (Tempo Labs/Stripe) | `Payment-Receipt` HTTP header                             | Tool call response headers   |
| AP2 (Google)            | Successful CheckoutReceipt or PaymentReceipt              | A2A task or tool response    |
| a2a-x402 (Google)       | `metadata["x402.payment.status"] === "payment-completed"` | A2A task metadata            |

The design principle: detect, don't implement. atrib pattern-matches on tool call responses to identify when a transaction occurred. It doesn't initiate payments, move money, hold funds, or enforce settlement. The detection logic for all six protocols is in `@atrib/agent`'s `transaction.ts` and runs simultaneously. You don't choose a payment protocol at install time.

AP2 has a second verifier-side surface. `@atrib/agent` treats successful CheckoutReceipt or PaymentReceipt as the transaction close signal. `@atrib/verify` can then inspect AP2 / Verifiable Intent evidence after detection: signed receipt JWTs, receipt references, VI SD-JWT signatures, `sd_hash` links, disclosure digests, delegated agent keys, and checkout/payment hash binding. That keeps authorization checks out of the detector while still giving merchants dispute-grade evidence.

Why this matters:

Protocol agnosticism. atrib works regardless of which payment rail the merchant uses. If a seventh protocol shows up tomorrow, adding detection is a pattern-matching rule, not a protocol change.

Separation of concerns. Attribution and payment are orthogonal problems. Attribution answers "who contributed to this outcome?" Payment answers "how does money move?" Coupling them would mean each one's adoption depends on the other's.

When a transaction is detected, the agent emits a `transaction` record (event_type `"transaction"`) with the same `context_id` as the session. This closes the attribution loop -- the graph now has a terminal node that all contributing tool calls converge on. See Section 1.7 for the detection rules for each protocol.

There are two emission paths for transaction records (Section 5.4.5, [D011](DECISIONS.md#d011-dual-transaction-emission-paths-with-anti-double-emission)). Path 1: the merchant has `@atrib/mcp` installed and emits the transaction record directly. Path 2: the merchant does not have atrib, so the agent detects the transaction from the response and emits it. Anti-double-emission logic prevents both from firing: the agent checks whether the response already contains an attribution token, and suppresses Path 2 if it does.

---

## Runtime integration patterns

atrib categorizes runtime integration into seven peer patterns ([D069](DECISIONS.md#d069-runtime-integration-patterns--first-class-peers-no-canonical-path), [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox), [§9](atrib-spec.md#9-runtime-integration-patterns)). None is canonical. A runtime builder picks the pattern its ergonomics support; multiple patterns can compose for one runtime.

| Pattern                                   | Where it fits                                                                                                                                                                           | Reference implementation                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lifecycle hooks                        | Runtimes that expose typed hook events with stdin-JSON IPC (Claude Code, Cursor, Codex CLI, Browser-Use, Augment Code, Pi/Earendil)                                                     | hook helper spawning `atrib-emit-cli` ([D082](DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape)); the CLI calls `emitInProcess` ([D081](DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)) over a stdin/stdout JSON contract |
| 2. In-process MCP middleware              | Runtimes that call tools through MCP servers (Goose, Continue, Cody, Claude Code MCP-served tools, opencode)                                                                            | [`@atrib/mcp-wrap`](packages/mcp-wrap/), required for transaction records ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) and `preCallTransform` ([D057](DECISIONS.md#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding))             |
| 3. Callback / lifecycle handlers          | Multi-agent SDKs with native callback APIs (LangGraph, CrewAI, AutoGen, Microsoft Agent Framework, Anthropic Agent SDK, smolagents, OpenAI Agents SDK, Vercel AI SDK, Flue, Google ADK) | [`@atrib/agent`](packages/agent/) framework adapters                                                                                                                                                                                                                                              |
| 4. OpenInference SpanProcessor            | OpenInference-instrumented runtimes across Python, JavaScript, Java, and Go package surfaces                                                                                            | [`@atrib/openinference`](packages/openinference/README.md)                                                                                                                                                                                                                                        |
| 5. Post-hoc API import + consumer re-sign | Closed-loop runtimes that own the trace (Cursor Cloud Agents recommended first reference; also Devin, Manus, Operator, Bolt/v0/Lovable)                                                 | per-runtime adapters (planned)                                                                                                                                                                                                                                                                    |
| 6. Streaming interceptor                  | Real-time bidirectional protocols (OpenAI Realtime API, voice/multimodal harnesses)                                                                                                     | not yet built                                                                                                                                                                                                                                                                                     |
| 7. Sandboxed-execution signer proxy       | Runtimes that run agent code in a sandbox while a host signer process stays outside the sandbox                                                                                         | [`packages/integration/examples/signer-proxy/`](packages/integration/examples/signer-proxy/)                                                                                                                                                                                                      |

Patterns 1–4 ship reference implementations in atrib v1. Pattern 7 ships a tested reference example for the key-isolation boundary. Patterns 5–6 are documented with their conformance contract scope; reference implementations land per priority sequencing.

### Observability Boundary

OpenTelemetry and OpenInference span trees are intake and correlation surfaces. They are not the canonical evidence shape. `@atrib/openinference` consumes the same runtime spans that Langfuse or Phoenix can ingest, then emits signed `AtribRecord` bytes plus a local sidecar. The public log receives only the signed record commitment. The local mirror receives span payload fields such as trace id, span id, model name, prompt version, input/output snippets, usage, cost, score, and metadata.

This keeps the product boundary clean. Langfuse-style systems remain the right place for trace inspection, latency, cost, prompt-management workflows, and eval dashboards. atrib uses the span tree to produce verifier-grade signed records and local cognitive payload. Recall, trace, and summarize read that payload from `_local.content`; verifier-grade replay uses `args_hash`, `result_hash`, local mirror bodies, or archive bodies when a consumer needs proof of specific bytes.

`informed_by` is narrower than OTel parent-child nesting. Parent-child span structure says the runtime correlated two spans inside one trace. It does not prove that a later signed action depended on the earlier signed action's output. atrib only emits `informed_by` when an explicit rule can run before signing, such as the current LLM `tool_call.id` to matching TOOL `tool_call.id` rule.

### Cross-harness investigation continuity

Runtime mounting is only half the problem. Real support and RCA work often crosses a support system, a log store, a hosted agent, a chat thread, and a local coding harness. The public Merkle log proves that each signed record existed, but it does not carry the private bodies and evidence a later harness needs to continue the task.

The continuation shape is documented in spec [§7.8](atrib-spec.md#78-cross-harness-continuation-packets). A handoff that wants a local agent to resume without guessing needs record bodies or archive references, redacted ticket and log evidence, skill pack names and hashes, the latest chain tail, provenance anchors, and signed diagnostics for hosted-agent failures. This keeps atrib in the substrate role: Axiom-style wide logs keep tenant context and request/response evidence, support systems keep customer context and thread state, and atrib proves how the agent moved through both.

The receiving side of a Pattern 3 handoff is now a verifier concern, not a graph concern. `@atrib/verify` exposes `verifyHandoffClaims()` and `handoffClaimsFromEvidencePacket()` so Agent B can accept or reject Agent A's `record_hash` claim before acting. It checks the supplied signed record, private body commitment, inclusion proof, checkpoint signature when the log key is known, trusted signer set, allowed context set, and freshness bound, then returns `accepted_record_hashes` for Agent B's `informed_by`. [D105](DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) added the extension-first verifier path. [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7) promotes the agent-facing wrapper as `@atrib/verify-mcp` after two independent receiving flows made verify-before-linking routine.

### Why each adapter is different

Every MCP framework has a different integration surface. The Claude Agent SDK exposes an `McpServer` instance you can wrap directly. Cloudflare Agents has an `McpAgent` class with lifecycle hooks. Vercel AI SDK's `@ai-sdk/mcp` ships its own JSON-RPC implementation that is structurally incompatible with the standard `@modelcontextprotocol/sdk` Client. LangChain's `MultiServerMCPClient` wraps multiple connections and needs a different hook point.

The project established a "source-read-first" principle early ([D018](DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)): before writing an adapter, read the host framework's source code to find the correct integration point. All six shipped Pattern #3 adapters were built this way, and every one had a different correct answer. The adapter helper signature varies because the host framework's surface varies -- that variation is forced by the host, not invented by atrib.

### Shipped adapters

| Framework                       | Adapter                         | Integration point                        |
| ------------------------------- | ------------------------------- | ---------------------------------------- |
| Raw `@modelcontextprotocol/sdk` | `wrapMcpClient()`               | Wraps the SDK's `Client` instance        |
| Claude Agent SDK (Case A)       | Direct `atrib()` wrap           | Wraps the SDK's `McpServer` directly     |
| Claude Agent SDK (Case B)       | `createAtribProxy()`            | stdio/SSE proxy for third-party servers  |
| Cloudflare Agents               | `attributeCloudflareAgentMcp()` | Hooks `McpAgent` and `Agent` classes     |
| Vercel AI SDK                   | `attributeVercelAiSdkMcp()`     | Wraps `createMCPClient` return value     |
| LangChain JS                    | `attributeLangchainMcp()`       | Wraps `MultiServerMCPClient` connections |

Framework dependencies are never hard imports of `@atrib/agent`. Adapters use structural typing against the host framework's public shape, so users only pay the dependency cost of frameworks they actually use.

Each adapter ships with: source at `packages/agent/src/adapters/`, tests at `packages/agent/test/`, a runnable example at `packages/integration/examples/`, and a decision log entry in DECISIONS.md. See the [adapter README](packages/agent/README.md) for quick-start snippets.

---

## Protocol adapters

Framework adapters hook atrib INTO a host agent framework at runtime. **Protocol adapters** are the parallel pattern: they provide observability FOR a specific payment protocol's ecosystem. See [D027](DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) for the full rationale.

A protocol adapter has three canonical layers:

1. **Registry**: a versioned source of truth for the protocol's on-chain actors (facilitators, relayers, merchants). Combines the protocol's canonical registry if one exists, facilitator self-declaration endpoints (e.g., x402's `/supported`), and an overlay for absent or undisclosed entries.
2. **Scanner**: ecosystem-level aggregators that measure volume and activity. Methodology is protocol-specific (wallet-first, contract-first, event-pattern), but every adapter outputs `sender → {tx_count, value}` or equivalent.
3. **Attribution**: maps scanned observations to the registry, surfacing an unattributed residual for forensic follow-up. Techniques are protocol-specific: witness calldata decoding (where binding exists), sender-pattern clustering, payTo correlation.

Two observation surfaces exist per protocol and compose cleanly:

| Surface       | Where                                               | What it observes                                                              |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Runtime       | `@atrib/agent` + framework adapter                  | Payment events during a single agent session                                  |
| Retrospective | Protocol adapter (scanner + registry + attribution) | All protocol activity across the ecosystem, independent of any single session |

A complete per-protocol artifact demonstrates both paths: **Path A** (retrospective scanner + attribution, exercising [§3](atrib-spec.md#3-graph-query-interface) graph and [§4](atrib-spec.md#4-attribution-policy-format) calculation) plus **Path B** (a reference agent using `@atrib/agent` to make real payments, with signed receipts flowing into the log and merchant-side verification via `@atrib/verify`, exercising [§1](atrib-spec.md#1-attribution-record-format), [§2.6.1](atrib-spec.md#261-submit-entry), [§5](atrib-spec.md#5-sdk-specification)).

The spec stays protocol-agnostic. Protocol-specific attribution rationale lives in the adapter's documentation, not in the spec body. This preserves [§3.6](atrib-spec.md#36-implementation-notes)'s fact/policy separation.

First protocol adapter: x402. Others (ACP, UCP, AP2, MPP) follow the same template.

---

## Degradation contract

Section 5.8 of the spec. atrib failures never affect the primary tool call or agent response. Not a best practice; a hard protocol requirement. The guarantees:

- **All exceptions caught.** Any exception inside an atrib trigger handler is caught by the middleware, logged at warning level with an `atrib:` prefix, and swallowed. Exceptions never propagate to the tool handler, the agent, or calling code.

- **All network failures silent.** Log submission failures use exponential backoff (max 3 attempts, 30-second window). If all retries fail, the signed record is cached locally. The tool response is returned regardless.

- **Policy negotiation timeout falls back to defaults.** The timeout is 3 seconds. If the creator's policy endpoint is unreachable, the session proceeds under the default policy (equal weight, zero for unsigned).

- **Missing attribution context is not an error.** If an upstream tool does not have `@atrib/mcp` installed, it simply will not return attribution context. A gap node represents the unsigned hop. The session continues.

- **No key = pass-through mode.** If `ATRIB_PRIVATE_KEY` is not set, the middleware logs a warning and operates as a transparent proxy. No records emitted, no context attached. The tool or agent functions as if the `atrib()` wrapper were not present.

The consequence: adding `@atrib/mcp` or `@atrib/agent` to a production system cannot introduce failures. Attribution either works silently or fails silently. It is never a failure mode.

---

## Key design decisions

The decision-critical choices. Each is in [DECISIONS.md](DECISIONS.md) with full rationale and rejected alternatives.

**Ed25519, 32-byte seed ([D003](DECISIONS.md#d003-ed25519-not-dids-or-pki)).** Not RSA, not ECDSA, not DIDs. Ed25519 is fast, has a small key size, deterministic signatures, and no PKI dependency. The 32-byte seed (not the 64-byte NaCl expanded format) keeps key management simple. Key rotation and revocation are normatively specified in [§1.9](atrib-spec.md#19-key-rotation-and-revocation) ([D033](DECISIONS.md#d033-key-rotation-and-revocation)); see also [§6](atrib-spec.md#6-key-directory) ([D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) for the AKD-based public-key directory that resolves `creator_key → identity claim`.

**JCS canonicalization, not JWS/COSE ([D003](DECISIONS.md#d003-ed25519-not-dids-or-pki), Section 1.3).** RFC 8785 JSON Canonicalization Scheme gives deterministic serialization: lexicographic key ordering, no whitespace. This means any party can independently compute the same canonical bytes from the same record, which is necessary for signature verification and hash chain integrity. JWS wrapping was rejected because it adds envelope complexity without adding security properties atrib needs.

**tlog-tiles, not a custom log format ([D006](DECISIONS.md#d006-merkle-log-c2sp-tlog-tiles-not-blockchain)).** The C2SP tlog-tiles spec defines an HTTP-based read interface for tiled Merkle trees. It is used by Certificate Transparency, Go module checksums, and Sigstore. Using a standard format means existing tooling (Tessera, witnesses, monitors) works out of the box.

**Nine edge types, deterministic derivation ([D005](DECISIONS.md#d005-structure-not-causality-in-the-graph), [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), [D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05), [D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06), Section 3.2.4).** The graph records observable structure plus agent-declared causation (INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES). No edge encodes inferred causation; the agent-declared edges are derived from explicit fields the agent signed. Causal interpretation of those declarations remains the policy layer's job. The derivation rules are ordered and deterministic: two implementations on identical input must produce identical graphs.

**Robustness layers ([D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)-[D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), Sections 1.7.6, 2.11, 6.7).** Transaction records require ≥2 distinct verified signer keys (agent + counterparty per [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). Records may be cross-replicated to multiple independent logs and verifiers detect equivocation across them ([§2.11](atrib-spec.md#211-cross-log-replication)). Identity claims may declare capability envelopes that verifiers check records against; out-of-envelope records are flagged as a signal ([§6.7](atrib-spec.md#67-capability-declarations)). These are additive defenses; single-signer transactions, single-log submissions, and capability-less identity claims remain conforming.

**Adversarial threat model (Section 8.7).** atrib certifies what was signed, not whether the signed claim is true. A 10-layer trust assessment stack (signature, identity attestation, capability declaration, key revocation, transaction cross-attestation, tool-side response signing, external evidence, witnessing, cross-log replication, structural anomaly detection) lets verifiers build confidence in any individual record. No single layer is dispositive. The substrate provides structure for assessment, not guaranteed truth.

**`workspace:*` for shared packages ([D014](DECISIONS.md#d014-cross-package-integration-tests-live-in-a-private-workspace-package-and-re-derive-primitives)).** Cross-package integration tests re-derive primitives independently rather than importing shared code. This validates that JCS + SHA-256 produce identical output across independent code paths, which is the core reproducibility property the protocol depends on.

**Edge weight uses `max()`, not `sum()` (Section 4.2.2).** Every non-transaction node has both a primary edge (CHAIN_PRECEDES, SESSION_PRECEDES, etc.) and a CONVERGES_ON edge. Summing would add a CONVERGES_ON bonus to every node, inflating all structural contributors equally. Taking the maximum means the primary structural relationship dominates.

**Middleware pattern, not method calls ([D008](DECISIONS.md#d008-middleware-pattern-not-method-calls)).** One `atrib()` call at init. Zero ongoing surface area. No methods for developers to call. This is modeled on TCP/IP: you open a socket and write data, the protocol handles the rest.

---

## Deployment topology

The atrib stack runs across two repositories with distinct deployment platforms. Each subdomain points its DNS at the appropriate origin; Cloudflare proxies all traffic for caching, DDoS protection, and TLS termination.

| Subdomain             | Source repo                                                                    | Platform                          | Purpose                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `atrib.dev`           | [`atrib-web`](https://github.com/creatornader/atrib-web)                       | Vercel (Next.js)                  | Marketing landing page                                                                                                     |
| `explore.atrib.dev`   | [`atrib`](https://github.com/creatornader/atrib) at `apps/dashboard/`          | Fly.io (host-routed via log-node) | Public block explorer (seven views: overview, identity, session, action, demo, trace, anchoring)                           |
| `log.atrib.dev`       | [`atrib`](https://github.com/creatornader/atrib) at `services/log-node/`       | Fly.io                            | Tessera-backed Merkle log API with optional SSE / JSON Feed subscriptions (spec [§2](atrib-spec.md#2-merkle-log-protocol)) |
| `graph.atrib.dev`     | [`atrib`](https://github.com/creatornader/atrib) at `services/graph-node/`     | Fly.io                            | Graph query API (spec [§3](atrib-spec.md#3-graph-query-interface))                                                         |
| `directory.atrib.dev` | [`atrib`](https://github.com/creatornader/atrib) at `services/directory-node/` | Fly.io                            | AKD-backed identity-claim directory (spec [§6](atrib-spec.md#6-key-directory))                                             |

The bifurcation between `atrib-web` (landing page) and the `atrib` monorepo (protocol services + dashboard) is intentional. The landing page has different deployment cadence (Vercel preview-on-PR for marketing copy iteration) and a different audience (visitors learning about the protocol) than the API services (Fly + spec-locked). API services deploy through the `Deploy services` GitHub Actions workflow after `CI` succeeds on `main`; the manual fallback is `flyctl deploy -c services/<name>/fly.toml --remote-only`. Keeping them separate avoids coupling marketing iteration to the protocol release cycle.

`explore.atrib.dev` is a special case: it shares the `atrib` repo with the API services and ships baked into the log-node Docker image. The log-node server applies host-based routing, when `Host=explore.atrib.dev` the request handler returns the dashboard HTML at `/`; otherwise it returns the API service-info index. This avoids a separate deployment surface for what is structurally one set of static assets composed against the three service APIs.

### How Cloudflare serves multiple origins

Cloudflare provides DNS for `atrib.dev` and proxies traffic per subdomain to its corresponding origin. Each subdomain has its own DNS record (CNAME or A/AAAA pair) pointing at the platform that hosts it:

- `atrib.dev` → Vercel's edge network (CNAME to `cname.vercel-dns.com`)
- `*.atrib.dev` (the API subdomains) → Fly.io's anycast IPs (A + AAAA + TXT `_fly-ownership` + CNAME `_acme-challenge`, per the proxied-DNS pattern)

When a request arrives at Cloudflare's edge, Cloudflare looks up the subdomain in its DNS table and proxies the connection to the resolved origin. From the origin's perspective, requests arrive with the original `Host:` header preserved, that's what enables host-based routing inside log-node to distinguish `explore.atrib.dev` from `log.atrib.dev`.

The "different repos" aspect is irrelevant at the Cloudflare layer: Cloudflare doesn't know about repos or deployment platforms, only about hostnames and origins. Vercel and Fly each independently provision certificates and serve traffic; Cloudflare proxies on top.

### Service discovery (bare hostnames)

Every API subdomain (`log.atrib.dev`, `graph.atrib.dev`, `directory.atrib.dev`) returns a service-info JSON at the bare hostname (`/`) listing supported versions, current version, and the endpoint catalog. This matches the GitHub `api.github.com` and Stripe `api.stripe.com` discovery convention and avoids the auto-redirect-to-latest pattern that would silently break clients pinned to old major versions when a new version ships.

Versioned URL paths (`/v1/checkpoint`, `/v6/lookup/<key>`) are immutable: once a version ships, those paths always return that version's contract. The service-info index points new clients at `current_version` while old clients on `/v1/...` keep resolving until v1 is formally deprecated and removed (a multi-step process: announce deprecation in `versions[]`, return `Deprecation` header on v1 calls, eventually 410 Gone).

## Package architecture

```
@atrib/mcp           MCP server middleware (creator side)
  └── Signs records, propagates context, submits to log

@atrib/agent          Agent middleware (consumer side)
  ├── Core interceptor: reads/forwards context, detects transactions
  └── Framework adapters: one per supported MCP framework

@atrib/verify         Merchant verification library
  └── Runs §4.6 calculation locally, verifies settlement recommendations and AP2 / VI evidence

@atrib/log-dev        In-memory dev log stub (private, never deploy)
  └── Implements §2.6 submission API for local testing

@atrib/integration    Cross-package tests + runnable examples (private)
  └── Re-derives primitives independently to validate reproducibility
```

Standalone services (under `services/`):

```
services/log-node     Production tlog (Tessera-style, Node.js)
services/graph-node   Production graph derivation service
services/directory-node  Production AKD-backed identity directory (per §6.2)
services/atrib-emit   Two binaries: MCP server `atrib-emit` (interactive)
  │                   and CLI `atrib-emit-cli` (D082, for hook-class
  │                   producers). Both route through the same handleEmit
  │                   path so records are byte-identical.
  └── Producer-side cognitive primitive, agent invokes when it wants to
      sign observations / annotations / revisions the wrapper doesn't
      auto-capture (built-in tool calls, reasoning steps). Records are
      byte-identical to wrapper-signed records (verifier MUST NOT
      distinguish). Inherits the wrapper's session via local mirror
      autoChain so explicit emits chain cleanly with mechanical tool
      calls in the same session.

services/atrib-trace  MCP server for backward causal-chain walking
  └── Consumer-side cognitive primitive, reads the local mirror (per
      §5.9), follows `informed_by` edges backward from a starting record
      hash, surfaces sidecar_summary per visited record (tool name,
      span kind/name, model, prompt version, topics, intent). Read-only;
      does not sign. Lets an agent reconstruct
      "how did I arrive at this conclusion?" without round-tripping
      through the public log.

services/atrib-summarize  MCP server for narrative synthesis across N records
  └── Consumer-side cognitive primitive, reads N records by context_id
      and/or record_hashes from the local mirror, calls an OpenAI-compatible
      LLM (defaults to NIM qwen3.5-397b) to synthesize a narrative. The
      prompt includes normalized sidecar content, including OpenInference
      prompt/output/usage/cost metadata when present. Closes the
      consumer-side loop: agents read context, not raw records.

services/atrib-verify  MCP server for counterparty handoff evidence checks
  └── Consumer-side cognitive primitive, reads caller-supplied continuation
      packets or mirror envelopes, verifies record signatures, body
      commitments, inclusion proofs, trusted signers, context policy, and
      freshness, then returns accepted hashes for `informed_by`. Read-only;
      it does not fetch archives or sign records.

(Future, not yet built, placeholder per D070)
services/archive-node  Record Body Archive Layer (§2.12)
  └── Separate from log-node by design. Stores canonical record bodies
      content-addressed by record_hash. Submission OPTIONAL at the
      protocol level, producers using the salted-commitment privacy
      posture (§8.3) keep bodies producer-local instead. Multi-archive
      federation supported via content-addressing; multiple archives
      MAY mirror the same body set. Closes the verifiability loop for
      records whose privacy posture admits public-body retrieval. The
      formal ADR + reference implementation are tracked under D070;
      §2.12 carries the current spec contract.
```

The fourteen designed-public packages are published to npm via Trusted Publishing OIDC: seven core packages (`mcp`, `agent`, `verify`, `cli`, `mcp-wrap`, `directory`, `openinference`) and seven cognitive-primitive MCP servers (`emit`, `annotate`, `revise`, `recall`, `trace`, `summarize`, `verify-mcp`). The private packages (`log-dev`, `integration`, Cloudflare examples, deployed services, and dashboard) are workspace fixtures, proof harnesses, deployed services, or product surfaces. All TypeScript strict mode, no `any` types, with error handling following the degradation contract. The cognitive-primitive MCP services run in the agent's process and either sign explicit records or read local mirror and caller-supplied evidence; no separate deployment is needed.

Dependencies are minimal and audited: `@noble/ed25519` for signing, `@noble/hashes` for SHA-256, `canonicalize` for JCS. Framework dependencies are structural-typed, never hard-imported.

---

## Further reading

- [atrib-spec.md](atrib-spec.md), the complete protocol specification ([§0](atrib-spec.md#0-foundations)-[§7](atrib-spec.md#7-harness-integration-patterns))
- [DECISIONS.md](DECISIONS.md), architectural decision log ([D001](DECISIONS.md#d001-agent-first-sequencing-not-browser-first)-[D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7); [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) and [D070](DECISIONS.md#d070-record-body-archive-layer-placeholder-adr) are placeholder ADRs awaiting formal write-ups)
- [packages/agent/README.md](packages/agent/README.md) -- adapter table with quick-start snippets for every framework
- [packages/integration/examples/signer-proxy/](packages/integration/examples/signer-proxy/) -- sandbox signer proxy example ([§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) / [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox))
- [spec/conformance/1.4/](spec/conformance/1.4/) -- signing and adversarial record conformance corpus ([§1.4](atrib-spec.md#14-signing-and-verification) / [D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus))
- [spec/conformance/1.2.6/](spec/conformance/1.2.6/) -- conformance corpus for the `provenance_token` field ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) / [§1.2.6](atrib-spec.md#126-provenance_token))
- [spec/conformance/2.6.1/](spec/conformance/2.6.1/) -- shared conformance corpus for the submission API
- [spec/conformance/3.2.4/](spec/conformance/3.2.4/) -- full graph edge derivation conformance corpus ([§3.2.4](atrib-spec.md#324-edge-derivation-rules) / [D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus))
