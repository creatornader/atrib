# Atrib Technical Architecture

A deep technical overview of the Atrib value provenance protocol. This document is the middle layer between the [README](README.md) (what Atrib does) and the [spec](atrib-spec.md) (every normative detail). It is written for developers evaluating whether to build on or contribute to the protocol.

For architectural decisions and their rationale, see [DECISIONS.md](DECISIONS.md).

---

## System overview

Atrib has three protocol layers and one SDK layer that automates them. Data flows in one direction: tool call happens, record is signed, record is committed to the log, graph is built from committed records, policy is applied to the graph, settlement recommendation is produced.

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
                │  5 edge types, deterministic derivation              │
                │  Structure only — no causal claims                  │
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
  u8  event_type;      // 0x01 = tool_call, 0x02 = transaction
}
// Total: 90 bytes
```

The log proves that a signed record existed at a specific position in the tree. It does not reveal what the record contained. A third party can verify inclusion without reading the content. The full record stays with the creator.

The reference implementation uses [Tessera](https://github.com/transparency-dev/tessera) (maintained by Google's transparency team). Any operator can run a compatible log -- the spec defines the wire format, not the implementation.

### Layer 3: Attribution graph (Section 3)

The graph is a directed property multigraph with three node types (`tool_call`, `transaction`, `gap_node`) and five edge types, all derived deterministically from record structure:

| Edge type          | Direction | Derivation                                                              |
| ------------------ | --------- | ----------------------------------------------------------------------- |
| `CHAIN_PRECEDES`   | A -> B    | B's `chain_root` = SHA-256(JCS(A)). Explicit hash chain link.           |
| `SESSION_PRECEDES` | A -> B    | Same `context_id`, no chain link, A's timestamp < B's timestamp.        |
| `SESSION_PARALLEL` | A <-> B   | Same `context_id`, no chain link, no temporal ordering.                 |
| `CONVERGES_ON`     | N -> T    | N is any non-transaction node, T is the transaction node, same session. |
| `CROSS_SESSION`    | A -> T    | Different `context_id`, same explicit `session_token`. Never inferred.  |

The derivation rules are normative (Section 3.2.4). Two implementations processing identical records must produce identical edge sets. This is what makes independent verification possible: you do not need to trust the graph service, because you can rebuild the graph yourself and check.

Gap nodes represent unsigned hops -- tool calls evidenced by OTel spans but lacking a signed attribution record. They make the absence of attribution visible rather than hiding it. Gap nodes participate in temporal and convergence edges but not chain or cross-session edges.

---

## Trust model

Atrib's trust model is designed so that every claim the protocol makes is independently verifiable by any party. Here is exactly what is verifiable and what is trusted:

**Verifiable by anyone:**

- **Record signatures.** Each attribution record is Ed25519 signed. Anyone with the creator's public key (which is embedded in the record itself) can verify the signature. No certificate authority, no PKI, no trusted third party.

- **Log inclusion.** The Merkle log returns RFC 6962 inclusion proofs. Anyone with the log's checkpoint (a signed tree head) can verify that a specific record was committed at a specific index. The proof is a hash path from the leaf to the root -- pure math, no trust required.

- **Log consistency.** Consecutive checkpoints can be verified for consistency -- proving the log is append-only and no entries were modified or deleted between checkpoints. This is the standard Certificate Transparency consistency proof.

- **Graph edges.** All five edge types are deterministically derived from record fields. Given the same set of records, any implementation following the derivation rules in Section 3.2.4 must produce the same graph. You can verify the graph by rebuilding it.

- **Settlement calculation.** The calculation algorithm (Section 4.6) is a pure function of graph + policy. No network calls, no randomness, no timestamps beyond those in the records. Any party with the same inputs gets the same distribution. The `@atrib/verify` package exists specifically so merchants can run this locally.

**Trusted (but auditable):**

- **Log operator append-only behavior.** The log operator could theoretically refuse to accept entries (censorship) or attempt to present different views to different parties (equivocation). Both are detectable: censorship is observable by the submitter (they do not receive an inclusion proof), and equivocation is detectable via consistency proofs and the witnessing protocol (Section 2.9). The trust assumption is that the operator does not equivocate -- and the audit mechanism makes equivocation risky.

**Not trusted at all:**

- **Atrib Inc.** The protocol is an open spec. The signing libraries are open source. The log format is a public standard. The calculation algorithm is published and locally executable. No single party -- including the company that wrote the spec -- has privileged access, override capability, or veto power over the protocol's outputs.

---

## Why Certificate Transparency, not blockchain

This is the most frequently asked architectural question. The short answer: CT Merkle logs provide the same cryptographic guarantees that matter for this use case -- append-only, tamper-evident, publicly auditable -- without tokens, gas fees, block confirmation times, or association with cryptocurrency.

The longer answer:

**Same math.** Both CT logs and blockchains use Merkle trees to provide tamper evidence. An entry committed to either structure cannot be altered without invalidating the root hash. Both support inclusion proofs (proving a specific entry exists) and consistency proofs (proving the tree only grew, never mutated).

**Different economics.** A blockchain requires a consensus mechanism (proof-of-work or proof-of-stake) to determine who appends the next block. That consensus mechanism requires an incentive token, which requires a token economy. CT logs have a simpler trust model: a single operator appends entries, and anyone can audit the operator's behavior via consistency proofs and witnessing. The trust assumption is weaker (you trust one operator not to equivocate, rather than trusting a majority of stake), but equivocation is detectable and the operator is publicly identified -- the same trust model that secures the web's TLS certificate ecosystem.

**Different performance.** CT log submission is an HTTP POST that returns an inclusion proof. There is no block time, no gas auction, no mempool. Latency is bounded by network round-trip time, not by consensus finality.

**Different packaging.** Blockchains carry cultural and regulatory baggage that is irrelevant to attribution infrastructure. There are no tokens to list, no wallets to integrate, no securities questions to answer. The Tessera library that implements the log is maintained by Google's transparency team and used in production by Certificate Transparency, Go module checksums, and Sigstore. It is boring infrastructure, which is exactly what you want for a trust layer.

The decision is documented in D006.

---

## Payment protocol integration

Atrib detects transaction events from six agent commerce protocols simultaneously:

| Protocol                | Detection signal                                          | Source                       |
| ----------------------- | --------------------------------------------------------- | ---------------------------- |
| ACP (Stripe/OpenAI)     | `status === "completed"` + embedded `order`               | Checkout completion response |
| UCP                     | Same as ACP + top-level `ucp.version` envelope            | Checkout completion response |
| x402 (Coinbase)         | `PAYMENT-RESPONSE` HTTP header                            | Tool call response headers   |
| MPP (Tempo Labs/Stripe) | `Payment-Receipt` HTTP header                             | Tool call response headers   |
| AP2 (Google)            | A2A DataPart with `ap2.mandates.PaymentMandate`           | A2A task response            |
| a2a-x402 (Google)       | `metadata["x402.payment.status"] === "payment-completed"` | A2A task metadata            |

The design principle is **detect, not implement**. Atrib pattern-matches on tool call responses to identify when a transaction occurred. It does not initiate payments, move money, hold funds, or enforce settlement. The detection logic for all six protocols ships in `@atrib/agent`'s `transaction.ts` and runs simultaneously -- you do not choose a payment protocol at install time.

This matters for two reasons:

1. **Protocol agnosticism.** Atrib works regardless of which payment rail the merchant uses. If a seventh protocol appears tomorrow, adding detection is a pattern-matching rule, not a protocol change.

2. **Separation of concerns.** Attribution and payment are orthogonal problems. Attribution answers "who contributed to this outcome?" Payment answers "how does money move?" Coupling them would mean Atrib's adoption depends on payment protocol adoption, and vice versa.

When a transaction is detected, the agent emits a `transaction` record (event_type `"transaction"`) with the same `context_id` as the session. This closes the attribution loop -- the graph now has a terminal node that all contributing tool calls converge on. See Section 1.7 for the detection rules for each protocol.

There are two emission paths for transaction records (Section 5.4.5, D011). Path 1: the merchant has `@atrib/mcp` installed and emits the transaction record directly. Path 2: the merchant does not have Atrib, so the agent detects the transaction from the response and emits it. Anti-double-emission logic prevents both from firing: the agent checks whether the response already contains an attribution token, and suppresses Path 2 if it does.

---

## MCP framework adapters

The SDK ships one core interceptor (`atrib()`) and one adapter helper per supported MCP framework. The interceptor handles record construction, signing, and log submission. The adapter handles the framework-specific plumbing to hook into tool call lifecycle events.

### Why each adapter is different

Every MCP framework has a different integration surface. The Claude Agent SDK exposes an `McpServer` instance you can wrap directly. Cloudflare Agents has an `McpAgent` class with lifecycle hooks. Vercel AI SDK's `@ai-sdk/mcp` ships its own JSON-RPC implementation that is structurally incompatible with the standard `@modelcontextprotocol/sdk` Client. LangChain's `MultiServerMCPClient` wraps multiple connections and needs a different hook point.

The project established a "source-read-first" principle early (D018): before writing an adapter, read the host framework's source code to find the correct integration point. All six shipped adapters were built this way, and every one had a different correct answer. The adapter helper signature varies because the host framework's surface varies -- that variation is forced by the host, not invented by Atrib.

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

## Degradation contract

Section 5.8 of the spec defines the most important operational property: **Atrib failures must never affect the primary tool call or agent response.**

This is not a best practice. It is a hard protocol requirement. The specific guarantees:

- **All exceptions caught.** Any exception inside an Atrib trigger handler is caught by the middleware, logged at warning level with an `atrib:` prefix, and swallowed. Exceptions never propagate to the tool handler, the agent, or calling code.

- **All network failures silent.** Log submission failures use exponential backoff (max 3 attempts, 30-second window). If all retries fail, the signed record is cached locally. The tool response is returned regardless.

- **Policy negotiation timeout falls back to defaults.** The timeout is 3 seconds. If the creator's policy endpoint is unreachable, the session proceeds under the default policy (equal weight, zero for unsigned).

- **Missing attribution context is not an error.** If an upstream tool does not have `@atrib/mcp` installed, it simply will not return attribution context. A gap node represents the unsigned hop. The session continues.

- **No key = pass-through mode.** If `ATRIB_PRIVATE_KEY` is not set, the middleware logs a warning and operates as a transparent proxy. No records emitted, no context attached. The tool or agent functions as if the `atrib()` wrapper were not present.

The consequence: adding `@atrib/mcp` or `@atrib/agent` to a production system has zero risk of introducing failures. Attribution either works silently or fails silently. It is never a failure mode.

---

## Key design decisions

These are the load-bearing choices. Each is documented in detail in [DECISIONS.md](DECISIONS.md).

**Ed25519, 32-byte seed (D003).** Not RSA, not ECDSA, not DIDs. Ed25519 is fast, has a small key size, deterministic signatures, and no PKI dependency. The 32-byte seed (not the 64-byte NaCl expanded format) keeps key management simple. Key rotation is deferred to v2.

**JCS canonicalization, not JWS/COSE (D003, Section 1.3).** RFC 8785 JSON Canonicalization Scheme gives deterministic serialization: lexicographic key ordering, no whitespace. This means any party can independently compute the same canonical bytes from the same record, which is necessary for signature verification and hash chain integrity. JWS wrapping was rejected because it adds envelope complexity without adding security properties Atrib needs.

**tlog-tiles, not a custom log format (D006).** The C2SP tlog-tiles spec defines an HTTP-based read interface for tiled Merkle trees. It is used by Certificate Transparency, Go module checksums, and Sigstore. Using a standard format means existing tooling (Tessera, witnesses, monitors) works out of the box.

**Five edge types, deterministic derivation (D005, Section 3.2.4).** The graph records observable structure only. No edge encodes a causal claim. Causal interpretation is the policy layer's job. The derivation rules are ordered and deterministic: two implementations on identical input must produce identical graphs.

**`workspace:*` for shared packages (D014).** Cross-package integration tests re-derive primitives independently rather than importing shared code. This validates that JCS + SHA-256 produce identical output across independent code paths, which is the core reproducibility property the protocol depends on.

**Edge weight uses `max()`, not `sum()` (Section 4.2.2).** Every non-transaction node has both a primary edge (CHAIN_PRECEDES, SESSION_PRECEDES, etc.) and a CONVERGES_ON edge. Summing would add a CONVERGES_ON bonus to every node, inflating all structural contributors equally. Taking the maximum means the primary structural relationship dominates.

**Middleware pattern, not method calls (D008).** One `atrib()` call at init. Zero ongoing surface area. No methods for developers to call. This is modeled on TCP/IP: you open a socket and write data, the protocol handles the rest.

---

## Package architecture

```
@atrib/mcp           MCP server middleware (creator side)
  └── Signs records, propagates context, submits to log

@atrib/agent          Agent middleware (consumer side)
  ├── Core interceptor: reads/forwards context, detects transactions
  └── Framework adapters: one per supported MCP framework

@atrib/verify         Merchant verification library
  └── Runs §4.6 calculation locally, verifies settlement recommendations

@atrib/log-dev        In-memory dev log stub (private, never deploy)
  └── Implements §2.6 submission API for local testing

@atrib/integration    Cross-package tests + runnable examples (private)
  └── Re-derives primitives independently to validate reproducibility
```

The three public packages (`mcp`, `agent`, `verify`) are intended for npm publication. The two private packages (`log-dev`, `integration`) are workspace fixtures. All five are TypeScript strict mode, no `any` types, with error handling following the degradation contract.

Dependencies are minimal and audited: `@noble/ed25519` for signing, `@noble/hashes` for SHA-256, `canonicalize` for JCS. Framework dependencies are structural-typed, never hard-imported.

---

## Further reading

- [atrib-spec.md](atrib-spec.md) -- the complete protocol specification (Sections 0-5)
- [DECISIONS.md](DECISIONS.md) -- architectural decision log (D001-D025+)
- [internal planning doc](internal planning doc) -- build order, package details, testing strategy
- [packages/agent/README.md](packages/agent/README.md) -- adapter table with quick-start snippets for every framework
- [spec/conformance/2.6.1/](spec/conformance/2.6.1/) -- shared conformance corpus for the submission API
