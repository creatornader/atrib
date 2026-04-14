# atrib

**Draft 0.1, April 2026**

---

## §0 Foundations

Contents

- [The Problem We Inherit](#the-problem-we-inherit)
- [The Shift We Are Living Through](#the-shift-we-are-living-through)
- [What We Are Building](#what-we-are-building)
- [Principle I: Provenance travels with the artifact](#principle-i-provenance-travels-with-the-artifact)
- [Principle II: Accountability without content exposure](#principle-ii-accountability-without-content-exposure)
- [Principle III: Settlement is separate from attribution](#principle-iii-settlement-is-separate-from-attribution)
- [Principle IV: No central arbiter of value](#principle-iv-no-central-arbiter-of-value)
- [Principle V: The protocol is open. The product is commercial.](#principle-v-the-protocol-is-open-the-product-is-commercial)
- [The Claim About Advertising](#the-claim-about-advertising)

_On the relationship between transparency, trust, and value in a world where agents act on our behalf._

The internet has always promised portability of value. It has never delivered it. atrib is an attempt to finally make that promise real, not by controlling how value moves, but by making visible how it flows.

## The Problem We Inherit

The web was built to move information. It was never built to account for the value that information creates. When a piece of content influences a decision, when a tool enables an outcome, when an idea travels through a network and eventually causes something to happen, the web has no native way to record that journey. No memory. No receipt. No mechanism for credit to follow contribution.

Into that vacuum, advertising stepped. Advertising is not fundamentally about showing people things. It is about solving a provenance problem: how does a business know what caused a customer to appear? In the absence of native provenance infrastructure, the only solution was to surrender that question to a centralized intermediary (Google, Facebook, whoever owned enough of the pipe to see both the influence and the outcome simultaneously). Those intermediaries became the most valuable companies in the world not by creating value, but by **owning the layer that connects value creation to value capture.**

The cost of that arrangement is visible everywhere. Content is optimized for engagement rather than truth because engagement is what the intermediary measures. Creators are compensated for attention rather than impact because attention is what the intermediary can see. Privacy is eroded because surveillance is how the intermediary maintains its position. The incentive gradient of the entire web bends toward whatever the intermediary finds legible, and the intermediary finds legible whatever it can monetize.

This is not a moral failure. It is a structural consequence of missing infrastructure.

---

## The Shift We Are Living Through

The agent economy changes the terms of this problem. When AI agents do the majority of economically meaningful activity on the internet (discovering products, synthesizing information, making recommendations, completing transactions) the attention model of advertising has no surface to attach to. Agents do not have emotions. They cannot be manipulated by loss aversion or social proof. A banner ad means nothing to a language model.

But the underlying economic problem remains. Businesses still need customers. Creators of tools, content, and knowledge still contribute to outcomes. Value is still being created and captured. The question of _what led to what_ (the provenance question) does not go away. It becomes more urgent, and more complex, because the chains of contribution are longer, more distributed, and entirely invisible to existing measurement infrastructure.

**The agent economy is already generating real commerce with zero verified attribution infrastructure.** Every transaction that completes without a provenance record is value that pools at the platform layer (whoever runs the agent surface) rather than distributing to the contributors who actually caused it. This is the same structural problem as the old web. Same shape, higher stakes, faster clock.

The window to build provenance infrastructure before platforms absorb the problem (and solve it, as Google solved it, in a way that reconstitutes their centrality) is measured in months, not years.

---

## What We Are Building

atrib is value provenance infrastructure for the agent economy. Not an identity layer. Not a payment layer. Not a content attribution system. Something that sits between all of those: **a verifiable record of how value moved.**

The central claim is this: it is possible to make the structural relationships of the agent economy transparent (what tool calls preceded what outcomes, how contributions linked together within a session, what the observable shape of value creation actually was) without making the content of those interactions visible to anyone who should not see it.

This is observability without surveillance. The system becomes legible to itself (to its participants, to the parties with a legitimate stake in its outcomes) without becoming legible to surveillance. Accountability without inspection. Transparency without exposure.

This distinction matters because every prior attempt at provenance has collapsed it. C2PA proves a certificate exists but cannot say what it caused. ProRata tracks content usage but keeps advertising as the economic model. Blockchain provenance systems make everything visible to everyone, which is privacy-hostile by design. OpenTelemetry makes systems observable to their operators but invisible to participants.

atrib is built on a different principle: **you can record what happened and who was present without claiming to know what caused what, and you can distribute credit fairly without trusting any single intermediary to arbitrate it.** The structure of contributions is a verifiable fact. What those contributions are worth is a policy judgment. atrib provides the former without pretending to settle the latter.

### Principle I: Provenance travels with the artifact

Every tool call, every content retrieval, every agent action carries a signed record of its origin and its structural position in the session: who called what, in what order, in what context. This record is embedded at creation time, not appended later, not inferred from logs. It is native to the interaction, not a post-hoc annotation. What those structural relationships mean for value distribution is a question for the policy layer, not for the record itself.

### Principle II: Accountability without content exposure

What is published globally is not the content of interactions but cryptographic commitments to them. Anyone can verify that an attribution record existed and was unaltered. No one can read what it contained without the holder's consent. Privacy and accountability are not in tension here; they are structurally separated.

### Principle III: Settlement is separate from attribution

atrib records what happened and who contributed. It does not move money, enforce agreements, or determine outcomes. Payment rails, legal agreements, and business decisions happen on top of verified attribution data. The protocol is neutral about what participants do with the truth; it only insists that the truth be available.

### Principle IV: No central arbiter of value

The attribution chain is verifiable by any party with the relevant records. No single operator can alter it, suppress it, or adjudicate disputes about it. The Merkle log provides global verifiability without global visibility. Trust comes from mathematics and open specification, not from trusting atrib.

### Principle V: The protocol is open. The product is commercial.

The atrib specification, the signing libraries, and the transparency log infrastructure are open and free. The queryable attribution graph, the analytics products, and the settlement resolution services are commercial.

---

## The Claim About Advertising

We do not claim that advertising will disappear. We claim that the structural necessity of advertising as the primary funding model for the internet rests on a single foundation: the absence of native provenance infrastructure. When that foundation erodes, the model built on it becomes optional rather than inevitable.

Businesses will always need to reach new customers. Discovery is a real problem that advertising partially solves. But the attribution function of advertising (proving that a specific message caused a specific outcome, in order to justify the spend) is entirely a workaround for missing infrastructure. When the infrastructure exists, the workaround becomes unnecessary.

The agent economy provides the discovery layer. Agents surface products, synthesize recommendations, complete transactions, all without requiring the user's attention to be purchased. **atrib provides the attribution layer: the mechanism by which value flows back to the contributors who made those agent actions useful, without any intermediary needing to own the pipe.**

That is not advertising replacement through disruption. It is advertising replacement through making the problem advertising was solving obsolete.

The internet was built to move information freely. It failed to move value fairly. That failure was not inevitable; it was a consequence of building a network without provenance infrastructure, and then watching the vacuum fill with surveillance capitalism.

We are building at a moment when the architecture of the web is being renegotiated. Agents are replacing browsers as the primary interface. Protocols are being written that will determine how value flows for the next generation. **The question of who owns the provenance layer in this new architecture will determine whether we reproduce the extractive dynamics of the old web or build something structurally different.**

atrib is a bet that the answer does not have to be a company. It can be a protocol, open and verifiable, with a company that builds the best products on top of it.

---

## §1 Attribution Record Format

_The canonical data model, signing protocol, and propagation mechanism for atrib attribution records._

Contents

- [1.1 Normative Requirements Language](#11-normative-requirements-language)
- [1.2 The Attribution Record](#12-the-attribution-record)
  - [1.2.1 Field definitions](#121-field-definitions)
  - [1.2.2 content_id derivation](#122-content_id-derivation)
  - [1.2.3 chain_root for genesis records](#123-chain_root-for-genesis-records)
  - [1.2.4 event_type values](#124-event_type-values)
- [1.3 Canonical Serialization](#13-canonical-serialization)
- [1.4 Signing and Verification](#14-signing-and-verification)
  - [1.4.1 Key format](#141-key-format)
  - [1.4.2 Signing procedure](#142-signing-procedure)
  - [1.4.3 Verification procedure](#143-verification-procedure)
  - [1.4.4 Test vector validation](#144-test-vector-validation)
- [1.5 Context Propagation](#15-context-propagation)
  - [1.5.1 context_id: the session anchor](#151-context_id-the-session-anchor)
  - [1.5.2 HTTP transport: tracestate](#152-http-transport-tracestate)
  - [1.5.3 HTTP fallback: X-atrib-Chain](#153-http-fallback-x-atrib-chain)
    - [1.5.3.1 Context ID Header: X-atrib-Context](#1531-context-id-header-x-atrib-context)
  - [1.5.4 MCP transport: params.\_meta](#154-mcp-transport-params_meta)
  - [1.5.5 Cross-trace session continuity](#155-cross-trace-session-continuity)
- [1.6 Unsigned Hops and Gap Nodes](#16-unsigned-hops-and-gap-nodes)
- [1.7 Transaction Event Hooks](#17-transaction-event-hooks)
  - [1.7.1 ACP](#171-acp)
  - [1.7.2 UCP](#172-ucp)
  - [1.7.3 x402](#173-x402)
  - [1.7.4 MPP](#174-mpp)
  - [1.7.5 AP2 / a2a-x402](#175-ap2--a2a-x402)
- [1.8 Known Limitations](#18-known-limitations)
- [Interoperability Roadmap](#interoperability-roadmap)

### 1.1 Normative Requirements Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119 and RFC 8174.

All normative requirements in this section are prefixed with their requirement level. A conforming implementation satisfies all MUST requirements and is RECOMMENDED to satisfy all SHOULD requirements.

---

### 1.2 The Attribution Record

An attribution record is the atomic unit of atrib provenance. Each record documents a single event in an attribution chain (a tool call, a transaction) and cryptographically binds that event to its creator, its position in the chain, and the session that contains it. The chain is structural, not causal: it records what happened and how records relate to each other, not why one event caused another. Causal interpretation belongs to the query and policy layers built on top of these records.

An attribution record is a JSON object with the following fields:

```
{
  "spec_version":  "atrib/1.0",
  "content_id":   "sha256:",        // who served this (see §1.2.2)
  "creator_key":  "",
  "chain_root":   "sha256:",        // hash of parent record, or context_id for genesis (see §1.2.3)
  "event_type":   "tool_call",           // or "transaction" (see §1.2.4)
  "context_id":   "", // 32 hex chars (see §1.5.1)
  "timestamp":    1743850000000,         // Unix milliseconds, integer
  "session_token":"", // OPTIONAL (see §1.5.5); omitted when not in a cross-trace session
  "signature":    ""
}
```

#### 1.2.1 Field Definitions

| Field         | Type    | Req  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec_version  | string  | MUST | Always the literal string `"atrib/1.0"` for records conforming to this specification. Implementations MUST reject records with unknown spec_version values rather than attempting to process them.                                                                                                                                                                                                                                                      |
| content_id    | string  | MUST | A prefixed hex-encoded SHA-256 digest identifying the specific creator and tool that produced this record. See §1.2.2 for derivation. Format: `"sha256:"` followed by 64 lowercase hex characters.                                                                                                                                                                                                                                                      |
| creator_key   | string  | MUST | The creator's Ed25519 public key, encoded as base64url (RFC 4648 §5, no padding). 43 characters. This is the stable identity of the creator across all their records. It is not an ephemeral session key.                                                                                                                                                                                                                                               |
| chain_root    | string  | MUST | A prefixed hex-encoded SHA-256 digest anchoring this record in the chain. For non-genesis records: the hash of the parent attribution record's canonical serialization (see §1.3). For genesis records: the hash of the context_id string. See §1.2.3.                                                                                                                                                                                                  |
| event_type    | string  | MUST | The type of event this record documents. See §1.2.4 for the defined values. Implementations MUST reject records with unrecognized event_type values.                                                                                                                                                                                                                                                                                                    |
| context_id    | string  | MUST | The W3C Trace Context trace-id of the OTel trace containing this event. 32 lowercase hex characters. This is the join key that connects attribution records to each other and to transaction events. See §1.5.1.                                                                                                                                                                                                                                        |
| timestamp     | integer | MUST | Unix time in milliseconds as a JSON integer. MUST NOT be a string, float, or ISO 8601 date. MUST NOT be in the future. Implementations SHOULD reject records with timestamps more than 5 minutes in the future relative to local clock.                                                                                                                                                                                                                 |
| session_token | string  | MAY  | Base64url-encoded 16-byte opaque token identifying the logical session across OTel trace boundaries. Present only when the record was emitted in a cross-trace session. When present, the graph query layer uses this field to construct CROSS_SESSION edges between records with different context_ids that share the same session_token. See §1.5.5. The session_token field is included in the canonical serialization and covered by the signature. |
| signature     | string  | MUST | Ed25519 signature over the canonical serialization of the record with the signature field omitted, encoded as base64url (RFC 4648 §5, no padding). 86 characters. See §1.4 for the full signing procedure.                                                                                                                                                                                                                                              |

#### 1.2.2 content_id Derivation

The `content_id` identifies who specifically served a piece of content, not what the content was, and not a fingerprint of the response payload. Two different MCP server operators serving the same tool will produce different `content_id` values. This is intentional: provenance is about the serving entity, not the served artifact.

The `content_id` MUST be computed as follows:

```
// Inputs:
server_url   // the MCP server's base URL, lowercased, trailing slash removed
tool_name    // the tool name from the tools/list response, case-preserved

// Derivation:
input  = server_url + ":" + tool_name
digest = SHA-256(UTF-8(input))
content_id = "sha256:" + hex(digest)  // lowercase hex, no spaces

// Example:
// server_url = "https://tools.example.com"
// tool_name  = "search_web"
// input      = "https://tools.example.com:search_web"
// content_id = "sha256:3f8a2b..."
```

**Note (Server URL Normalization):** Before hashing, implementations MUST normalize the server URL: lowercase the scheme and host, remove any trailing slash from the path, and preserve the port if explicitly specified. Query strings and fragments are excluded. A server at `HTTPS://Tools.Example.Com/` and one at `https://tools.example.com` must produce the same content_id.

#### 1.2.3 chain_root for Genesis Records

Every attribution chain begins with a genesis record: the first hop in a session that has no upstream atrib context. Genesis records arise when a tool server receives a call that carries no `params._meta.atrib` field, or when the propagated context cannot be verified.

For a genesis record, the `chain_root` MUST be computed as:

```
chain_root = "sha256:" + hex(SHA-256(UTF-8(context_id)))
```

This anchors every genesis record to its session without requiring a parent record. It is verifiable by any party who knows the context_id.

**Normative clarification:** Both `chain_root` and the propagation token's `record_hash` component are computed over the JCS canonicalization of the COMPLETE signed record, INCLUDING the `signature` field. This differs from the signing input (§1.3), which EXCLUDES the `signature` field. Specifically:

- Signing input: `JCS(record without signature)` -- used for Ed25519 sign/verify
- Record hash: `SHA-256(JCS(complete record with signature))` -- used for `chain_root` and propagation token
- chain_root format: `"sha256:" + hex(record_hash)` -- prefixed hex encoding of the record hash
- Token format: `base64url(record_hash) + "." + base64url(creator_key)` -- base64url encoding of raw bytes

A receiving implementation that decodes a propagation token and needs to set `chain_root` MUST convert: `chain_root = "sha256:" + hex(decoded_token.record_hash)`.

#### 1.2.4 event_type Values

This specification defines two event_type values. No other values are valid in records conforming to this specification version.

| Value       | Meaning                      | When emitted                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool_call   | A tool contribution event    | Emitted by an MCP server when it returns a successful (non-error) response to a `tools/call` request. MUST NOT be emitted when `isError: true` in the MCP result.                                                                                                                  |
| transaction | A commerce transaction event | Emitted when a transaction completes, either by the merchant's agent writing a record, or by the atrib SDK reading a transaction webhook. The `content_id` for a transaction record uses the merchant's checkout endpoint URL as the server_url and `"checkout"` as the tool_name. |

---

### 1.3 Canonical Serialization

Before signing or hashing, an attribution record MUST be serialized to a canonical byte sequence. Non-canonical serialization is one of the most common sources of interoperability failure in cryptographic systems. This specification uses JSON Canonicalization Scheme (JCS, RFC 8785) as the canonical form.

JCS defines a unique serialization for any JSON value by specifying lexicographic key ordering, specific number formatting, and Unicode escape rules. The result is a UTF-8 byte sequence that is identical across all conforming implementations.

**Procedure for signing**

To produce the canonical serialization for signing, implementations MUST:

First, construct the record object with all fields present including a placeholder empty string for `signature`. Second, remove the `signature` field entirely from the object. Third, apply JCS serialization (RFC 8785) to produce a UTF-8 byte sequence. The resulting bytes are the signing input.

```
// Record with signature field present (no session_token, most common case):
{
  "spec_version": "atrib/1.0",
  "content_id":   "sha256:3f8a2b...",
  "creator_key":  "ABC...",
  "chain_root":   "sha256:7e1f4a...",
  "event_type":   "tool_call",
  "context_id":   "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp":    1743850000000,
  "signature":    "XYZ..."
}

// Remove signature field, apply JCS → signing input (lexicographic key order):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"tool_call","spec_version":"atrib/1.0","timestamp":1743850000000}

// Record with session_token present (cross-trace sessions only):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"tool_call","session_token":"base64url16bytes","spec_version":"atrib/1.0","timestamp":1743850000000}

// Notes:
// JCS sorts keys lexicographically. No whitespace. No trailing newline.
// session_token is omitted entirely when not present. Absent field vs null are different.
// A record without session_token and one with session_token: null would produce
// different canonical forms and therefore different signatures. Always omit the field.
```

**Implementation Warning:** timestamp precision** The `timestamp` field MUST be a JSON integer (no decimal point, no exponent notation) representing milliseconds. A timestamp of `1743850000000` serializes as the integer `1743850000000` in JCS, not as `1.74385e12` or `"1743850000000"`. Incorrect serialization will produce a different signing input and cause signature verification to fail.

---

### 1.4 Signing and Verification

atrib uses Ed25519 (RFC 8032, §5.1) for all attribution record signing. Ed25519 provides compact signatures (64 bytes), fast verification, strong security, and does not require a PKI or certificate authority. Each creator generates and controls their own keypair.

#### 1.4.1 Key Format

Creator keypairs are raw 32-byte Ed25519 keys. The public key is encoded as base64url without padding (RFC 4648 §5) for inclusion in the `creator_key` field. The private key is retained by the creator and never transmitted.

```
// TypeScript key generation (using @noble/ed25519 or Web Crypto API):
const privateKey = crypto.getRandomValues(new Uint8Array(32))
const publicKey  = await ed.getPublicKey(privateKey)  // 32 bytes

// base64url encode, no padding:
const creatorKey = btoa(String.fromCharCode(...publicKey))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
// → 43-character string
```

#### 1.4.2 Signing Procedure

To sign an attribution record, an implementation MUST:

Step 1: Construct the attribution record with all fields populated except `signature`.

Step 2: Remove the `signature` field and apply JCS serialization (§1.3) to obtain the signing input bytes.

Step 3: Compute the Ed25519 signature over the signing input bytes using the creator's private key, following RFC 8032 §5.1.6 (Pure EdDSA, no prehashing).

Step 4: Encode the 64-byte signature as base64url without padding. Set this as the `signature` field on the record.

```
// Signing (TypeScript pseudocode):
function signRecord(record: AtribRecord, privateKey: Uint8Array): AtribRecord {
  const { signature: _, ...unsigned } = record
  const canonical  = jcs(unsigned)                    // RFC 8785
  const sigBytes   = ed25519.sign(canonical, privateKey) // RFC 8032 §5.1.6
  const sigEncoded = base64url(sigBytes)               // no padding, 86 chars
  return { ...record, signature: sigEncoded }
}
```

#### 1.4.3 Verification Procedure

To verify an attribution record, an implementation MUST:

Step 1: Decode `creator_key` from base64url to obtain the 32-byte Ed25519 public key. Reject if the decoded length is not 32 bytes.

Step 2: Decode `signature` from base64url to obtain the 64-byte signature. Reject if the decoded length is not 64 bytes.

Step 3: Remove the `signature` field from the record and apply JCS serialization to obtain the verification input bytes.

Step 4: Verify the signature against the verification input bytes using the decoded public key, following RFC 8032 §5.1.7. Reject if verification fails.

Step 5: Verify that `spec_version` is `"atrib/1.0"`. Reject if not.

Step 6: Verify that `event_type` is a known value per §1.2.4. Reject if not.

Step 7: Verify that `timestamp` is not more than 5 minutes in the future. Reject if so.

Step 8: Verify that `context_id` is exactly 32 lowercase hex characters. Reject if not.

A record passes verification if and only if all eight steps succeed. A partial verification is not valid.

#### 1.4.4 Test Vector Validation

All implementations of Ed25519 signing and verification MUST be validated against the Wycheproof test vectors for EdDSA (github.com/C2SP/wycheproof, `testvectors_v1/eddsa_verify_test.json`) prior to production deployment. Any test vector marked `"result": "invalid"` that an implementation accepts is a security defect. Any test vector marked `"result": "valid"` that an implementation rejects is a compatibility defect.

**Note (Key Rotation):** Key rotation is deferred to v2. In v1, a creator's `creator_key` is treated as stable. Implementers who need key rotation in v1 should issue new records with the new key and maintain a public attestation linking old and new keys. A formal key rotation mechanism will be specified in a future revision of this specification.

---

### 1.5 Context Propagation

For attribution chains to form, context must travel between hops, from the agent that initiates a session through every tool it calls. This section defines the propagation mechanism for each supported transport.

#### 1.5.1 context_id: The Session Anchor

The `context_id` is the join key that connects all attribution records in a session to each other and to the transaction event that closes it. Without it, records are isolated facts. With it, they form a graph.

The `context_id` MUST be the W3C Trace Context trace-id from the `traceparent` header of the OTel trace that contains the attribution event. It is the 32-character hexadecimal trace-id field, lowercase, without the `traceparent` prefix or other fields.

```
// traceparent header:
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
//                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                this 32-char segment is context_id

context_id = "4bf92f3577b34da6a3ce929d0e0e4736"
```

The `context_id` is **not** generated by atrib. It is the trace-id that already exists in the OTel instrumentation of the session. If the agent runtime does not produce OTel traces, implementations SHOULD generate a cryptographically random 16-byte value and use its hex encoding as the context_id, then inject it into any OTel spans created during the session.

#### 1.5.2 HTTP Transport: tracestate

When attribution context is propagated over HTTP, it MUST travel in the `tracestate` header, as an entry with the key `atrib`. The tracestate format follows W3C Trace Context Level 2 (www.w3.org/TR/trace-context-2/).

The value of the `atrib` tracestate entry is a compact reference token, not a full attribution record. The token format is:

```
token = base64url(record_hash_bytes) + "." + base64url(creator_key_bytes)

// record_hash_bytes: raw 32 bytes of the SHA-256 of the JCS-canonical signed record
// (no "sha256:" prefix; raw bytes only)
// creator_key_bytes: raw 32 bytes of the Ed25519 public key of the record's creator

// Maximum length: 43 + 1 + 43 = 87 characters
// Well within the W3C tracestate per-entry limit

// Full header example:
tracestate: atrib=D4a6GHvb...ABC.XYZ...QRS,vendor2=other-value
```

Implementations MUST preserve any existing tracestate entries when adding the `atrib` entry. The `atrib` entry SHOULD be placed leftmost per the W3C left-most-wins convention, as the most recently updated entry.

When reading an inbound tracestate, implementations MUST extract the `atrib` entry if present and decode the token to recover `record_hash` and `creator_key`. The `record_hash` becomes the `chain_root` field of the next attribution record emitted in this chain. The `creator_key` identifies the creator of the record that produced this token.

#### 1.5.3 HTTP Fallback: X-atrib-Chain

Some HTTP proxies, load balancers, and middleware strip unknown `tracestate` entries or the `tracestate` header entirely. When the `atrib` entry is absent from an inbound `tracestate`, implementations SHOULD check for a fallback header.

```
X-atrib-Chain:

// Example:
X-atrib-Chain: D4a6GHvb...ABC.XYZ...QRS
```

Implementations SHOULD set both `tracestate: atrib=...` and `X-atrib-Chain: ...` on outbound requests. Implementations MUST prefer the tracestate entry over the fallback header when both are present.

#### 1.5.3.1 Context ID Header: X-atrib-Context

For HTTP-transport payment protocol integrations (§1.7), the agent MUST propagate the session's `context_id` as the `X-atrib-Context` HTTP header on outbound requests that may trigger transaction events. The header value is the raw 32-character lowercase hexadecimal context_id, not the propagation token.

This header is distinct from `X-atrib-Chain` (which carries the propagation token) and serves a different purpose: it embeds the session anchor in HTTP requests so that transaction events (ACP checkout, x402 payment, MPP receipt) can be linked back to the attribution session.

Implementations MUST set `X-atrib-Context` on any outbound HTTP request to a URL listed in the agent's `serverUrls` configuration. The header name is case-insensitive per RFC 7230.

#### 1.5.4 MCP Transport: params.\_meta

MCP messages do not have HTTP headers. Attribution context MUST be propagated inside the `params._meta` property bag of MCP request messages, following the OTel MCP Semantic Conventions (opentelemetry.io/docs/specs/semconv/gen-ai/mcp/).

Implementations MUST inject both standard OTel context and the atrib token into `params._meta`:

```
{
  "jsonrpc": "2.0",
  "method":  "tools/call",
  "params": {
    "name": "search_web",
    "arguments": { "query": "..." },
    "_meta": {
      "traceparent": "00-4bf92f35...-00f067aa...-01", // W3C traceparent
      "tracestate":  "atrib=D4a6GHvb...ABC.XYZ...QRS", // atrib token
      "baggage":     "atrib-session="    // if cross-trace session (see §1.5.5)
    }
  }
}
```

This propagation format follows the MCP context propagation proposal (github.com/modelcontextprotocol/modelcontextprotocol/pull/414). Implementations SHOULD monitor this PR for any changes that become normative in the MCP specification and update accordingly.

For MCP over stdio transport, `params._meta` is the only propagation channel. There are no HTTP headers. Implementations MUST NOT attempt to inject attribution context into any other field of the MCP message.

#### 1.5.5 Cross-Trace Session Continuity

OTel traces have natural boundaries: a trace ends when a session ends. In long-running agent deployments, a user may interact with an agent across multiple distinct traces, and a transaction may complete in a trace that began independently of the traces that produced the attribution records.

To bridge attribution across trace boundaries, implementations MAY generate a `session_token`: a stable identifier for the logical session that persists across OTel trace boundaries.

```
// session_token generation:
session_token = base64url(crypto.getRandomValues(new Uint8Array(16)))
// → 22-character URL-safe string, generated once per logical session
```

When present, the `session_token` MUST be propagated in the W3C Baggage header (www.w3.org/TR/baggage/) under the key `atrib-session`, and in `params._meta.baggage` for MCP transport.

Attribution records that carry a `session_token` across trace boundaries can be grouped into the same logical session by the attribution graph query layer, even when their `context_id` values differ.

**Note (session_token is optional in v1):** Cross-trace session linking is a v1 feature with optional adoption. Implementations that do not generate session tokens will produce valid attribution chains within each trace. The session_token mechanism enables richer attribution graphs for deployments where transactions routinely complete in a different trace than the contributing tool calls.

---

### 1.6 Unsigned Hops and Gap Nodes

Not every MCP server in an agent's tool chain will have atrib installed in v1. When an agent calls a tool that does not emit a signed attribution record, the chain has an unsigned hop. This is expected and must be handled gracefully.

An unsigned hop arises when:

- an MCP tool call completes successfully but no attribution record is received in response, and\
- the OTel span for the call is present, indicating the call occurred.

Implementations SHOULD record unsigned hops as gap nodes in the attribution graph. A gap node contains:

```
{
  "type":       "gap_node",
  "tool_url":   "https://tools.example.com",  // from the OTel span
  "tool_name":  "search_web",                 // from the OTel span
  "context_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp":  1743850000000,
  "signed":     false
}
```

Gap nodes are part of the attribution graph. They are visible in graph queries. They carry a `verification_state` of `unsigned` (the lowest verification state) because no signature exists to verify. Their presence does not invalidate the chain or prevent settlement recommendations from being generated. What an unsigned node means for attribution weight is a question for the policy layer (§4), not for this section, which defines only the record format and what constitutes a gap node.

A creator who has not signed their contribution has not asserted a claim. The gap node preserves the fact that an unsigned hop occurred, making it visible to any party who inspects the graph, rather than silently excluding it.

---

### 1.7 Transaction Event Hooks

The attribution chain is complete when a transaction event closes the loop, connecting the tool calls that contributed to the commerce session to the actual moment of purchase. This section defines how atrib attaches to each supported commerce protocol.

In every case, the linking mechanism is the same: the `context_id` of the agent session must be embedded in the transaction metadata when the checkout is initiated, so that the transaction event webhook can be matched back to the attribution chain.

#### 1.7.1 ACP (Agentic Commerce Protocol)

ACP is the open standard published at `github.com/agentic-commerce-protocol/agentic-commerce-protocol`. The transaction event hook is the success response from `POST /checkout_sessions/{id}/complete`. A successful completion is signaled by `status === "completed"` together with an embedded `order` object whose `id` is a string. The `order.permalink_url` (when present) is the canonical post-purchase URL atrib uses to derive the transaction record's `content_id`.

Because ACP `POST /checkout_sessions/...` requests do not currently expose a free-form metadata field for arbitrary extension data, the `context_id` MUST travel via the same channels used for HTTP transports (per §1.5.2, §1.5.3, and §1.5.3.1): the `X-atrib-Context` HTTP header on the outbound request, and `params._meta.atrib` for MCP-transport ACP integrations.

```jsonc
// POST /checkout_sessions/{id}/complete success response
{
  "id": "checkout_session_123",
  "status": "completed", // detection signal
  "currency": "usd",
  "buyer": { "...": "..." },
  "line_items": ["..."],
  "totals": ["..."],
  "order": {
    // embedded order proves the completion
    "id": "ord_abc123",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://example.com/orders/ord_abc123",
  },
}
```

The server-to-merchant order webhook events use snake_case event types, NOT dot-notation:

```jsonc
// order_create event (NOT "order.created" or "ORDER_CREATED")
{
  "type": "order_create",
  "data": {
    "type": "order",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://www.testshop.com/orders/checkout_session_123",
    "status": "created",
    "refunds": []
  }
}

// order_update event (state changes after creation: shipped, refunded, etc.)
{
  "type": "order_update",
  "data": {
    "type": "order",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://www.testshop.com/orders/checkout_session_123",
    "status": "shipped",
    "refunds": [ { "type": "original_payment", "amount": 100 } ]
  }
}
```

Detection MUST match all three shapes (completion response, `order_create`, `order_update`).

#### 1.7.2 UCP (Universal Commerce Protocol)

UCP is the open standard published at `github.com/universal-commerce-protocol/ucp`. As of UCP version `2026-01-11`, the on-wire shape of a UCP checkout completion response is identical to ACP's, with one structural addition: a top-level `ucp` envelope carrying the protocol version and capability list. Detection MUST therefore use the presence of `ucp.version` to distinguish UCP from ACP when both produce a `status: "completed"` payload.

```jsonc
// POST /checkout-sessions/{id}/complete success response (UCP)
{
  "ucp": {
    // distinguishes UCP from ACP
    "version": "2026-01-11",
    "capabilities": [{ "name": "dev.ucp.shopping.checkout", "version": "2026-01-11" }],
  },
  "id": "chk_123456789",
  "status": "completed", // detection signal (same as ACP)
  "currency": "USD",
  "order": {
    "id": "ord_99887766",
    "permalink_url": "https://merchant.com/orders/ord_99887766",
  },
  "buyer": { "...": "..." },
  "line_items": ["..."],
  "totals": ["..."],
}
```

UCP does not yet expose a documented free-form metadata field for arbitrary agent context. The `context_id` MUST travel via the `X-atrib-Context` HTTP header on UCP checkout requests, and via `params._meta.atrib` for any MCP-transport UCP integrations.

#### 1.7.3 x402

x402 is the Coinbase open payment protocol published at `github.com/coinbase/x402`. It uses HTTP 402 / 200 request-response cycles. The transaction event is the HTTP 200 response containing a **`PAYMENT-RESPONSE`** header (x402 v2), or the legacy **`X-PAYMENT-RESPONSE`** header (x402 v1, deprecated per RFC 6648 but still in deployment). Detection MUST accept both names case-insensitively.

The header value is base64-encoded JSON containing a `SettlementResponse` object: `{ success, transaction, network, payer, requirements }`. atrib treats header presence as the on-wire detection signal; the body is not decoded for detection purposes (decoding is appropriate when extracting `transaction` or `payer` for content_id derivation in higher-fidelity downstream tooling).

The agent MUST include the context_id as a custom header on the outbound payment request:

```
// Outbound x402 v2 payment request:
GET /paid-resource HTTP/1.1
PAYMENT-SIGNATURE: <base64 JSON>     // v2 (v1 used X-PAYMENT)
X-atrib-Context: 4bf92f3577b34da6a3ce929d0e0e4736

// 200 success response with the transaction signal:
HTTP/1.1 200 OK
PAYMENT-RESPONSE: <base64 JSON>      // v2 detection header
Content-Type: application/json

// The receiving server reads X-atrib-Context and includes it in the
// transaction record it writes to the atrib log. If the server does
// not have atrib installed, the context is present in the request
// for future retrieval from proxy logs.
```

#### 1.7.4 MPP (Machine Payments Protocol)

MPP is a separate protocol from x402, also built on HTTP 402, formally specified in IETF `draft-ryan-httpauth-payment-01` ("The 'Payment' HTTP Authentication Scheme") authored by engineers from Tempo Labs and Stripe and launched in March 2026. MPP uses the standard HTTP authentication scheme with `WWW-Authenticate: Payment` challenges and `Authorization: Payment` credentials.

The transaction event is the HTTP 200 response containing a **`Payment-Receipt`** header (per draft §5.3). The header value is base64url-nopad JSON with the required fields `{ status: "success", method, timestamp, reference }`. The draft specifies: _"Servers MUST NOT return a Payment-Receipt header on error responses,"_ so header presence is a reliable detection signal.

**`PAYMENT-RESPONSE` (x402) and `Payment-Receipt` (MPP) are different headers for different protocols.** Earlier drafts of this specification incorrectly attributed `Payment-Receipt` to both protocols; this has been corrected after verification against the published x402 docs and the IETF MPP draft.

The `context_id` MUST travel in the same `X-atrib-Context` custom header used for x402:

```
// MPP payment retry request (after fulfilling the WWW-Authenticate: Payment challenge):
GET /paid-resource HTTP/1.1
Authorization: Payment <credential>
X-atrib-Context: 4bf92f3577b34da6a3ce929d0e0e4736

// 200 success response with the MPP transaction signal:
HTTP/1.1 200 OK
Payment-Receipt: <base64url-nopad JSON>     // MPP detection header
Cache-Control: private                      // required by draft §5.3
Content-Type: application/json

// For MCP transport (draft-payment-transport-mcp-00):
// The context_id travels in params._meta as defined in §1.5.4
// The MPP payment-completed message carries it in the task metadata.
```

#### 1.7.5 AP2 and a2a-x402

AP2 (Agent Payments Protocol) is Google's open protocol at `github.com/google-agentic-commerce/ap2`, version v0.1, extension URI `https://github.com/google-agentic-commerce/ap2/tree/v0.1`. **AP2 v0.1 does NOT use W3C Verifiable Credentials.** Earlier drafts of this specification assumed it would; that assumption was incorrect. The real wire format is an A2A (Agent2Agent) Message with a DataPart whose `data` object contains the key `ap2.mandates.PaymentMandate`.

The PaymentMandate is the transaction event. (`IntentMandate` and `CartMandate` represent earlier funnel stages, intent capture and cart commitment respectively, and MUST NOT be detected as transaction events.) Implementations SHOULD embed the `context_id` in the agent extension fields where supported by the host A2A implementation; until AP2 standardizes a metadata field for it, the `context_id` MUST also travel via `params._meta.atrib` per §1.5.2, §1.5.3, and §1.5.3.1.

```jsonc
// AP2 v0.1 PaymentMandate Message (A2A DataPart shape)
// Source: github.com/google-agentic-commerce/ap2 docs/specification.md
{
  "messageId": "b5951b1a-8d5b-4ad3-a06f-92bf74e76589",
  "contextId": "sample-payment-context",
  "taskId": "sample-payment-task",
  "role": "user",
  "parts": [
    {
      "kind": "data",
      "data": {
        "ap2.mandates.PaymentMandate": {
          // detection signal
          "payment_details": {
            "cart_mandate": "<user-signed hash>",
            "payment_request_id": "order_shoes_123",
            "merchant_agent_card": { "name": "MerchantAgent" },
            "payment_method": { "supported_methods": "CARD", "data": { "token": "xyz789" } },
            "amount": { "currency": "USD", "value": 120.0 },
            "risk_info": { "device_imei": "abc123" },
            "display_info": "<image bytes>",
          },
          "creation_time": "2025-08-26T19:36:36.377022Z",
        },
      },
    },
  ],
}
```

**a2a-x402** (`github.com/google-agentic-commerce/a2a-x402`) is the AP2 extension for crypto payments via x402. When the merchant agent settles a payment on-chain it returns an A2A task whose `status.message.metadata` carries `x402.payment.status: "payment-completed"` and a `x402.payment.receipts` array with at least one entry where `success: true`. atrib reports this as `protocol: 'AP2'` because a2a-x402 IS the AP2 crypto path; it is not a separate protocol.

```jsonc
// a2a-x402 payment-completed task message
// Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
{
  "kind": "task",
  "id": "task-123",
  "status": {
    "state": "working",
    "message": {
      "kind": "message",
      "role": "agent",
      "parts": [{ "kind": "text", "text": "Payment successful." }],
      "metadata": {
        "x402.payment.status": "payment-completed", // first detection signal
        "x402.payment.receipts": [
          {
            "success": true, // second detection signal
            "transaction": "0xabc123def456",
            "network": "base",
            "payer": "0xPAYER...",
          },
        ],
      },
    },
    "artifacts": [],
  },
}
```

Detection MUST require BOTH the `payment-completed` status AND at least one receipt with `success: true`. A task that says "payment-completed" but contains only `success: false` receipts represents a failed settlement and is NOT a transaction event.

For backward compatibility with research forks of AP2 that may have implemented Payment Mandates as W3C Verifiable Credentials (matching the obsolete spec language), atrib's detector also accepts the legacy VC envelope shape:

```jsonc
// Legacy / non-canonical: VC-wrapped PaymentMandate (research forks only)
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "PaymentMandateCredential"],   // v2 array form
  "credentialSubject": { "io.atrib/context_id": "..." }
}

// Or v1 string form:
{
  "type": "VerifiableCredential",
  "credentialSubject": { "type": "PaymentMandate" }
}
```

Implementations MAY skip the legacy fallback if they target only AP2 v0.1 deployments.

---

### 1.8 Known Limitations

The following limitations are acknowledged and explicitly deferred.

**Cross-session attribution.** When a user receives a recommendation from an agent and subsequently completes a purchase in a browser session (minutes, hours, or days later) the transaction carries no attribution chain. The agent session that produced the recommendation and the browser session that completed the purchase are structurally disconnected. A partial mitigation is available via recommendation tokens: opaque identifiers the agent embeds in recommendation URLs, which a merchant can capture on conversion. This is closer to affiliate attribution than provenance and carries the same limitations. A first-class solution requires persistent agent identity across sessions, which depends on work in progress at the DIF Trusted AI Agents Working Group and W3C AI Agent Protocol CG. This is a v2 integration target.

**Log federation.** In v1, all attribution records for a session should be submitted to the same log operator to enable complete graph queries. If contributing tools submit to different log operators, a query against one log will return an incomplete graph. A federation protocol (allowing log operators to reference each other's records via inclusion proof pointers) is deferred to v2 and will be defined in a future revision of this specification.

**Key rotation.** Ed25519 keypairs in v1 are treated as stable. There is no formal key rotation mechanism. Creators who need to rotate keys should issue a publicly-attested key rotation document linking old and new keys. A normative key rotation mechanism will be specified in a future revision.

**Policy versioning.** Attribution policies (§3) will evolve. The rules for evaluating records under a historical policy version will be specified when the policy format is defined. In v1, policy evaluation is assumed to use the current active policy.

**Dispute mechanism.** There is no formal protocol for a creator to dispute their attribution share. Disputes in v1 are handled out-of-band. A structured dispute and counter-claim mechanism will be specified in v2.

#### Interoperability Roadmap

atrib is designed to complement, not compete with, existing standards work in identity, provenance, and agent trust. The following integration points are planned for v2 and inform architectural decisions in v1.

**DIF Trusted AI Agents Working Group.** DIF's Trusted AI Agents WG is defining identity, delegation, and accountability frameworks for autonomous agents. The persistent agent identity across sessions that their work will provide is the prerequisite for atrib's cross-session attribution (the recommendation_token mechanism). atrib's Ed25519 creator keys are a deliberate simplification of what will eventually be expressible as agent-scoped Verifiable Credentials with delegation chains. The v2 key management revision will define how atrib keys can be presented as DIF-compatible Verifiable Presentations.

**DIF Creator Assertions Working Group.** DIF's Creator Assertions WG is defining content authenticity and provenance assertions, including how assertions are consumed by automated systems and agents. atrib attribution records are structurally compatible with DIF assertion formats; both use Ed25519 signing over canonical JSON. A v2 interoperability profile will define how an atrib attribution record can be wrapped as a DIF Creator Assertion, enabling attribution data to flow through systems that already consume the DIF format.

**C2PA (Coalition for Content Provenance and Authenticity).** C2PA defines cryptographic provenance manifests for media content. atrib extends this pattern to agent interactions, where the "content" is a tool call, not a photograph. A v2 integration will define how atrib attribution records can be embedded in C2PA manifests as consequence assertions, completing the loop that C2PA opened (provenance at creation) by adding the economic outcome that C2PA never addressed (provenance through to value capture).

**W3C AI Agent Protocol Community Group.** The emerging work on standardizing agent-to-agent communication protocols is a natural home for atrib context propagation. The v1 propagation mechanism (`params._meta.atrib` in MCP, `tracestate` in HTTP) is designed to be portable to any agent protocol that supports metadata propagation.

---

## §2 Merkle Log Protocol

_Commitment, not content. The append-only transparency log for attribution records._

The append-only transparency log where attribution records are committed, making them globally verifiable without exposing their content.

Contents

- [2.1 Purpose and Design Rationale](#21-purpose-and-design-rationale)
- [2.2 Log Identity and Parameters](#22-log-identity-and-parameters)
- [2.3 Log Entry Format](#23-log-entry-format)
  - [2.3.1 Entry serialization](#231-entry-serialization)
  - [2.3.2 Leaf hash computation](#232-leaf-hash-computation)
- [2.4 Checkpoint Format](#24-checkpoint-format)
  - [2.4.1 Body structure](#241-body-structure)
  - [2.4.2 Log signing key and key ID](#242-log-signing-key-and-key-id)
  - [2.4.3 Signed note format](#243-signed-note-format)
- [2.5 Tile API (Read Interface)](#25-tile-api-read-interface)
  - [2.5.1 Checkpoint endpoint](#251-checkpoint-endpoint)
  - [2.5.2 Tile endpoints](#252-tile-endpoints)
  - [2.5.3 Entry bundle endpoint](#253-entry-bundle-endpoint)
- [2.6 Submission API (Write Interface)](#26-submission-api-write-interface)
  - [2.6.1 Submit entry](#261-submit-entry)
  - [2.6.2 Inclusion proof response](#262-inclusion-proof-response)
- [2.7 Inclusion Proof Verification](#27-inclusion-proof-verification)
- [2.8 Proof Bundle Format](#28-proof-bundle-format)
- [2.9 Witnessing and Cosignatures](#29-witnessing-and-cosignatures)
- [2.10 What the Log Stores and What It Does Not](#210-what-the-log-stores-and-what-it-does-not)

### 2.1 Purpose and Design Rationale

The atrib log is a public, append-only Merkle tree. When a creator submits an attribution record to the log, they receive an inclusion proof: a cryptographic commitment that the record exists at a specific position in the tree, verifiable by any third party without trusting the log operator.

The log enforces two properties that are the foundation of atrib's trust model:

**Tamper evidence.** Any modification, deletion, or reordering of a committed record would invalidate the root hash. The tree is append-only: new records may be added, but no existing record may be altered or removed. The log operator cannot secretly change history.

**Accountability without content exposure.** The log stores hashes and commitments, not content. A third party can verify that a record was committed at a specific time without reading what the record contains. Privacy and auditability are structurally separated: the log proves existence and integrity; the content remains with the creator.

The log is built on the tlog-tiles specification (c2sp.org/tlog-tiles), which defines an efficient HTTP-based read interface used by Certificate Transparency logs and the Tessera library (github.com/transparency-dev/tessera). `log.atrib.io` is a Tessera-based personality. Any operator may run a compatible log using Tessera; the open specification ensures that client implementations are not tied to atrib's log infrastructure.

---

### 2.2 Log Identity and Parameters

A tiled transparency log is identified by three parameters:

| Parameter      | Value for log.atrib.io                  | Description                                                                                                                 |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| URL prefix     | https://log.atrib.io/v1                 | The base URL from which all log endpoints are served.                                                                       |
| Origin         | log.atrib.io/v1                         | The scheme-less URL prefix. Used as the first line of every checkpoint. Uniquely identifies this log instance globally.     |
| Log public key | Published at log.atrib.io/v1/log-pubkey | The Ed25519 public key used to sign checkpoints. Distributed as a verifier key (vkey) string per the C2SP signed-note spec. |

Log operators running compatible logs MUST use a unique origin matching their URL prefix, and MUST publish their log public key at a stable, documented URL.

**Note (Log versioning):** The `/v1` path component in the URL prefix and origin is the log version, not the atrib spec version. When the log's entry format requires a breaking change, a new origin (`log.atrib.io/v2`) will be used rather than modifying the existing log. Existing entries in `log.atrib.io/v1` will remain accessible indefinitely.

---

### 2.3 Log Entry Format

Each entry in the atrib log is a **commitment** to an attribution record, not the record itself. The log stores the minimum information required for verification: a hash of the record, the creator's public key, and the context_id. This is sufficient to prove that a signed attribution record for a given creator and session existed at a specific point in time, without revealing the record's content.

#### 2.3.1 Entry Serialization

A log entry is a fixed-structure binary message. It MUST be serialized as follows:

```
struct AtribLogEntry {
  u8  version;         // 0x01, entry format version
  u8  record_hash[32]; // SHA-256 of the JCS-canonical attribution record (with signature)
  u8  creator_key[32]; // raw 32-byte Ed25519 public key
  u8  context_id[16];  // raw 16 bytes decoded from the 32-char hex context_id
  u64 timestamp_ms;    // big-endian Unix milliseconds, matching the record's timestamp field
  u8  event_type;      // 0x01 = tool_call, 0x02 = transaction
}
// Total: 1 + 32 + 32 + 16 + 8 + 1 = 90 bytes
```

All multi-byte integers are big-endian. The `record_hash` is computed over the _complete_ attribution record including its `signature` field, after JCS serialization. This binds the commitment to the specific signed record, not just its pre-signature content.

#### 2.3.2 Leaf Hash Computation

Log entry hashes are computed per RFC 6962, Section 2.1 (the same algorithm used by Certificate Transparency). A leaf hash is:

```
leaf_hash = SHA-256(0x00 || entry_bytes)

// The 0x00 byte is a domain separation prefix defined by RFC 6962.
// Internal node hashes use 0x01 prefix:
node_hash = SHA-256(0x01 || left_child_hash || right_child_hash)
```

These are the hashes stored in the tiles served by the tile API. Any client that fetches the tiles can reconstruct the full Merkle tree and independently compute inclusion and consistency proofs.

---

### 2.4 Checkpoint Format

The log's state at any moment is summarized in a **checkpoint**: a signed statement of the tree's current size and root hash. Checkpoints follow the C2SP tlog-checkpoint specification (c2sp.org/tlog-checkpoint).

#### 2.4.1 Body Structure

A checkpoint body is a UTF-8 text block with exactly three mandatory lines followed by a newline, formatted as follows:

```
log.atrib.io/v1                                    ← origin line (matches §2.2)
4821937                                             ← tree size (decimal, no leading zeros)
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=      ← root hash (standard base64, 44 chars)
                                                    ← mandatory trailing newline
```

The root hash is the SHA-256 Merkle Tree Hash (RFC 6962, Section 2.1) of all entries up to the stated tree size, encoded in standard base64 (RFC 4648 §4, with padding).

#### 2.4.2 Log Signing Key and Key ID

The log signs checkpoints with its Ed25519 private key. The key ID embedded in the signature line is derived per the C2SP signed-note specification:

```
key_id = SHA-256(
  key_name || 0x0A ||  // key_name is the origin string; 0x0A is newline
  0x01     ||          // signature type byte for Ed25519
  log_public_key_bytes // raw 32-byte Ed25519 public key
)[:4]                   // truncated to 4 bytes

// For log.atrib.io/v1:
key_name = "log.atrib.io/v1"
```

The verifier key string published at `log.atrib.io/v1/log-pubkey` encodes the key name, key ID, and public key in the C2SP vkey format:

```
// vkey format: +hex(key_id)+base64(sig_type_byte || public_key)
log.atrib.io/v1+a3b2c1d0+AQ...base64encodedpublickey...==
// "AQ" is base64(0x01), the Ed25519 signature type byte
```

#### 2.4.3 Signed Note Format

The complete checkpoint (body plus signatures) is a signed note per the C2SP signed-note specification (c2sp.org/signed-note). The note has the checkpoint body as its text, followed by one or more signature lines:

```
log.atrib.io/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.io/v1 a3b2c1d0+base64(Ed25519-signature-over-body)
— witness.example.com e1f2a3b4+base64(cosignature)
```

Each signature line begins with `— ` (U+2014 em-dash followed by a space in the canonical format), followed by the key name, a space, the hex key ID, a `+`, and the base64-encoded 64-byte signature over the note text (the body including its trailing newline).

Clients MUST verify at least the log's own signature on any checkpoint before trusting it. Cosignatures from witnesses are additional trust anchors; their verification procedure is described in §2.9.

---

### 2.5 Tile API (Read Interface)

The log's read interface serves static resources over HTTP, following the C2SP tlog-tiles specification. All read endpoints are cacheable. Clients can compute any desired proof by fetching the relevant tiles in parallel without a dynamic proof API.

#### 2.5.1 Checkpoint Endpoint

```
GET https://log.atrib.io/v1/checkpoint

Response:
Content-Type: text/plain; charset=utf-8
Cache-Control: max-age=5  // mutable; checkpoint advances as entries are added

// Body: signed note as defined in §2.4.3
```

Clients SHOULD not cache the checkpoint beyond 5 seconds. Monitoring clients that tail the log MUST verify consistency between successive checkpoints using the tile data to confirm the log is append-only.

#### 2.5.2 Tile Endpoints

Merkle tree hashes are served as tiles: concatenated sequences of 32-byte SHA-256 hashes. Full tiles contain exactly 256 hashes (8,192 bytes). Partial tiles contain 1–255 hashes and are served at the rightmost edge of each tree level.

```
// Full tile:
GET https://log.atrib.io/v1/tile/<L>/<N>

// Partial tile:
GET https://log.atrib.io/v1/tile/<L>/<N>.p/<W>

// <L>: level (0 = leaf hashes, 1+ = internal nodes), decimal, no leading zeros
// <N>: tile index, zero-padded into 3-digit path elements:
//      index 1234567 → x001/x234/567
// <W>: partial tile width (1–255), decimal, no leading zeros

Response:
Content-Type: application/octet-stream
Cache-Control: max-age=31536000, immutable  // full tiles are immutable
// Body: <W> × 32 bytes of SHA-256 hashes, concatenated
```

#### 2.5.3 Entry Bundle Endpoint

Log entries are served as entry bundles at the level-0 path. Each bundle contains entries in sequence, each prefixed with a big-endian uint16 length.

```
GET https://log.atrib.io/v1/tile/entries/<N>
GET https://log.atrib.io/v1/tile/entries/<N>.p/<W>

Response:
Content-Type: application/octet-stream
Content-Encoding: gzip  // SHOULD be compressed
Cache-Control: max-age=31536000, immutable

// Body: sequence of length-prefixed entries:
struct EntryBundle {
  struct LengthPrefixedEntry entries[];  // until end of bundle
}
struct LengthPrefixedEntry {
  u16 length;    // big-endian, length of entry_bytes
  u8  entry_bytes[length];  // AtribLogEntry (§2.3.1), always 90 bytes in v1
}
```

**Note (Entry bundle size):** In v1, every AtribLogEntry is exactly 90 bytes, so every uint16 length prefix in an entry bundle will be `0x00 0x5A` (90 in big-endian). Clients MAY rely on this fixed size as a consistency check; future spec versions that change the entry size will use a new log origin.

Tile API error responses:
- 404 Not Found: the requested tile, entry bundle, or checkpoint does not exist (e.g., tile coordinates beyond the current tree)
- 400 Bad Request: malformed path (non-numeric level or index)

---

### 2.6 Submission API (Write Interface)

The write interface accepts attribution records and returns inclusion proofs. This API is distinct from the read interface: it requires a valid, verifiable attribution record and returns a proof that the commitment was added to the log.

#### 2.6.1 Submit Entry

```
POST https://log.atrib.io/v1/entries
Content-Type: application/json
X-atrib-Priority: normal              // optional, see below

// Request body: a complete, signed attribution record (§1.2), bare,
// not wrapped in any envelope object.
{
  "spec_version": "atrib/1.0",
  "content_id":   "sha256:3f8a2b...",
  "creator_key":  "ABC...",
  "chain_root":   "sha256:7e1f4a...",
  "event_type":   "tool_call",
  "context_id":   "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp":    1743850000000,
  "signature":    "XYZ..."
}
```

The request body MUST be the bare JCS-canonical signed record exactly as defined in §1.2; there is no enclosing wrapper object, and no field may be added or removed by the client during transport. The body bytes MUST be the same bytes that were signed (modulo whitespace, since `Content-Type: application/json` does not require canonical re-serialization on the wire; it is the receiver's responsibility to re-canonicalize before signature verification per §1.4.3).

`X-atrib-Priority` is an OPTIONAL HTTP-level extension to the wire format. When present, its value MUST be one of `"high"` or `"normal"`. The semantics are:

- `"high"`: the submitting client believes this record is on the critical path of an attribution chain that needs to be queryable promptly (per §5.3.5, transaction records are sent with `priority: "high"` so they are admitted before any pending `tool_call` records when the log's admission queue is congested).
- `"normal"`: best-effort submission. This is the default when the header is absent.

Logs MAY use this header to order admission when their ingestion capacity is finite, but MUST NOT use it to reject entries (a log that consistently rejects "normal" priority submissions is misbehaving). Logs MAY ignore the header entirely. The header is non-normative for log correctness; it is purely an admission-control hint that lets a congested log preserve transaction-record latency under load.

The log MUST perform the following validation before accepting an entry:

Step 1: Verify the attribution record's Ed25519 signature per §1.4.3. Reject if verification fails with `400 Bad Request`.

Step 2: Verify that `spec_version` is `"atrib/1.0"`. Reject with `400` if not.

Step 3: Verify that `event_type` is a known value. Reject with `400` if not.

Step 4: Verify that `timestamp` is not more than 10 minutes in the future (a more permissive window than client-side verification to account for clock skew). Reject with `400` if so.

Step 5: Verify that `context_id` is exactly 32 lowercase hex characters. Reject with `400` if not.

Step 6: Check for a duplicate: if an entry with the same `record_hash` already exists in the log, return the existing inclusion proof with `200 OK` rather than `409 Conflict`. Idempotent submission is required to handle retries safely.

#### 2.6.2 Inclusion Proof Response

On successful submission or duplicate detection, the log returns a proof bundle:

```
// Response: 200 OK
Content-Type: application/json

{
  "log_index":       4821936,           // zero-based index in the log
  "checkpoint":      "log.atrib.io/v1\n4821937\nCsUY...=\n\n— log.atrib.io/v1 ...",
  "inclusion_proof": [
    "gSKyXoYZUgZ6jduW...",   // base64-encoded SHA-256 sibling hashes
    "B95lDa8R83lS8n0e...",   // from leaf level up to root
    "EKNzoDWG8LGC0Yp9..."
  ],
  "leaf_hash":       "AHCioX9nLjsrse6Y..."   // SHA-256(0x00 || entry_bytes)
}

// All hashes are standard base64 (RFC 4648 §4, with padding).
```

Clients MUST verify the inclusion proof before treating the record as committed. The verification procedure is specified in §2.7.

**Security (Do not trust without verification):** A response from the submission API proves only that the log accepted the entry. It does not prove that the log is behaving correctly. Clients MUST verify the checkpoint signature and compute the inclusion proof independently using the tile data to establish that the log has not served a fabricated proof. Trusting unverified inclusion proofs defeats the tamper-evidence property.

---

### 2.7 Inclusion Proof Verification

An inclusion proof demonstrates that a specific entry is at a specific position in the tree described by a checkpoint. Verification is performed locally using only the entry data and the hashes in the proof; no trust in the log server is required beyond the checkpoint signature.

To verify an inclusion proof, an implementation MUST:

Step 1: Verify the checkpoint's Ed25519 signature using the log's published public key (§2.4.2). Reject if verification fails.

Step 2: Verify that the checkpoint's tree size is greater than the claimed `log_index`.

Step 3: Recompute the leaf hash from the local entry data:

```
entry_bytes = serialize(AtribLogEntry)          // §2.3.1
leaf_hash   = SHA-256(0x00 || entry_bytes)      // RFC 6962 leaf prefix
```

Step 4: Verify that the recomputed `leaf_hash` matches the `leaf_hash` in the proof response.

Step 5: Compute the root hash by applying the inclusion proof path from the leaf up to the root. The left/right placement at each level is determined by the RFC 6962 tree decomposition (split at the largest power of 2 strictly less than the current subtree size), NOT by `index % 2`. The `index % 2` shortcut is only correct for power-of-2 trees and produces wrong results for odd-sized trees:

```
function verifyInclusion(index, treeSize, leafHash, proof):
  // Collect the (index, subtreeSize) path from root to leaf
  path = []
  idx = index; sz = treeSize
  while sz > 1:
    path.append((idx, sz))
    k = largestPowerOfTwoLessThan(sz)
    if idx < k:
      sz = k                    // descend into left subtree
    else:
      idx = idx - k; sz = sz - k // descend into right subtree

  // Reverse to get leaf-to-root order matching the proof array
  path.reverse()

  hash = leafHash
  for i in 0..proof.length:
    (pathIdx, pathSz) = path[i]
    k = largestPowerOfTwoLessThan(pathSz)
    if pathIdx < k:              // target is in left subtree
      hash = SHA-256(0x01 || hash || proof[i])
    else:                        // target is in right subtree
      hash = SHA-256(0x01 || proof[i] || hash)
  return hash
```

Step 6: Verify that the computed root hash matches the root hash in the checkpoint body.

If all six steps succeed, the entry is genuinely present in the log at the stated position. Failure at any step indicates either log misbehavior or a corrupted proof.

---

### 2.8 Proof Bundle Format

A proof bundle is a self-contained, offline-verifiable document that a creator can attach to an attribution record as evidence of its log commitment. It follows the C2SP tlog-proof specification (c2sp.org/tlog-proof).

```
// Proof bundle (text format, stored as .tlog-proof file):
c2sp.org/tlog-proof@v1
index 4821936
gSKyXoYZUgZ6jduWYrkDOARinOMGJveXjgMkBTcdPlQ=
B95lDa8R83lS8n0eG+o0buTxRKQTYFi//1U8anccXmA=
EKNzoDWG8LGC0Yp9o+sv3qllpMP9uHQ9B20KNL+Q1zs=

log.atrib.io/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.io/v1 a3b2c1d0+base64signature
— witness.example.com e1f2a3b4+cosignature

// Format: tlog-proof header, empty line, inclusion proof hashes (one per line),
// empty line, full checkpoint (body + signature lines).
// All hashes: standard base64 with padding.
// Proof bundles SHOULD be stored alongside the attribution record.
```

A proof bundle is sufficient to verify log commitment offline given only the log's origin (`log.atrib.io/v1`) and its trusted public key. No network request is required for verification after the bundle is obtained.

Implementations SHOULD store proof bundles alongside attribution records. The `@atrib/mcp` SDK SHOULD return the proof bundle as part of the record submission response and cache it locally for at least the duration of the active session.

---

### 2.9 Witnessing and Cosignatures

A checkpoint signed only by the log operator proves tamper-evidence within the log's own view. A **witness** is an independent party that verifies the log's append-only behavior and adds a cosignature to the checkpoint, making split-view attacks detectable.

Witnesses follow the C2SP tlog-witness specification (c2sp.org/tlog-witness). When the log produces a new checkpoint, it submits it to its configured witnesses with a consistency proof from the previous checkpoint. Each witness verifies consistency and returns a timestamped cosignature (C2SP tlog-cosignature spec).

A cosignature is a statement by the witness that, as of the given time, the log has been correctly append-only up to the stated tree size. It is an Ed25519 signature over a structured message that includes the checkpoint body and a timestamp:

```
// Cosignature signed message:
cosignature/v1\n
time \n
\n    // the full three-line checkpoint body

// The signature is a 72-byte struct:
struct timestamped_signature {
  u64 timestamp;     // POSIX seconds (big-endian)
  u8  signature[64]; // Ed25519 signature over the message above
}
```

Clients that require strong tamper-evidence guarantees SHOULD require at least one witness cosignature before trusting an inclusion proof. atrib's SDK SHOULD ship with a default witness policy of one cosignature from a publicly documented witness operated independently of atrib.

The witnessing infrastructure used by `log.atrib.io` will be publicly documented including witness names and public keys. Third parties are encouraged to run compatible witnesses using the transparency-dev ecosystem tooling.

---

### 2.10 What the Log Stores and What It Does Not

This section states the privacy properties of the log precisely, because they are the foundation of atrib's claim to be "observability without surveillance."

**The log stores:** the record hash, the creator's public key, the context_id (as raw bytes), the timestamp, and the event type. These are committed in the AtribLogEntry (§2.3.1) and are visible to any party that fetches entry bundles.

**The log does not store:** the content of tool calls, the content of agent responses, the user's identity, the merchant's product data, the amounts of transactions, or any payload that is not listed in the AtribLogEntry structure above.

**What this means in practice:** A party who fetches all entries from the log learns which creator keys were active, in which sessions (context_ids), at what times, and what type of events they recorded. They do not learn what those tools did, what was returned, who the user was, or what was purchased. The attribution graph connects records to transactions only when the merchant writes their own transaction record, and only the merchant knows the transaction details.

The `context_id` is visible in the log and is the same value used in OTel traces. Implementers who wish to prevent correlation between log entries and OTel traces MAY generate a separate log context_id derived from but not equal to the OTel trace-id, at the cost of making independent audit harder. The default is to use the OTel trace-id directly.

**Note (Creator key pseudonymity):** Creator public keys are stable identifiers visible in the log. A party who observes a creator's public key across multiple entries can infer that the same creator was active across those sessions. Creators who require stronger unlinkability across sessions may generate per-session keypairs, but doing so forfeits the ability to accumulate attribution weight under a single identity. This tradeoff is a design choice for each creator, not a protocol decision.

---

## §3 Graph Query Interface

_Five edge types. Deterministic derivation. Fact layer only._

The data model and query API for turning attribution records into a structured provenance graph, the input to policy evaluation and settlement calculation.

Contents

- [3.1 Design Principles and Rationale](#31-design-principles-and-rationale)
- [3.2 Graph Data Model](#32-graph-data-model)
  - [3.2.1 Node types](#321-node-types)
  - [3.2.2 Interaction patterns and their structural signatures](#322-interaction-patterns-and-their-structural-signatures)
  - [3.2.3 Edge types](#323-edge-types)
  - [3.2.4 Edge derivation rules](#324-edge-derivation-rules)
  - [3.2.5 Gap nodes](#325-gap-nodes)
- [3.3 Verification State](#33-verification-state)
- [3.4 Query API](#34-query-api)
  - [3.4.1 GET /v1/graph/{context_id}](#341-get-v1graphcontext_id)
  - [3.4.2 GET /v1/graph/{context_id}/nodes](#342-get-v1graphcontext_idnodes)
  - [3.4.3 GET /v1/graph/{context_id}/transaction](#343-get-v1graphcontext_idtransaction)
  - [3.4.4 GET /v1/creators/{creator_key}/sessions](#344-get-v1creatorscreator_keysessions)
- [3.5 Response Schema](#35-response-schema)
  - [3.5.1 Graph response object](#351-graph-response-object)
  - [3.5.2 Node object](#352-node-object)
  - [3.5.3 Edge object](#353-edge-object)
  - [3.5.4 Error responses](#354-error-responses)
- [3.6 Implementation Notes](#36-implementation-notes)

### 3.1 Design Principles and Rationale

This section explains the reasoning behind the graph model's core design decisions. These are not preferences or conventions; they are the logical consequences of what a trust infrastructure can and cannot honestly assert. Understanding the reasoning matters as much as the rules themselves, because it determines how to evaluate proposed changes and extensions.

#### Why the graph records structure, not causality

The most natural instinct when building an attribution system is to encode causal relationships: "tool A influenced tool B which led to transaction T." This is what attribution means in common language and what settlement calculations ultimately need to reason about. So why doesn't the protocol encode it?

Because causality is always an inference, never a fact. A protocol can verify that event B occurred after event A in the same session, and that B's creator set their chain*root to the hash of A's record. It cannot verify that A \_caused* B, or that A's output was actually used, or that the agent's decision was influenced by A's result rather than something else entirely. Encoding a causal claim in a record that is signed and committed to an append-only log would mean committing an unverifiable assertion as if it were a verified fact. That is precisely what a trust infrastructure must not do.

The practical consequence is that edges in the atrib graph are derived from observable structure (chain linkage, shared session identifiers, timestamps) and express only what that structure shows. What those structural relationships _mean_ causally is an inference that the policy layer makes, with full visibility into the evidence and full accountability for the interpretation. If a merchant and a creator disagree about whether a contribution was causally significant, they are disagreeing about a policy judgment, not about a fact the protocol recorded incorrectly. That is the right place for the disagreement to live.

#### Why verification state is categorical, not numeric

An earlier design of this specification used a numeric confidence score (a decimal between 0.0 and 1.0) to represent how thoroughly a record had been verified. This was rejected for a specific reason: a number implies a ratio. If `log_committed` is 0.9 and `signature_valid` is 0.5, the number encodes the judgment that log commitment is worth roughly 1.8× a valid signature for attribution purposes. But whether that ratio is correct for any given policy is a business decision, not a protocol decision. Different merchants, different risk tolerances, different commercial contexts will weigh these differently.

By encoding verification status as a categorical enumeration (`unsigned`, `signature_valid`, `log_committed`, `witnessed`), the protocol reports a fact: what has been verified. The policy layer in §4 decides what each state is worth in the context of a specific attribution calculation. The protocol makes no claim about the relative value of the states beyond their strict ordering.

The same reasoning applies to gap nodes. Their `unsigned` state is a fact: no signature was present. Whether an unsigned contribution deserves zero weight, nominal weight, or some other treatment is a policy question. The protocol records the absence of a signature. It does not mandate what that absence means for settlement.

#### Why the graph is a strict fact layer

The fact/policy separation is not an architectural nicety; it is the mechanism that makes independent verification possible. For attribution to be trusted by both creators and merchants, each party must be able to independently verify two things: that the graph accurately reflects what happened (verifiable from the log data and the deterministic derivation rules), and that the settlement recommendation was correctly derived from that graph under the stated policy (verifiable by running the policy algorithm locally against the graph). If fact and policy were mixed into a single layer, this independent verification would require reimplementing both layers together, which is practically impossible for most parties.

The strict separation also makes the system auditable over time. If a settlement dispute arises, the question can be cleanly decomposed: "does the graph correctly represent the records?" and "was the policy correctly applied to this graph?" These are separable questions with separable answers. A merged layer produces a single opaque output where the source of any error is difficult to isolate.

#### The three principles restated as constraints

**The graph records structure, not causality.** Edges are derived from observable structure only. No edge type encodes a causal claim. Causal interpretation is performed by the policy layer.

**Verification state is categorical.** The four states (`unsigned`, `signature_valid`, `log_committed`, `witnessed`) describe what has been verified. Their relative weight for attribution purposes is not encoded in the protocol.

**The graph is a fact layer.** The graph query interface reports what the records show. It does not compute attribution weight, recommend distributions, or apply policy. The same graph can be evaluated under different policies by different parties, and any party can independently verify the result.

**Edge derivation is deterministic and normative.** Given the same set of attribution records, two independent implementations MUST produce identical graphs. The derivation rules in §3.2.4 are the normative definition. Any deviation is a nonconformance.

---

### 3.2 Graph Data Model

The atrib attribution graph is a directed property multigraph. Nodes represent events. Edges represent relationships derived from observable record structure. The graph for a primary session is bounded by its `context_id`, extended by cross-session links when records share the same `session_token` field (§1.2.1).

#### 3.2.1 Node Types

| Type        | Source                            | Description                                                                                                                                                                       |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool_call   | event_type = "tool_call"          | A creator's contribution to the session. Carries creator identity, tool identity, chain position, and timestamp. The primary subject of attribution.                              |
| transaction | event_type = "transaction"        | The commerce event that closes the attribution loop. The creator_key is the merchant's key. A session without a transaction node is attributable but not yet economically closed. |
| gap_node    | OTel span without a signed record | An unsigned hop. Present in the graph so that invisible contributions are visible. Carries no creator_key, chain_root, or signature. See §3.2.5.                                  |

#### 3.2.2 Interaction Patterns and Their Structural Signatures

Agent interactions produce five distinct structural patterns, each producing a distinct edge signature. Naming these patterns makes the edge taxonomy unambiguous.

**Sequential.** Agent calls tool A, then calls tool B whose creator sets `chain_root` to the hash of A's record. B is structurally downstream of A. Signature: CHAIN_PRECEDES A → B.

**Parallel.** Agent calls tool A and tool B in the same session with no chain dependency between them: either both are genesis records, or both descend from a common ancestor but not from each other. Signature: SESSION_PARALLEL A ↔ B (or SESSION_PRECEDES A → B if timestamps establish ordering).

**Temporal.** Tool A completed before tool B in the same session, but no chain linkage connects them. Ordering is observable but not structural. Signature: SESSION_PRECEDES A → B.

**Delegated.** Agent A dispatches sub-agent B via A2A. B's tools execute under the same `context_id` as A's session, because context_id propagates through A2A boundaries (§1.5.1). A's records and B's records are distinguishable by `creator_key`; different agent operators produce different keys. The delegation boundary is identified in the graph by creator_key diversity within a single session. No separate edge type is needed: standard within-session edges apply, and the policy layer reads creator_key to identify which contributions came from the primary agent versus delegated sub-agents.

**Convergent.** Multiple tool calls, potentially from different sessions, all contribute to the same transaction. Within a session: CONVERGES_ON edges from all non-transaction nodes to the transaction node. Across sessions: CROSS_SESSION edges when explicit linking tokens connect the records.

// Sequential: B.chain_root = hash(A) \[ A: tool_call \] ──CHAIN_PRECEDES──▶ \[ B: tool_call \] // Temporal: same session, no chain link, A.timestamp \< B.timestamp \[ A: tool_call \] ──SESSION_PRECEDES──▶ \[ B: tool_call \] // Parallel: same session, no chain link, no temporal ordering \[ A: tool_call \] ──SESSION_PARALLEL── \[ B: tool_call \] // Convergent within session: all nodes point to the transaction \[ A: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] \[ B: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] // Cross-session: A (ctx=X) contributed to T (ctx=Y) via session_token \[ A: tool_call (ctx=X) \] ──CROSS_SESSION──▶ \[ T: transaction (ctx=Y) \] // Delegated: same session, different creator_keys (A=primary agent, B=sub-agent) \[ A: tool_call (key=K1) \] ──SESSION_PRECEDES──▶ \[ B: tool_call (key=K2) \] // policy layer reads creator_key to identify the delegation boundary

#### 3.2.3 Edge Types

Five edge types are defined. All are derived deterministically from observable record structure. None encode causal claims.

| Edge type        | Dir   | Derivation basis                                                                                                                                 | Meaning                                                                                                                                                                                                                                                    |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAIN_PRECEDES   | A → B | B.chain_root = SHA-256(JCS(A))                                                                                                                   | B is structurally downstream of A in the attribution chain. B's creator explicitly set their chain_root by hashing A's complete signed record. This is the primary structural link.                                                                        |
| SESSION_PRECEDES | A → B | Same context_id; no CHAIN_PRECEDES between A and B; A.timestamp \< B.timestamp                                                                   | A occurred before B in the same session with no chain structure connecting them. Temporal ordering only, no structural claim.                                                                                                                             |
| SESSION_PARALLEL | A ↔ B | Same context_id; no CHAIN_PRECEDES between A and B; no temporal ordering                                                                         | A and B are co-contributors to the same session with neither chain structure nor observable temporal ordering between them. Undirected.                                                                                                                    |
| CONVERGES_ON     | N → T | N is any non-transaction node; T is a transaction node; both share context_id                                                                    | Node N contributed to the session that produced transaction T. Every non-transaction node in a session with a transaction node receives a CONVERGES_ON edge to that transaction. This is the edge that makes settlement calculation structurally possible. |
| CROSS_SESSION    | A → T | A is a tool_call node; T is a transaction node; different context_ids; A.session_token = T.session_token (both fields must be present and equal) | A contributed to a transaction that occurred in a different session. This edge is only created when both records carry the same explicit `session_token` field value. It is never inferred from timestamps, creator keys, or any other heuristic.          |

**Note (Mutual exclusivity):** CHAIN_PRECEDES and SESSION_PRECEDES are mutually exclusive between any given ordered pair of nodes: if a CHAIN_PRECEDES edge exists from A to B, no SESSION_PRECEDES edge is created between A and B in either direction. SESSION_PARALLEL and SESSION_PRECEDES are mutually exclusive between any given pair of nodes. CONVERGES_ON coexists with all within-session edge types. CROSS_SESSION only applies when context_ids differ and an explicit linking token is present.

#### 3.2.4 Edge Derivation Rules

These rules are normative. Implementations MUST apply them in the order given. Two implementations applying these rules to identical input records MUST produce identical edge sets.

**Step 1:** CHAIN_PRECEDES edges**

For each non-genesis record R: compute `expected = R.chain_root.removePrefix("sha256:")`. For each other record P: if `sha256_hex(jcs(P)) == expected`, create CHAIN_PRECEDES P → R. Each record has at most one CHAIN_PRECEDES parent (chain_root is a single value).

```
for each record R:
  if is_genesis(R): continue
  expected = R.chain_root.removePrefix("sha256:")
  for each other record P:
    if sha256_hex(jcs(P)) == expected:
      add_edge(CHAIN_PRECEDES, source=P, target=R); break
```

**Step 2:** SESSION_PRECEDES edges**

For each ordered pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction: if `A.timestamp < B.timestamp`, create SESSION_PRECEDES A → B. When timestamps are equal, use ascending log_index as the tiebreaker. If log_index is also equal (nodes in the same batch), skip; they are SESSION_PARALLEL candidates.

**Step 3:** SESSION_PARALLEL edges**

For each pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction and no SESSION_PRECEDES edge exists between them in either direction: create SESSION_PARALLEL A ↔ B (undirected).

**Step 4:** CONVERGES_ON edges**

For each transaction node T: for each other node N sharing T's context_id (tool_call or gap_node), create CONVERGES_ON N → T.

If a session contains multiple transaction nodes, each non-transaction node receives CONVERGES_ON edges to all of them. The calculation algorithm (§4.6) uses the first transaction node (by log_index) for modifier computations such as temporal_decay.

**Step 5:** CROSS_SESSION edges**

For each transaction node T: search the record set for tool_call nodes A where `A.context_id ≠ T.context_id` and A's `session_token` field (§1.2.1) matches T's `session_token` field. For each such A, create CROSS_SESSION A → T.

CROSS_SESSION edges MUST NOT be inferred from any heuristic. Only explicit `session_token` field matches in signed records qualify. Records without a `session_token` field cannot participate in CROSS_SESSION edges.

**Note (recommendation_token deferred to v2):** An earlier design considered a recommendation_token mechanism for linking agent recommendations to purchases that complete in a separate browser session (the "dark attribution" problem described in §1.8). This mechanism is not specified in v1 because it requires persistent agent identity across sessions, which depends on work in progress at the DIF Trusted AI Agents Working Group. Recommendation token support will be defined in a future revision of this specification.

#### 3.2.5 Gap Nodes

A gap node represents an unsigned hop: a tool call evidenced by an OTel span with no corresponding signed attribution record in the log. Its presence in the graph makes the gap visible rather than hiding it.

Gap nodes participate in SESSION_PRECEDES, SESSION_PARALLEL, and CONVERGES_ON edges. They MUST NOT participate in CHAIN_PRECEDES edges (no chain_root) or CROSS_SESSION edges (no linking tokens).

Gap node IDs are deterministic: `"gap:" + hex(SHA-256(UTF-8(tool_url + ":" + tool_name + ":" + context_id)))`. This ensures stable, reproducible IDs across independent implementations processing the same OTel data.

---

### 3.3 Verification State

Every node carries a `verification_state`: a categorical description of the current verification status of its underlying record. This is a fact about the record, not a judgment of its value. Policy evaluation uses verification state as input; this section defines only the states themselves.

| State           | Condition                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| unsigned        | Gap node. No signature exists. The event is known only from OTel span data.                                                                           |
| signature_valid | The record's Ed25519 signature (§1.4.3) verifies. The record has not yet been confirmed in the Merkle log.                                            |
| log_committed   | Signature verifies and an inclusion proof (§2.7) has been verified against a current signed checkpoint. The record is durably in the append-only log. |
| witnessed       | Signature verifies, inclusion proof verifies, and the checkpoint carries at least one valid witness cosignature (§2.9).                               |

Verification states are strictly ordered: `unsigned < signature_valid < log_committed < witnessed`. A node's state can only advance, never regress, as new evidence arrives. Implementations MUST update states as evidence is gathered. Verification states are computed by the graph query service from evidence in the log. They are never asserted by attribution records.

---

### 3.4 Query API

All endpoints are served at `https://graph.atrib.io/v1/`. All responses use `Content-Type: application/json`. All errors use RFC 9457 Problem Details (`Content-Type: application/problem+json`). The API is read-only.

#### 3.4.1 GET /v1/graph/{context_id}

Returns the complete attribution graph for a session: all nodes and edges, computed per §3.2.4.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736

// Optional query parameters:
// include_gap_nodes=true|false      (default: true)
// include_cross_session=true|false  (default: true)
// include_proof=true|false          (default: false; proof bundles are large)

// 200 OK  -> GraphResponse (§3.5.1)
// 404     -> no records with this context_id
// 400     -> malformed context_id (not 32 hex chars)
```

#### 3.4.2 GET /v1/graph/{context_id}/nodes

Returns only nodes, without edges. Used by policy engines that apply their own traversal logic.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736/nodes

// Optional: event_type=tool_call|transaction|gap_node
// Optional: creator_key=
// Optional: verification_state=unsigned|signature_valid|log_committed|witnessed

// 200 OK -> { "nodes": [NodeObject, ...] }
```

#### 3.4.3 GET /v1/graph/{context_id}/transaction

Returns the transaction node for a session if one exists. Policy engines use this to confirm the loop is closed before running settlement calculations.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736/transaction

// 200 OK  -> NodeObject (event_type: "transaction")
// 404     -> session exists but no transaction record present
```

#### 3.4.4 GET /v1/creators/{creator_key}/sessions

Returns a paginated list of sessions in which a given creator appears. Requires authentication proving control of the creator_key. The authentication mechanism is implementation-defined; the reference implementation uses Ed25519 challenge-response over the creator's public key.

```
GET /v1/creators/ABC.../sessions

// Optional: after=<ISO8601>, before=<ISO8601>, has_transaction=true|false
// Optional: limit= (default 50, max 200), cursor=

{
  "sessions": [
    {
      "context_id":     "4bf92f35...",
      "first_seen":     1743850000000,
      "last_seen":      1743850120000,
      "node_count":     4,
      "has_transaction": true
    }
  ],
  "next_cursor": "eyJhZnRlciI..."  // null if no further results
}
```

---

### 3.5 Response Schema

#### 3.5.1 Graph Response Object

```
{
  "spec_version":        "atrib/1.0",
  "context_id":          "4bf92f3577b34da6a3ce929d0e0e4736",
  "generated_at":        1743860000000,
  "node_count":          4,
  "edge_count":          6,
  "has_transaction":     true,
  "cross_session_count": 0,    // number of nodes linked via CROSS_SESSION edges
  "nodes": [ /* NodeObject[] */ ],
  "edges": [ /* EdgeObject[] */ ]
}
```

#### 3.5.2 Node Object

```
{
  "id":                  "sha256:3f8a2b...",  // record_hash from log; "gap:..." for gap nodes
  "event_type":          "tool_call",         // "tool_call" | "transaction" | "gap_node"
  "content_id":          "sha256:7e1f...",    // null for gap_node
  "creator_key":         "ABC...",            // null for gap_node
  "chain_root":          "sha256:9a3c...",    // null for gap_node
  "context_id":          "4bf92f35...",
  "timestamp":           1743850010000,
  "log_index":           4821936,            // null for gap_node
  "verification_state":  "log_committed",    // see §3.3
  "is_genesis":          false,              // true if chain_root = SHA-256(context_id)
  "proof":               null               // inclusion proof bundle (§2.8); null unless requested
}
```

#### 3.5.3 Edge Object

```
{
  "type":     "CHAIN_PRECEDES",    // one of the five defined types
  "source":   "sha256:3f8a2b...",  // source node id
  "target":   "sha256:8b2f1c...",  // target node id
  "directed": true                // false only for SESSION_PARALLEL
}
```

#### 3.5.4 Error Responses

```
// RFC 9457 Problem Details. All errors use this format:
{
  "type":     "https://atrib.io/problems/session-not-found",
  "title":    "Session not found",
  "status":   404,
  "detail":   "No attribution records found for context_id 4bf92f35...",
  "instance": "/v1/graph/4bf92f3577b34da6a3ce929d0e0e4736"
}
// Defined problem types:
// atrib.io/problems/session-not-found     404
// atrib.io/problems/invalid-context-id    400
// atrib.io/problems/invalid-creator-key   400
// atrib.io/problems/unauthorized          401
// atrib.io/problems/graph-unavailable     503
```

---

### 3.6 Implementation Notes

**Technology independence.** This section specifies the graph model and API shape. It does not specify storage technology. Any queryable store capable of producing conforming responses is acceptable. The derivation rules in §3.2.4 are the normative definition of graph structure and must be applied identically regardless of underlying storage.

**On delegated sub-agents.** When agent A delegates to sub-agent B via A2A, B's tool calls share A's `context_id` because context_id propagates through A2A delegation boundaries (§1.5.1). The graph represents this naturally: A's and B's records appear as nodes in the same session, distinguishable by `creator_key`. No special edge type is needed. Policy engines read creator_key diversity within a session to identify delegation structure and can weight contributions by originating agent accordingly.

**Graph construction from log data.** Implementations indexing the graph must monitor the log for new checkpoints (§2.5.1), fetch new entry bundles (§2.5.3), retrieve full attribution records from creator servers or a record cache, verify signatures, and apply the derivation rules incrementally. Records whose chain_root references a not-yet-seen parent should be stored and the CHAIN_PRECEDES edge created when the parent record arrives.

**The fact / policy boundary.** The graph query interface MUST NOT return weighted or policy-adjusted data. All attribution weights, distribution recommendations, and settlement calculations belong to §4. This separation is not a preference; it is the mechanism that makes independent settlement verification tractable. Any party must be able to run the graph construction algorithm on the log data and the policy algorithm on the graph, and arrive at the same settlement recommendation as the service produced, without trusting either layer.

---

## §4 Attribution Policy Format

_Machine-readable weights. Negotiation. Calculation algorithm._

The machine-readable document format for expressing how graph structure maps to value distribution, negotiated between creators and merchants before a session begins, applied to the completed graph after a transaction closes.

Contents

- [4.1 Purpose and Position in the Protocol](#41-purpose-and-position-in-the-protocol)
- [4.2 Policy Document Format](#42-policy-document-format)
  - [4.2.1 Top-level fields](#421-top-level-fields)
  - [4.2.2 Edge weights](#422-edge-weights)
  - [4.2.3 Modifiers](#423-modifiers)
  - [4.2.4 Distribution method](#424-distribution-method)
  - [4.2.5 Constraints](#425-constraints)
- [4.3 The Default Policy](#43-the-default-policy)
- [4.4 Publication and Discovery](#44-publication-and-discovery)
- [4.5 Session Negotiation](#45-session-negotiation)
  - [4.5.1 Negotiation protocol](#451-negotiation-protocol)
  - [4.5.2 Conflict resolution](#452-conflict-resolution)
  - [4.5.3 Session policy record](#453-session-policy-record)
- [4.6 The Calculation Algorithm](#46-the-calculation-algorithm)
  - [4.6.1 Inputs and preconditions](#461-inputs-and-preconditions)
  - [4.6.2 Step 1: Identify contributing nodes](#462-step-1-identify-contributing-nodes)
  - [4.6.3 Step 2: Compute raw scores](#463-step-2-compute-raw-scores)
  - [4.6.4 Step 3: Apply constraints](#464-step-3-apply-constraints)
  - [4.6.5 Step 4: Normalize to a distribution](#465-step-4-normalize-to-a-distribution)
  - [4.6.6 Step 5: Aggregate by creator](#466-step-5-aggregate-by-creator)
  - [4.6.7 Step 6: Apply creator floors](#467-step-6-apply-creator-floors)
- [4.7 Settlement Recommendation Document](#47-settlement-recommendation-document)
  - [4.7.1 Document format](#471-document-format)
  - [4.7.2 Signing the recommendation](#472-signing-the-recommendation)
  - [4.7.3 Independent verification](#473-independent-verification)
- [4.8 Known Limitations and V2 Deferrals](#48-known-limitations-and-v2-deferrals)

### 4.1 Purpose and Position in the Protocol

The three preceding sections define what happened. This section defines how to evaluate what happened for the purpose of distributing value.

Policies are first-class protocol primitives, not configuration files or implementation details. They are machine-readable documents that agents can fetch, parse, apply, and reason about autonomously. The spec defines the policy schema; creators and merchants define their own policies within that schema. The protocol defines how policies are negotiated and how the calculation is performed; it does not define what any contribution is worth.

Two moments in the session lifecycle are relevant to this section. **Negotiation** happens at session initialization, before any tool calls are made, the agent reads available creator and merchant policies and establishes the agreed policy for the session (§4.5). **Calculation** happens after the transaction closes, and the agreed policy is applied to the completed graph to produce a settlement recommendation (§4.6). These are distinct operations on distinct inputs separated in time. The policy negotiated at session start is the policy applied at calculation time, regardless of whether policies have changed in between.

---

### 4.2 Policy Document Format

A policy document is a JSON object. It MUST be UTF-8 encoded and served with `Content-Type: application/json`. It MUST be valid JSON conforming to the schema defined in this section. Unknown fields MUST be ignored by implementations to allow forward compatibility.

#### 4.2.1 Top-Level Fields

```
{
  "spec_version":  "atrib/1.0",          // REQUIRED. Must be "atrib/1.0" for v1 policies.
  "policy_id":     "https://example.com/.well-known/atrib-policy.json",
                                           // REQUIRED. Stable URL where this policy is published.
                                           // Used as the canonical identifier in session policy records.
  "role":          "creator",            // REQUIRED. "creator", "merchant", or "default".
  "edge_weights":  { /* §4.2.2 */ },     // REQUIRED.
  "modifiers":     [ /* §4.2.3 */ ],     // OPTIONAL. Default: no modifiers.
  "distribution":  "proportional",      // REQUIRED. See §4.2.4.
  "constraints":   { /* §4.2.5 */ }      // OPTIONAL. Default: no constraints.
}
```

#### 4.2.2 Edge Weights

Edge weights define the base score assigned to a node based on its structural relationship to the transaction. The key is an edge type from §3.2.3. The value is a non-negative decimal. Nodes may have multiple edges; if a node has edges of multiple types, its base score is the _maximum_ of the applicable edge weights, not their sum.

```
"edge_weights": {
  "CHAIN_PRECEDES":   1.0,  // node is structurally upstream in the attribution chain
  "SESSION_PRECEDES":  0.5,  // node preceded the transaction temporally, no chain link
  "SESSION_PARALLEL":  0.3,  // node co-occurred with no temporal ordering
  "CONVERGES_ON":      0.3,  // all non-transaction nodes have this; lowest-weight baseline
  "CROSS_SESSION":     0.7,  // node contributed from a different session via linking token
  "unsigned":          0.0   // gap nodes: no creator signature, no weight by default
}

// The numeric values above are illustrative only; they show the schema structure.
// They are not defaults. Only the default policy (§4.3) specifies default weights.
// A creator or merchant policy must specify its own values for any edge types it cares about.
// All edge type keys are optional. Missing keys default to 0.0.
// "unsigned" is a pseudo-key for gap nodes; it is not an edge type but follows the same schema.
// Weights may be any non-negative decimal. They are relative, not absolute.
// a policy with all weights doubled is equivalent to one with all weights halved.
```

**Note (Why maximum, not sum):** A node in a CHAIN_PRECEDES relationship with a transaction also has a CONVERGES_ON edge (since every non-transaction node in a session gets CONVERGES_ON). If weights were summed, every node would receive a CONVERGES_ON bonus on top of its primary edge weight, inflating scores for all structural contributors equally and making the CONVERGES_ON weight meaningless as a differentiator. Taking the maximum means the primary relationship dominates, which is the intuitive behavior: a node that is structurally upstream is scored as a chain contributor, not as a chain contributor plus a co-occurrence contributor.

#### 4.2.3 Modifiers

Modifiers adjust a node's raw score after the base edge weight is assigned. They are applied multiplicatively, in order. A final score of zero means the node receives no distribution share. All modifiers are optional; a policy with no modifiers array applies only the base edge weights.

```
"modifiers": [
  {
    "type": "temporal_decay",
    "half_life_ms": 30000
    // Multiplies the base score by: 2^(-(delta_ms / half_life_ms))
    // where delta_ms = transaction.timestamp - node.timestamp.
    // A node 30 seconds before the transaction is halved.
    // A node 60 seconds before is quartered.
    // Nodes after the transaction timestamp are scored as 0.
  },
  {
    "type": "chain_depth_penalty",
    "penalty_per_level": 0.1
    // Multiplies the base score by: max(0, 1.0 - (chain_depth * penalty_per_level))
    // where chain_depth is the number of CHAIN_PRECEDES hops from this node to the
    // nearest transaction node (via any path). Genesis nodes have chain_depth = 0.
    // A penalty_per_level of 0.1 reduces a depth-3 node to 70% of base.
    // Nodes deeper than 1/penalty_per_level receive score 0.
  },
  {
    "type": "call_count_boost",
    "multiplier_per_call": 0.2,
    "cap": 2.0
    // For nodes whose content_id appears more than once in the session,
    // multiplies score by: min(cap, 1.0 + (call_count - 1) * multiplier_per_call)
    // A tool called 3 times gets: min(2.0, 1.0 + 2 * 0.2) = 1.4×
    // Useful for policies that weight repeated use as stronger contribution.
  }
]

// Only these three modifier types are defined in v1.
// Unknown modifier types MUST be ignored with a warning in the session policy record.
```

#### 4.2.4 Distribution Method

The distribution method determines how final scores are converted into share fractions. One method is defined in v1:

| Value        | Behavior                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| proportional | Each contributor's share is their final score divided by the sum of all final scores. If all final scores are zero (which can occur if all nodes are gap nodes under a policy that weights unsigned nodes at 0.0) the calculation produces an empty distribution with a warning, not an error. |

Additional distribution methods (`equal`, `last_touch`, `first_touch`) are reserved for v2. Implementations MUST reject policies with unknown distribution values rather than silently falling back to proportional.

#### 4.2.5 Constraints

Constraints impose floors and caps on individual contributor shares. They MUST be applied after raw scores are computed and an initial proportional normalization is performed, but before the final normalization (§4.6.5) and before aggregation by creator (§4.6.6). The sequence is: raw scores → initial proportional pass → apply constraints → final renormalization → aggregate by creator → apply creator floors (§4.6.7) → final renormalization.

Two constraint fields involve floors but serve different purposes and are applied differently. **`minimum_share`** is a merchant-level constraint: when present in the merchant policy, it sets a floor for _every_ contributing node, so no contributor receives less than this fraction. It prevents any one creator from being allocated a trivially small share that is economically meaningless. **`minimum_own_share`** is a creator-level constraint: when present in a creator policy, it expresses the minimum fraction of the total distribution that creator requires for their own nodes. It is the creator's asking price. These two fields are distinct, exist on different policy roles, and are applied at different points in negotiation (§4.5.2) and calculation (§4.6.4).

```
"constraints": {
  "minimum_share": 0.05,
  // MERCHANT POLICY ONLY. Floor applied to every contributing node after normalization.
  // Any node with a share below this threshold is boosted to this value;
  // other shares are scaled down proportionally.

  "minimum_own_share": 0.15,
  // CREATOR POLICY ONLY. Minimum fraction of total distribution the creator
  // requires for their own nodes, summed across all their tool calls in the session.
  // Read during negotiation (§4.5.2), not applied by the calculation algorithm directly.
  // the session policy record captures the agreed floor per creator,
  // and the calculation algorithm applies it as a per-creator post-aggregation adjustment.

  "maximum_share": 0.80,
  // Any contributing node whose post-normalization share exceeds this
  // threshold is capped at this value. Excess is redistributed
  // proportionally to other nodes.

  "maximum_total_share": 0.15
  // MERCHANT POLICY ONLY. The maximum fraction of transaction value distributed
  // to ALL contributors combined. The remainder stays with the merchant.
  // This constraint does not affect the distribution fractions (which sum to 1.0);
  // it is applied at payout time to the currency amount.
  // If both merchant and creator policies specify maximum_total_share,
  // the merchant's value takes precedence (§4.5.2).
}
```

**Note (Share fractions vs. currency amounts):** Policy documents, settlement recommendations, and the calculation algorithm work entirely in share fractions: dimensionless rationals summing to 1.0. The conversion from share fraction to currency amount requires a transaction value, which the policy document does not contain and should not contain. Currency conversion is performed by the merchant at payout time using the transaction value from the commerce protocol's transaction event. This separation keeps the policy independent of transaction size and currency.

---

### 4.3 The Default Policy

The default policy applies when: no merchant policy is present, policies cannot be negotiated to a compatible agreement (§4.5.2), or the agreed policy fails schema validation at calculation time. It is designed to be conservative, uncontroversial, and auditable, correct enough to be used as a baseline without anyone having designed it for the specific situation.

When the default policy applies because no merchant policy is present, creator `minimum_own_share` floors from individual creator policies are still honored. The default policy has no `maximum_total_share` constraint, so there is no cap to conflict with. Creator floors are applied as post-aggregation adjustments per §4.6 even when the default governs the edge weights and distribution method. This ensures creators who have published policies are not disadvantaged by a merchant who has not.

```
{
  "spec_version": "atrib/1.0",
  "policy_id":    "https://atrib.io/policies/default/v1",
  "role":         "default",
  "edge_weights": {
    "CHAIN_PRECEDES":  1.0,
    "SESSION_PRECEDES": 1.0,
    "SESSION_PARALLEL": 1.0,
    "CONVERGES_ON":     1.0,
    "CROSS_SESSION":    1.0,
    "unsigned":         0.0
  },
  "modifiers":    [],
  "distribution": "proportional",
  "constraints":  {}
}
```

The default policy assigns equal weight to every signed node regardless of its edge type, and zero weight to unsigned gap nodes.

**Note (Why unsigned nodes receive zero weight):** Gap nodes represent unsigned hops with no verifiable claim to honor (see section 1.6). A merchant may choose to honor unsigned contributions through a custom policy, but doing so is an explicit opt-in, not the default.

---

### 4.4 Publication and Discovery

Policy documents are published at a well-known URL and fetched by agents at session initialization. This follows the same convention used by UCP merchant profiles (published at `/.well-known/ucp`) and MCP server cards (at `/.well-known/mcp.json`).

**Creator policies**

An MCP server operator SHOULD publish their attribution policy at:

```
GET https:///.well-known/atrib-policy.json
```

The `mcp-server-host` is the hostname of the server URL used to compute `content_id` values (§1.2.2). An agent that knows the server URL of a tool it is about to call can derive the policy URL directly without any additional lookup.

**Merchant policies**

A merchant SHOULD publish their attribution policy at:

```
GET https:///.well-known/atrib-policy.json
```

The `merchant-domain` is the domain used as the server URL for the merchant's transaction records (§1.7, the checkout endpoint URL). An agent preparing to initiate a checkout can derive the merchant's policy URL from the checkout endpoint.

**Response requirements**

Servers hosting policy documents MUST respond with HTTP 200 and a valid policy document, or HTTP 404 if no policy is published. A 404 response means the default policy applies. Any other response code SHOULD be treated as a transient error; agents SHOULD retry once with a 2-second delay and fall back to the default policy if the retry also fails.

Policy documents SHOULD be cacheable for at least 5 minutes. Agents SHOULD not re-fetch policies within a running session even if the cache TTL expires. The policy in effect at session initialization is the policy that applies to that session.

---

### 4.5 Session Negotiation

Negotiation is the process by which an agent, at session initialization, reads available policies from the tools it expects to call and from the merchant it expects to transact with, and establishes the agreed policy that will govern the eventual calculation.

#### 4.5.1 Negotiation Protocol

At session initialization, the agent SHOULD:

Step 1: Fetch the merchant's policy from `/.well-known/atrib-policy.json`. If the merchant has no policy, use the default.

Step 2: For each MCP server the agent intends to call, fetch the creator's policy from `/.well-known/atrib-policy.json`. If a creator has no policy (404 response, schema validation failure, or fetch error after retry) they have no stated preferences: no `minimum_own_share` floor, no edge weight preferences. Their contribution is calculated entirely under the merchant's policy (or the default if the merchant has none). This is not a conflict; it is the absence of a stated position.

Step 3: Check compatibility between the merchant's policy and each creator's policy (§4.5.2). If all are compatible, the merchant's policy governs the calculation; creator policies constrain what the merchant's policy can do but do not override its structure.

Step 4: Record the agreed policy in the session policy record (§4.5.3) and embed the policy record ID in the session's W3C Baggage as `atrib-policy=`.

**Note (Negotiation is best-effort in v1):** Session initialization may be fast-path and policy fetching may add latency. Agents MAY skip negotiation and proceed under the default policy when latency constraints require it. When this happens, the session policy record MUST indicate that the default policy was used due to a negotiation skip. Merchants and creators who require specific policies SHOULD ensure their policies are available with low latency and published at stable, well-cached URLs.

#### 4.5.2 Conflict Resolution

Two policies conflict when they specify requirements that cannot be simultaneously satisfied. The resolution rules are:

**Rule 1:** Merchant controls total payout cap.** If the merchant policy specifies `maximum_total_share`, that value governs regardless of what creator policies specify. A creator policy that implicitly requires a higher total payout (because its `minimum_own_share` constraint, combined with the number of contributing creators, would sum to more than the merchant's cap) is in conflict with the merchant policy.

**Rule 2:** Creator minimum floors are honored within the cap.** If a creator policy specifies `minimum_own_share`, that floor MUST be honored in the calculation for that creator's contribution, subject to the merchant's `maximum_total_share`. If honoring all creator minimums would require exceeding the merchant's total cap, creator minimums are scaled down proportionally until the total cap is satisfied.

**Rule 3:** Irreconcilable conflicts fall back to default.** If after applying Rules 1 and 2 the policies remain irreconcilable (for example, a single creator's minimum floor alone exceeds the merchant's total cap) the session proceeds under the default policy for all contributors, and the conflict is logged in the session policy record with the incompatible policies identified.

**Rule 4:** Edge weight disagreements do not block negotiation.** When creator and merchant policies specify different edge weights, the merchant's edge weights govern the calculation. The creator's edge weights are advisory (they express what the creator believes their contributions are worth) but the merchant's policy is the operative one. A creator who is unwilling to operate under a merchant's policy can choose not to serve that merchant's agents; this is a business decision, not a protocol enforcement point.

**Rule 5:** Creator floors summing to more than 1.0 are irreconcilable.** If the sum of all `minimum_own_share` values across all creators in the session exceeds 1.0, the floors are mathematically impossible to honor simultaneously regardless of any merchant cap. This condition MUST be detected at negotiation time and triggers Rule 3 (fall back to default). The session policy record MUST identify all creators whose floors contributed to the irreconcilable sum.

**Rule 6:** Contradictory constraints within a single policy are invalid.** A policy document where `minimum_share` is greater than `maximum_share`, or where any constraint value is negative, MUST be rejected at parse time as if it were a 404 response. The agent MUST log a warning identifying the contradictory fields. A policy that is invalid for the purposes of negotiation is treated as absent; the creator or merchant has no stated policy.

**Rule 7:** No agent SDK means no session policy record; calculation defaults.** When no agent-side atrib SDK was present during the session, no session policy record exists. The merchant discovering the session post-transaction may still run the calculation using the default policy and the graph as constructed from log data. In this case, `calculated_by` in the settlement recommendation is set to `"local"`, the merchant signs with their own key, and `policy_record_id` is set to `"default"` to indicate the default policy was applied without a negotiated record.

#### 4.5.3 Session Policy Record

The session policy record is a lightweight document created at negotiation time and stored by the agent. It records the policies that were considered and the resulting agreed policy, providing an audit trail that both creator and merchant can inspect after the fact.

```
{
  "spec_version":    "atrib/1.0",
  "record_id":       "sha256:",
  // The record_id is computed as SHA-256(JCS(record_without_record_id)),
  // where record_without_record_id is the session policy record with the
  // record_id field omitted (not set to empty string). The JCS serialization
  // follows RFC 8785. Used as a stable reference.
  "context_id":      "4bf92f3577b34da6a3ce929d0e0e4736",
  "created_at":      1743850000000,
  "merchant_policy": "https://merchant.example.com/.well-known/atrib-policy.json",
  // URL of the merchant policy fetched, or "default" if none was published.
  "creator_policies": [
    {
      "server_url": "https://tools.example.com",
      "policy_url": "https://tools.example.com/.well-known/atrib-policy.json",
      "status":     "compatible"
      // "compatible" | "floor_scaled" | "conflict_defaulted" | "not_found"
    }
  ],
  "agreed_policy":   "https://merchant.example.com/.well-known/atrib-policy.json",
  // The operative policy URL, or "default" if the default was used.
  "applied_constraints": {
    "minimum_floors": {
      "https://tools.example.com": 0.10
      // Creator minimum floors that were honored in this session.
    }
  },
  "warnings": []
  // Array of strings describing any non-fatal issues encountered during
  // negotiation (unknown modifier types, missing policies, etc.)
}
```

The session policy record is not submitted to the Merkle log; it is not an attribution record. It is stored locally by the agent and SHOULD be made available to the merchant on request. It serves as evidence of the policy terms in effect during the session if a dispute arises.

---

### 4.6 The Calculation Algorithm

The calculation algorithm is a pure function: given the attribution graph for a session (§3) and the agreed policy document (§4.5), it produces a distribution: a mapping from creator public keys to share fractions summing to 1.0. No other inputs are required. No network calls are made. No timestamps beyond those in the records are used.

Any party (creator, merchant, auditor, regulator) with access to the graph data and the policy document MUST be able to run this algorithm locally and arrive at the same result as any other party running the same inputs. The atrib resolution API (at `https://resolve.atrib.io/v1/calculate`) is a convenience implementation of this algorithm, not an authority. Its output is no more or less trustworthy than a local implementation producing the same output from the same inputs.

#### 4.6.1 Inputs and Preconditions

Inputs:

- `G`: the attribution graph for the session, as returned by the graph query API (§3.4.1) with `include_gap_nodes=true` and `include_cross_session=true`.

- `P`: the agreed policy document for the session (§4.5.3).

Preconditions that MUST hold before the algorithm runs:

- `G` contains at least one transaction node. If no transaction node is present, the session is not closed and calculation MUST NOT proceed.

- `P` is a valid v1 policy document per the schema in §4.2. If validation fails, use the default policy.

- All nodes in `G` whose `verification_state` is `signature_valid` or higher are eligible for distribution. Nodes with `verification_state: unsigned` are eligible only if `P.edge_weights.unsigned > 0`.

#### 4.6.2 Step 1: Identify Contributing Nodes

A node `N` is a contributing node if all of the following hold:

- `N.event_type` is `tool_call` or `gap_node` (not `transaction`).

- `N` has at least one edge to a transaction node in `G`, either a CONVERGES_ON edge (same session) or a CROSS_SESSION edge (linked session). This is always true for all non-transaction nodes when the graph is queried for a closed session, but is stated explicitly to prevent implementation errors.

Let `C` be the set of all contributing nodes.

#### 4.6.3 Step 2: Compute Raw Scores

For each node `n` in `C`, compute its raw score `raw(n)`:

```
function raw_score(n, G, P):
  // Step 2a: determine base weight from edge type
  if n.event_type == "gap_node":
    base = P.edge_weights["unsigned"] ?? 0.0
  else:
    // collect all edge types connecting n to any transaction node
    edge_types = {e.type for e in G.edges where e.source == n.id
                  and G.nodes[e.target].event_type == "transaction"}
    // also include CHAIN_PRECEDES and SESSION_* edges between non-transaction nodes
    // that form a path leading to a transaction node
    edge_types |= {e.type for e in all_edges_on_paths_to_transaction(n, G)}
    // all_edges_on_paths_to_transaction(n, G) returns the set of edges on any
    // path from n to a transaction node. The algorithm: (1) build both directed
    // (CHAIN_PRECEDES, SESSION_PRECEDES, CONVERGES_ON, CROSS_SESSION) and
    // undirected (SESSION_PARALLEL) adjacency from G; (2) reverse BFS from all
    // transaction nodes to find the set of nodes that can reach a transaction;
    // (3) forward BFS from n, collecting edge types for edges whose target is
    // in the reachable set. This ensures that intermediate structural edges
    // (e.g., CHAIN_PRECEDES between non-transaction nodes on a path to a
    // transaction) contribute their weight to n's base score.
    weights = [P.edge_weights[t] ?? 0.0 for t in edge_types]
    base = max(weights) if weights else 0.0

  // Step 2b: apply modifiers in order
  score = base
  for modifier in P.modifiers:
    score = apply_modifier(modifier, score, n, G)

  return max(0.0, score)  // scores cannot be negative

function apply_modifier(modifier, score, n, G):
  if modifier.type == "temporal_decay":
    T = transaction_node(G).timestamp
    delta_ms = T - n.timestamp
    if delta_ms < 0: return 0.0  // node is after transaction
    return score * pow(2.0, -(delta_ms / modifier.half_life_ms))

  if modifier.type == "chain_depth_penalty":
    depth = shortest_chain_path_length(n, G)  // hops to nearest transaction via CHAIN_PRECEDES
    // The shortest chain path length from node N to any transaction node is the
    // minimum number of CHAIN_PRECEDES edges on any directed path from N to a
    // transaction node. If no CHAIN_PRECEDES path exists, the depth is treated
    // as unbounded (the penalty factor becomes zero).
    factor = max(0.0, 1.0 - depth * modifier.penalty_per_level)
    return score * factor

  if modifier.type == "call_count_boost":
    count = count_nodes_with_same_content_id(n.content_id, G)
    factor = min(modifier.cap, 1.0 + (count - 1) * modifier.multiplier_per_call)
    return score * factor

  return score  // unknown modifier types are ignored
```

#### 4.6.4 Step 3: Apply Constraints

Constraints are applied after an initial proportional pass on the raw scores and before the final normalization step. The pseudocode below incorporates the initial proportional pass internally.

```
function apply_constraints(raw_scores, constraints):
  // Filter to nodes with non-zero scores (only contributors receive shares)
  contributors = {n: s for n, s in raw_scores.items() if s > 0.0}

  if not contributors:
    return {}  // empty distribution; all nodes were gap nodes under zero-weight policy

  total = sum(contributors.values())
  normalized = {n: s/total for n, s in contributors.items()}

  // Apply minimum_share floor
  if constraints.minimum_share:
    normalized = apply_minimum_floor(normalized, constraints.minimum_share)

  // Apply maximum_share cap
  if constraints.maximum_share:
    normalized = apply_maximum_cap(normalized, constraints.maximum_share)

  // Note: maximum_total_share is NOT applied here.
  // It affects the currency conversion at payout, not the distribution fractions.
  // The distribution fractions always sum to 1.0 among contributing nodes.
  // The merchant retains (1.0 - maximum_total_share) of transaction value
  // by applying the total share cap to the dollar amount, not the fractions.

  return normalized

function apply_minimum_floor(normalized, floor):
  // Boost any node below floor to floor, scale others down proportionally.
  below = {n: s for n, s in normalized.items() if s < floor}
  above = {n: s for n, s in normalized.items() if s >= floor}
  boost_needed = sum(floor - s for s in below.values())
  above_total = sum(above.values())
  if above_total <= boost_needed:
    return {n: 1.0/len(normalized) for n in normalized}  // equal distribution fallback
  scale = (above_total - boost_needed) / above_total
  result = {n: floor for n in below}
  result |= {n: s * scale for n, s in above.items()}
  return result

function apply_maximum_cap(normalized, cap):
  // Cap any node above cap, redistribute excess proportionally to others.
  above = {n: s for n, s in normalized.items() if s > cap}
  below = {n: s for n, s in normalized.items() if s <= cap}
  excess = sum(s - cap for s in above.values())
  below_total = sum(below.values())
  result = {n: cap for n in above}
  if below_total > 0:
    scale = (below_total + excess) / below_total
    result |= {n: s * scale for n, s in below.items()}
  else:
    result |= below
  return result
```

#### 4.6.5 Step 4: Normalize to a Distribution

After applying constraints, re-normalize so shares sum to exactly 1.0, correcting for any floating-point accumulation during constraint application:

```
function final_normalize(shares):
  total = sum(shares.values())
  if total == 0.0: return {}
  return {n: s/total for n, s in shares.items()}
```

#### 4.6.6 Step 5: Aggregate by Creator

The per-node distribution is aggregated by `creator_key`, summing all shares belonging to the same creator. A creator who appears multiple times in a session (via multiple tool calls or multiple tools) receives the sum of all their node shares.

```
function aggregate_by_creator(normalized_shares, G):
  by_creator = {}
  for node_id, share in normalized_shares.items():
    node = G.nodes[node_id]
    key = node.creator_key ?? "__unsigned__"  // gap nodes aggregate under a sentinel key
    by_creator[key] = by_creator.get(key, 0.0) + share
  return by_creator
```

The `__unsigned__` sentinel key is present in the output only if gap nodes received non-zero weight under the policy. Its presence signals to the merchant that some share of value is attributed to unsigned contributions, and it is the merchant's responsibility to decide how to handle.

#### 4.6.7 Step 6: Apply Creator Floors

After aggregation by creator, apply any `minimum_own_share` floors from the session policy record's `applied_constraints.minimum_floors` map. These floors were established during negotiation (§4.5.2) and represent the agreed minimum share for each creator who published one. This step adjusts the aggregated distribution to honor those floors, scaling down other creators' shares proportionally.

```
function apply_creator_floors(by_creator, creator_floors):
  // creator_floors: { creator_key → minimum_own_share } from session policy record
  // Only contains entries for creators whose floors survived negotiation (Rules 1-5).
  // If no floors, return by_creator unchanged.
  if not creator_floors: return by_creator

  result = dict(by_creator)
  floored_keys = set()

  // Identify creators below their floor
  for key, floor in creator_floors.items():
    if key not in result: continue  // creator didn't contribute; floor doesn't apply
    if result[key] < floor:
      floored_keys.add(key)

  if not floored_keys: return result  // all creators already meet their floors

  // Boost floored creators, scale others down proportionally
  boost_needed = sum(creator_floors[k] - result[k] for k in floored_keys)
  non_floored = {k: v for k, v in result.items() if k not in floored_keys}
  non_floored_total = sum(non_floored.values())

  if non_floored_total <= boost_needed:
    // Cannot honor all floors without taking from other floored creators.
    // This should have been caught by Rule 5 at negotiation time.
    // If reached, return current result unchanged and log a warning.
    return result

  scale = (non_floored_total - boost_needed) / non_floored_total
  for k in floored_keys:
    result[k] = creator_floors[k]
  for k in non_floored:
    result[k] = non_floored[k] * scale

  return result
```

After this step, re-normalize with `final_normalize` (§4.6.5) to correct for floating-point accumulation. The complete call sequence for the full algorithm is:

```
function calculate(G, P, session_policy_record):
  C                = identify_contributing_nodes(G)
  raw_scores       = {n: raw_score(n, G, P) for n in C}
  constrained      = apply_constraints(raw_scores, P.constraints)
  normalized       = final_normalize(constrained)
  by_creator       = aggregate_by_creator(normalized, G)
  creator_floors   = session_policy_record.applied_constraints.minimum_floors ?? {}
  floored          = apply_creator_floors(by_creator, creator_floors)
  return final_normalize(floored)  // final renorm after floor application
```

---

### 4.7 Settlement Recommendation Document

The settlement recommendation document is the output of the calculation algorithm. It is a structured, signed record of the recommended distribution for a specific session. It is not a payment instruction; the merchant decides whether and how to act on it. But it is sufficiently precise and self-contained that any party can verify it was correctly calculated.

#### 4.7.1 Document Format

```
{
  "spec_version":    "atrib/1.0",
  "document_type":   "settlement_recommendation",
  "context_id":      "4bf92f3577b34da6a3ce929d0e0e4736",
  "transaction_id":  "sha256:8b2f1c...",     // record_hash of the transaction node
  "policy_record_id":"sha256:3f8a2b...",    // record_id of the session policy record (§4.5.3)
  "graph_checkpoint":"log.atrib.io/v1",   // log origin used for graph data
  "graph_tree_size": 4821937,              // log tree size at calculation time
  "calculated_at":   1743860000000,
  "calculated_by":   "https://resolve.atrib.io/v1",
  // URL of the service that ran the calculation, or "local" if self-calculated.

  "distribution": {
    "ABC...creatorkey1": 0.4500,    // base64url Ed25519 public key → share fraction
    "DEF...creatorkey2": 0.3500,
    "GHI...creatorkey3": 0.2000
  },
  // Share fractions sum to 1.0 (within floating-point tolerance of 1e-9).
  // __unsigned__ may appear if policy weights unsigned > 0.

  "maximum_total_share": 0.15,
  // From merchant policy constraints.maximum_total_share, or null if unconstrained.
  // The currency amount distributed to each creator is:
  // creator_amount = transaction_value * maximum_total_share * distribution[creator_key]
  // If null, the merchant determines the total share independently.

  "warnings": [],
  // Non-fatal issues encountered during calculation. Empty if clean.

  "signature": "base64url..."
  // Ed25519 signature by calculated_by over the JCS-canonical record minus this field.
  // If calculated_by = "local", the merchant signs with their own key.
}
```

#### 4.7.2 Signing the Recommendation

The settlement recommendation MUST be signed by whoever produced it, using their Ed25519 private key and the same JCS canonicalization procedure defined in §1.4.2. This signature proves that the stated party produced this exact recommendation at the stated time. It does not prove the recommendation is correct; correctness is established by independent verification.

When the atrib resolution API produces the recommendation, it signs with atrib's key (published at `https://resolve.atrib.io/v1/pubkey`). When a merchant or third party runs the calculation locally, they sign with their own key. Any verifier who checks the signature must use the appropriate public key based on `calculated_by`.

#### 4.7.3 Independent Verification

Any party with access to the graph data and the session policy record can independently verify a settlement recommendation by:

Step 1: Verify the recommendation's signature using the public key of `calculated_by`.

Step 2: Fetch the graph for `context_id` from `graph_checkpoint` (the log identified by `graph_checkpoint` at tree size `graph_tree_size`).

Step 3: Fetch the session policy record identified by `policy_record_id`. Retrieve the agreed policy from `agreed_policy`.

Step 4: Run the calculation algorithm (§4.6) with those inputs.

Step 5: Compare the output with the `distribution` field. Shares MUST match within a floating-point tolerance of `1e-9`. Any discrepancy beyond this tolerance indicates either a bug, a different policy was applied, or the recommendation was tampered with.

**Important:** Verification requires the same graph snapshot** The graph for a session can grow after a transaction closes: late attribution records may arrive, gap nodes may be resolved by creators who submit delayed records, CROSS_SESSION edges may be added as session_token links are discovered. The `graph_tree_size` field pins the graph to a specific log state. Independent verifiers MUST use the same tree size to reconstruct the same graph. Using the current graph state may produce a different result if the graph has grown since calculation time. This is not an error; it is expected behavior. If a merchant wishes to recalculate with a more complete graph, they may do so and produce a new recommendation.

---

### 4.8 Known Limitations and V2 Deferrals

**Policy versioning (deferred to v2).** In v1, policies are identified by URL with no formal versioning; the session policy record partially mitigates this by capturing agreed terms at session time. A normative policy versioning mechanism supporting immutable snapshots and policy history will be defined in v2.

**Settlement webhook format (deferred to v2).** In v1, settlement recommendations are produced on demand only. A standardized push mechanism (event format, delivery guarantees, retry behavior) will be defined in v2.

**Dispute mechanism (deferred to v2).** In v1, there is no protocol-defined dispute process; creators contest recommendations by contacting merchants directly using the session policy record as evidence. A structured dispute record format will be defined in v2.

**Multi-transaction sessions.** In v1, the calculation algorithm assumes one transaction node per session; multiple transactions require separate calculation runs. Multi-transaction session handling will be specified in v2.

**Agent-published policies (deferred to v2).** In v1, agents consume policies but do not publish their own, though the v1 policy format can express learned weights. Agent-published policies and associated discovery infrastructure will be defined in v2.

---

## §5 SDK Specification

_@atrib/mcp, @atrib/agent, @atrib/verify. Normative trigger table. Degradation contract._

The conformance specification for @atrib/mcp, @atrib/agent, and @atrib/verify, defining the middleware contract, automation triggers, key management, and degradation behavior that all conforming implementations must satisfy.

Contents

- [5.1 Design Principle: Zero Ongoing Surface Area](#51-design-principle-zero-ongoing-surface-area)
- [5.2 Package Overview](#52-package-overview)
- [5.3 @atrib/mcp: MCP Server Middleware](#53-atribmcp-mcp-server-middleware)
  - [5.3.1 Init interface](#531-init-interface)
  - [5.3.2 Inbound context reading](#532-inbound-context-reading)
  - [5.3.3 Record construction and signing](#533-record-construction-and-signing)
  - [5.3.4 Outbound context writing](#534-outbound-context-writing)
  - [5.3.5 Log submission](#535-log-submission)
  - [5.3.6 Policy exposure](#536-policy-exposure)
- [5.4 @atrib/agent: Agent Middleware](#54-atribagent-agent-middleware)
  - [5.4.1 Init interface](#541-init-interface-1)
  - [5.4.2 Session initialization](#542-session-initialization)
  - [5.4.3 Outbound context forwarding](#543-outbound-context-forwarding)
  - [5.4.4 Inbound context accumulation](#544-inbound-context-accumulation)
  - [5.4.5 Transaction detection](#545-transaction-detection)
  - [5.4.6 Session policy record creation](#546-session-policy-record-creation)
- [5.5 @atrib/verify: Merchant Verification Library](#55-atribverify-merchant-verification-library)
  - [5.5.1 Init interface](#551-init-interface-2)
  - [5.5.2 Verifying a settlement recommendation](#552-verifying-a-settlement-recommendation)
  - [5.5.3 Post-hoc calculation (no agent SDK)](#553-post-hoc-calculation-no-agent-sdk)
- [5.6 Key Management](#56-key-management)
  - [5.6.1 Key generation](#561-key-generation)
  - [5.6.2 Environment variable convention](#562-environment-variable-convention)
  - [5.6.3 Key storage requirements](#563-key-storage-requirements)
- [5.7 Automation Triggers (Normative)](#57-automation-triggers-normative)
- [5.8 Degradation Contract](#58-degradation-contract)

### 5.1 Design Principle: Zero Ongoing Surface Area

The fundamental design requirement for all atrib SDKs is that attribution must happen automatically as a consequence of agents and tools doing what they already do, not as something developers explicitly trigger. The moment a developer must decide when to call an attribution method, adoption fails. They will intend to add it later and never do.

This means the SDK specification defines a **middleware contract**, not an API. There are no methods for developers to call after init. There are no configuration options for when to emit. There is one function call at startup and zero ongoing surface area.

A conforming SDK implementation MUST satisfy all the automation triggers defined in §5.7. A conforming implementation MUST NEVER require the developer to call any attribution method explicitly after initialization. A conforming implementation MUST NEVER fail or throw an exception in a way that affects the primary tool call or agent response.

---

### 5.2 Package Overview

Three packages are defined in this specification. All are TypeScript/JavaScript packages distributed via npm. Implementations in other languages SHOULD follow the same interface contracts using idiomatic patterns for their language.

| Package       | Used by                         | Purpose                                                                                                                                                                                         |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @atrib/mcp    | MCP server operators (creators) | Wraps an MCP server to automatically emit signed attribution records on every successful tool call and expose the creator's policy at `/.well-known/atrib-policy.json`.                         |
| @atrib/agent  | Agent developers                | Wraps an agent to automatically read and forward attribution context on every tool call, run policy negotiation at session start, create session policy records, and detect transaction events. |
| @atrib/verify | Merchants                       | Verifies settlement recommendations and runs post-hoc attribution calculations for sessions where no agent SDK was present.                                                                     |

All three packages are open source under the Apache 2.0 license. The npm package names are reserved. The reference implementations are maintained at `github.com/atrib-io`. Third-party implementations are permitted and encouraged, provided they satisfy the conformance requirements in this section.

---

### 5.3 @atrib/mcp: MCP Server Middleware

#### 5.3.1 Init Interface

The `atrib()` function wraps an existing MCP server instance. It returns a new server instance that is a transparent proxy; all MCP protocol behavior is preserved unchanged. The only observable difference is that attribution records are emitted and context is propagated.

```
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Before: standard MCP server:
const server = new McpServer({ name: 'my-tool', version: '1.0.0' })

// After: one wrap, everything else is automatic:
const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY   // REQUIRED (see §5.6)
})
```

**Init options**

| Option           | Type       | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey       | string     | Required | Base64url-encoded 32-byte Ed25519 seed. Used to sign all attribution records emitted by this server. See §5.6 for generation and storage requirements.                                                                                                                                                                                                                                                                                                       |
| logEndpoint      | string     | Optional | URL of the Merkle log submission endpoint. Default: `https://log.atrib.io/v1/entries`. Override for private log deployments.                                                                                                                                                                                                                                                                                                                                           |
| policy           | object     | Optional | Inline attribution policy document (§4.2). If provided, served at `/.well-known/atrib-policy.json`. If absent, a 404 is served at that path (default policy applies for callers).                                                                                                                                                                                                                                                                                      |
| serverUrl        | string     | Optional | Canonical URL of this MCP server, used to compute `content_id` values (§1.2.2). Default: derived from the server's HTTP host header. MUST be set explicitly for stdio transport where no host header is available.                                                                                                                                                                                                                                                     |
| transactionTools | string\[\] | Optional | Array of tool names that complete commerce transactions. When a successful call to one of these tools is detected, `@atrib/mcp` emits a `transaction` record (event_type: "transaction") rather than a `tool_call` record. This is how Path 1 merchant-side transaction emission (§5.4.5) is implemented. The merchant's checkout tool name(s) should be listed here. If not set, `@atrib/mcp` emits only `tool_call` records and Path 2 agent-side detection applies. |

#### 5.3.2 Inbound Context Reading

On every `tools/call` request, the middleware MUST read the inbound attribution context before passing the request to the tool handler. The context is read in priority order:

1\. `params._meta.atrib`: present for MCP stdio and Streamable HTTP transport. Value is a base64url-encoded token as defined in §1.5.2. Read first.

2\. `tracestate: atrib=`: present for HTTP transport. Parsed per §1.5.2. Read if `params._meta.atrib` is absent.

3\. `X-atrib-Chain` header: fallback when tracestate was stripped by a proxy (§1.5.3). Read if neither of the above is present.

If all three are absent, this is a genesis call; no upstream attribution context exists for this request. The middleware generates a genesis record (§5.3.3).

In addition, the middleware MUST read the session_token if present:

4\. `params._meta.baggage`: for MCP transports. Parse for key `atrib-session`.

5\. W3C `Baggage` header: for HTTP transport. Parse for key `atrib-session`.

The extracted context yields: `record_hash` (the SHA-256 of the sending record, which becomes the `chain_root` of the next record in the chain), `creator_key` (identifies the sender), `context_id` (the OTel trace ID from the `traceparent` header or span context), and optionally `session_token` (for cross-trace attribution linking). All extracted values are passed to record construction (§5.3.3).

#### 5.3.3 Record Construction and Signing

After the tool handler completes successfully (i.e., `isError` is false in the response), the middleware MUST construct and sign an attribution record per §1.2–§1.4.

```
// Record construction and signing. Fires AFTER successful tool call response,
// BEFORE the response is returned to the caller:
const isTransaction = transactionTools.includes(toolName)
const record = {
  spec_version: "atrib/1.0",
  content_id:   computeContentId(serverUrl, toolName),    // §1.2.2
  creator_key:  publicKeyFromPrivate(creatorKey),          // base64url Ed25519 pubkey
  chain_root:   inboundContext?.record_hash            // record_hash from §5.3.2 becomes this record's chain_root
                  ?? genesisChainRoot(context_id),       // §1.2.3 if no upstream
  event_type:   isTransaction ? "transaction" : "tool_call",  // §1.2.4
  context_id:   context_id,                               // OTel trace ID
  timestamp:    Date.now(),
  ...(session_token && { session_token }),                 // §1.5.5, omit field if absent
}
const signed = signRecord(record, creatorKey)             // §1.4.2, synchronous
```

Record construction and signing MUST complete before the response is returned to the caller. Log submission (§5.3.5) always happens after the response is sent and is always non-blocking, including for transaction records. See §5.3.5 for submission behavior, retry logic, and the priority distinction between transaction and tool_call records.

**Note (Tool call failures):** Attribution records are only emitted for successful tool calls (`isError: false`). A tool call that returns an error does not generate an attribution record and does not extend the chain. The OTel span for the failed call will create a gap node in the graph (§3.2.5), visible as an unsigned hop.

#### 5.3.4 Outbound Context Writing

After signing the record, the middleware MUST write the new attribution context into the response so the calling agent can forward it downstream.

```
// Compute the propagation token (§1.5.2):
// record_hash = SHA-256 of the full JCS-canonical signed record just emitted
// This becomes the chain_root field in the NEXT record that extends this chain.
const record_hash_bytes = sha256(jcs(signed))
const creator_key_bytes = publicKeyBytes(creatorKey)
const token = base64url(record_hash_bytes) + '.' + base64url(creator_key_bytes)

// Write to response in all applicable locations:
response.params._meta.atrib = token                  // always, MCP metadata
response.headers['tracestate'] += `,atrib=${token}`   // HTTP transport
response.headers['X-atrib-Chain'] = token            // fallback header
```

The tracestate value MUST be appended to any existing tracestate entries, not replace them. The full token is 87 characters maximum and fits within the W3C tracestate per-vendor limit of 256 characters.

#### 5.3.5 Log Submission

Log submission is always non-blocking. The tool response is returned to the caller before any submission begins. Submission failures MUST NEVER propagate to the tool response or the caller. This applies to both `tool_call` and `transaction` records without exception; the degradation contract (§5.8) takes precedence over any desire to confirm log commitment before responding.

```
// After response is sent, always non-blocking:
const priority = isTransaction ? 'high' : 'normal'

submitToLog(signed, logEndpoint, { priority })
  .then(proof  => cacheProofBundle(record_hash(signed), proof))
  .catch(err   => {
    logWarning('atrib: log submission failed', { err, record_hash: record_hash(signed) })
    cacheSignedRecord(signed)  // cache locally; will be retried on next flush
  })

// Retry behavior:
// - tool_call records: exponential backoff, max 3 attempts, 30s total window
// - transaction records: same backoff, but attempts begin immediately and run
//   before the next tool_call record in the queue (priority ordering)
// - after all retries fail: signed record stays in local cache
// - verification_state remains signature_valid until log commitment is confirmed
// - manual flush for testing or shutdown: atribServer.flush()
```

The proof bundle returned from a successful submission (§2.6.2) SHOULD be cached in memory keyed by `record_hash` for the duration of the server process, and persisted to a local store if the operator has configured one. Cached proof bundles are served at `GET /.well-known/atrib-proof/{record_hash}` so agents and merchants can retrieve inclusion proofs without querying the log directly.

#### 5.3.6 Policy Exposure

If a `policy` option was provided at init, the middleware MUST serve it at `GET /.well-known/atrib-policy.json` with `Content-Type: application/json` and `Cache-Control: max-age=300`. If no policy was provided, the endpoint MUST return HTTP 404.

For MCP servers using stdio transport, where no HTTP server is available, the policy is instead embedded in the MCP server's capability advertisement in the `serverInfo` field during the `initialize` handshake:

```
// In MCP initialize response (stdio transport only):
serverInfo: {
  name:    'my-tool',
  version: '1.0.0',
  "io.atrib/policy": policy ?? null   // inline policy or null
}
```

---

### 5.4 @atrib/agent: Agent Middleware

#### 5.4.1 Init Interface

The agent middleware exposes an interception surface that the host application or MCP client integrates at outbound tool call and inbound tool response boundaries. This is a framework-agnostic design; the middleware does not monkey-patch a specific agent implementation, because no single agent shape covers the LangChain / Mastra / AI SDK / direct-MCP-client landscape. Instead, the middleware returns an interceptor object that the caller hooks into their own request/response lifecycle.

```
import { atrib } from '@atrib/agent'

// Create the interceptor once at startup.
const interceptor = atrib({
  creatorKey:     process.env.ATRIB_PRIVATE_KEY,  // REQUIRED (see §5.6)
  merchantDomain: 'https://merchant.example.com', // OPTIONAL, for policy fetch at session init
  logEndpoint:    'https://log.atrib.io/v1/entries', // OPTIONAL, default shown
  sessionToken:   'my-session',                    // OPTIONAL (see §1.5.5)
  serverUrls:     ['https://tool-a.example', 'https://tool-b.example'], // OPTIONAL, for policy fetch
})

// The interceptor exposes four methods. The caller invokes them at the
// appropriate points in their MCP client's request/response lifecycle:
//
// 1. Before sending a tools/call request:
const meta = await interceptor.onBeforeToolCall(toolName, existingMeta)
// `meta` is the merged _meta object to attach to the outbound request.
// Init runs lazily on the first call (§5.4.2).
//
// 2. After receiving a tools/call response:
interceptor.onAfterToolResponse(toolName, response, response._meta, {
  serverUrl: 'https://tool-a.example',
  isError: false,
  headers: { /* HTTP response headers if available */ },
})
//
// 3. Inspect the session policy record (e.g., to share with merchant):
const record = interceptor.getSessionPolicyRecord()
//
// 4. Drain pending log submissions before shutdown:
await interceptor.flush()
```

Implementations are free to wrap this surface in higher-level adapters for specific frameworks (a LangChain callback, an AI SDK middleware, an MCP client subclass), but the protocol-level contract is the four methods above. The reference implementation in `@atrib/agent` ships only the interceptor; framework adapters are out of scope for v1.

**Init options**

| Option         | Type   | Required | Description                                                                                                                                                                                                                |
| -------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey     | string | Required | Base64url Ed25519 private key. Used to sign agent-level attribution records when the agent itself is a contributor (e.g., it produces content that influences a transaction). Also used to sign the session policy record. |
| merchantDomain | string | Optional | Base URL of the merchant whose policies should be fetched at session initialization. If not provided, policy negotiation is skipped and the default policy applies.                                                        |
| logEndpoint    | string | Optional | Merkle log submission endpoint. Default: `https://log.atrib.io/v1/entries`.                                                                                                                                                |
| sessionToken   | string | Optional | If provided, used as the session_token for cross-trace attribution linking (§1.5.5). If absent, the middleware generates one automatically at session start and propagates it via W3C Baggage.                             |
| serverUrls     | string[] | Required | URLs of all MCP servers the agent connects to. Used for context propagation and transaction detection scope. |

#### 5.4.2 Session Initialization

Session initialization fires once when the first tool call of a session is about to be made. It MUST complete before the first outbound tool call is sent.

During initialization the middleware:

1\. Establishes the `context_id` from the current OTel trace ID. If no OTel trace is active, generates a random 16-byte hex string and injects it as the trace ID.

2\. Generates or uses the provided `sessionToken` and injects it into W3C Baggage as `atrib-session=`.

3\. Fetches the merchant policy from `merchantDomain/.well-known/atrib-policy.json` if `merchantDomain` is set. Uses a 1-second per-fetch timeout. No retry during init; falls back to default on any error or timeout.

4\. For each tool server in the agent's tool list, fetches creator policies **concurrently** (all in parallel, not sequentially). Uses a 1-second per-fetch timeout with no retry. Reads from `/.well-known/atrib-policy.json` for HTTP servers, or from `serverInfo["io.atrib/policy"]` for stdio servers. Collects all policies that responded within the timeout window; treats non-responding servers as having no policy.

5\. Runs policy negotiation per §4.5 and creates the session policy record per §4.5.3.

The entire initialization sequence MUST complete within 3 seconds. If it does not, the middleware proceeds under the default policy and records a timeout warning in the session policy record. The 1-second per-fetch timeout, with all creator fetches running concurrently, means total init time is bounded by: merchant fetch (≤1s) + max single creator fetch (≤1s) + negotiation logic (negligible) = well within 3 seconds even with many tools.

**Note (Init timeouts differ from runtime policy fetch timeouts):** The §4.4 retry-once-with-2-second-delay behavior applies to _runtime_ policy document requests from policy evaluation tools, not to SDK init. During init, the SDK must fail fast; a slow policy server should not delay the first tool call by 4+ seconds. The tradeoff is that a transiently slow server during init is treated as having no policy; if the server recovers, it will serve its policy correctly on the next tool call's context propagation path.

#### 5.4.3 Outbound Context Forwarding

On every outbound `tools/call` request, the middleware MUST attach the current attribution context to the request:

```
// On every outbound tools/call:
// Token format per §1.5.2: base64url(record_hash) + '.' + base64url(creator_key)
// record_hash = SHA-256 of the JCS-canonical signed record received in the last response
// creator_key = full 32-byte Ed25519 public key of the creator who signed that record
const token = sessionState.latestContext
  ? base64url(sessionState.latestContext.record_hash) + '.'
      + base64url(sessionState.latestContext.creator_key)
  : null

if (token) {
  request.params._meta.atrib = token               // always
  request.headers.tracestate  += `,atrib=${token}`  // HTTP transport
  request.headers['X-atrib-Chain'] = token          // fallback
}

// Always forward session_token in Baggage regardless of whether atrib context exists:
request.headers.baggage += `,atrib-session=${sessionToken}`
request.params._meta.baggage = `atrib-session=${sessionToken}`  // MCP metadata
```

If no attribution context has been received yet in this session (first tool call), no `atrib` token is attached. The receiving tool will generate a genesis record anchored to the session's context_id. This is the expected behavior; the first tool in a session always produces a genesis record.

#### 5.4.4 Inbound Context Accumulation

On every inbound `tools/call` response, the middleware MUST read the attribution context from the response and update the session state:

```
// On every inbound tools/call response (isError: false):
const token = response.params?._meta?.atrib
           ?? parseTracestate(response.headers?.tracestate)?.atrib
           ?? response.headers?.['X-atrib-Chain']

if (token) {
  const { record_hash, creator_key } = decodeToken(token)  // §1.5.2
  // record_hash becomes the chain_root for the NEXT record in this session.
  // creator_key identifies who produced the record we just received.
  sessionState.latestContext = { record_hash, creator_key }
}
// If no token in response: tool does not have @atrib/mcp installed.
// Session state is unchanged. An OTel gap node will represent this hop in the graph.
```

#### 5.4.5 Transaction Detection

The middleware detects transaction events automatically from the response shapes defined in §1.7. No developer input is required. The detection logic checks each successful tool call response for the presence of transaction signals:

```
function detectTransaction(toolName, response, headers):
  // ACP / UCP: completion response with embedded order, OR ACP webhook event.
  // Per §1.7.1 and §1.7.2, both protocols converged on the same shape; UCP
  // is distinguished by the top-level `ucp.version` envelope.
  if (response?.status === 'completed' && typeof response?.order?.id === 'string'):
    const isUcp = typeof response?.ucp?.version === 'string'
    return {
      detected: true,
      protocol: isUcp ? 'UCP' : 'ACP',
      checkoutUrl: response.order.permalink_url ?? null,
    }
  if (response?.type === 'order_create' || response?.type === 'order_update'):
    return {
      detected: true,
      protocol: 'ACP',
      checkoutUrl: response.data?.permalink_url ?? null,
    }

  // x402 and MPP: distinct protocols, distinct headers (case-insensitive
  // per RFC 7230). x402 takes precedence if both are present.
  //   x402 v2 → PAYMENT-RESPONSE      (renamed from v1 X-PAYMENT-RESPONSE)
  //   MPP     → Payment-Receipt       (per draft-ryan-httpauth-payment-01 §5.3)
  const lower = lowercaseKeys(headers)
  if (lower['payment-response'] || lower['x-payment-response']):
    return { detected: true, protocol: 'x402' }
  if (lower['payment-receipt']):
    return { detected: true, protocol: 'MPP' }

  // AP2 v0.1: PaymentMandate Message inside an A2A DataPart.
  // Source: github.com/google-agentic-commerce/ap2 docs/specification.md
  if (Array.isArray(response?.parts)):
    for (part in response.parts):
      if (typeof part?.data === 'object'
          && 'ap2.mandates.PaymentMandate' in part.data):
        return { detected: true, protocol: 'AP2' }

  // a2a-x402 extension: payment-completed via A2A task status metadata.
  // Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
  // Requires BOTH the payment-completed status AND a successful receipt.
  const meta = response?.status?.message?.metadata
  if (meta?.['x402.payment.status'] === 'payment-completed'
      && Array.isArray(meta?.['x402.payment.receipts'])
      && meta['x402.payment.receipts'].some(r => r?.success === true)):
    return { detected: true, protocol: 'AP2' }

  // Legacy / non-canonical: W3C VC envelope around a PaymentMandate
  // (research forks only; AP2 v0.1 itself does NOT use W3C VCs).
  // Accepts both v2 array form and v1 string form.
  if (Array.isArray(response?.type)
      && response.type.includes('VerifiableCredential')
      && response.type.some(t => /paymentmandate/i.test(t))):
    return { detected: true, protocol: 'AP2' }
  if (response?.type === 'VerifiableCredential'
      && /paymentmandate/i.test(response?.credentialSubject?.type ?? '')):
    return { detected: true, protocol: 'AP2' }

  // Tool name heuristic, last resort only, lower reliability
  // Note: this local list is NOT the transactionTools init option from @atrib/mcp.
  // transactionTools is merchant-configured; this list is agent-side pattern matching.
  const heuristicKeywords = ['create_order', 'complete_checkout', 'process_payment',
                              'place_order', 'purchase', 'checkout']
  if (heuristicKeywords.some(k => toolName.toLowerCase().includes(k))):
    return { detected: true, protocol: 'heuristic' }

  return { detected: false }
```

When a transaction is detected, the middleware emits a `transaction` attribution record (§1.2.4). The `content_id` is derived from the merchant's checkout endpoint URL per §1.2.2, making the transaction identifiable regardless of who signed it. The `creator_key` depends on which emission path is in use:

**Path 1:** Merchant-side emission (preferred).** The merchant configures `@atrib/mcp` with `transactionTools: ['checkout', 'complete_order']` (or equivalent tool names). When a call to one of these tools succeeds, `@atrib/mcp` emits a `transaction` record signed with the merchant's `ATRIB_PRIVATE_KEY` and writes an attribution context token to the response. This is the cleanest model: the merchant's key is on the transaction record, and the agent detects Path 1 by seeing the token in the response.

**Path 2:** Agent-side detection (fallback).** When the merchant has no atrib integration, the agent detects the transaction and emits the record itself, signed with the agent's `creatorKey`. The `content_id` is derived as follows by protocol:

- **ACP / UCP:** use `order.permalink_url` from the completion response as the server_url, with tool_name `"checkout"`. If the response is an `order_create` / `order_update` webhook event, use `data.permalink_url`. If neither is available (e.g., the merchant returned a minimal completion without an order URL), fall back to the MCP server URL of the tool that was called.

- **x402 / MPP:** use the HTTP endpoint URL that returned the `Payment-Receipt` header as the server_url, with tool_name `"checkout"`.

- **Heuristic:** use the MCP server URL of the tool that was called as the server_url, with the actual tool_name. This is the weakest case; the content_id identifies the tool, not the checkout endpoint specifically.

The session policy record MUST include a warning: `"transaction_emitted_by_agent"` when this path is taken.

**Path selection rule:** preventing double-emission.** The agent middleware MUST NOT emit a transaction record (Path 2) when the checkout tool response contains an attribution context token (i.e., `params._meta.atrib`, `tracestate: atrib=...`, or `X-atrib-Chain` is present in the response). The presence of an attribution token in the checkout response indicates that `@atrib/mcp` is installed on the merchant's server and has already emitted the transaction record (Path 1). Emitting a second record would create two transaction nodes for the same economic event, violating the single-transaction-per-session assumption in §4.6.1. When Path 1 is detected, the agent updates its session state with the inbound context token as normal, but skips transaction record emission.

In both paths, when Path 2 is taken, the record is submitted to the log immediately, not deferred, because the transaction event is the closing anchor of the attribution graph.

**Note (Heuristic detection is a fallback):** The tool name heuristic fires only when no protocol-level transaction signal is present. It is less reliable; a tool named `checkout` might be a UI component, not a payment completion. When heuristic detection fires, the transaction record's `event_type` is still `"transaction"` but the session policy record includes a warning: `"transaction_detected_by_heuristic"`. Merchants may choose to require protocol-level detection for settlement purposes by filtering on this warning in their verification workflow.

#### 5.4.6 Session Policy Record Creation

The session policy record (§4.5.3) is created at session initialization (§5.4.2) and updated as the session progresses. The middleware MUST populate it as follows:

- `context_id`: set at session init from the OTel trace ID.

- `merchant_policy`: URL fetched at init, or `"default"` if none was found.

- `creator_policies`: populated as creator policies are fetched during init. Each entry's `status` field reflects the negotiation outcome per §4.5.2.

- `agreed_policy`: set after negotiation completes.

- `applied_constraints.minimum_floors`: populated with all `minimum_own_share` values from creator policies that survived negotiation (Rules 1–5 of §4.5.2).

- `warnings`: appended throughout the session, on policy fetch failures, heuristic transaction detection, agent-side transaction emission (path 2 of §5.4.5), unknown modifier types, negotiation skips, and policy negotiation timeouts.

The session policy record is stored in memory and SHOULD be persisted to disk or a database at session end. It is made available to the merchant via a call to `interceptor.getSessionPolicyRecord(context_id)` on the object returned by `atrib()` (§5.4.1).

---

### 5.5 @atrib/verify: Merchant Verification Library

#### 5.5.1 Init Interface

```
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  logEndpoint:     'https://log.atrib.io/v1',    // OPTIONAL, default shown
  graphEndpoint:   'https://graph.atrib.io/v1',  // OPTIONAL, default shown
  resolveEndpoint: 'https://resolve.atrib.io/v1', // OPTIONAL, for remote calculation
  merchantKey:     process.env.ATRIB_MERCHANT_KEY, // OPTIONAL, for self-signing recommendations
})

// If merchantKey is not set:
// - verify() still works; it only needs the recommendation's calculated_by public key
// - calculate() with signWith: 'merchant' returns an unsigned recommendation
//   with a warnings entry: "merchantKey not set, recommendation unsigned"
// - calculate() never throws due to a missing key (degradation contract §5.8)
```

#### 5.5.2 Verifying a Settlement Recommendation

Given a settlement recommendation document (§4.7), the verifier independently reproduces the calculation and compares results.

```
const result = await verifier.verify(recommendationDoc)

// result shape:
{
  valid:        true,          // signature verifies AND calculation matches
  signatureOk:  true,          // Ed25519 sig over document verified
  calcMatch:    true,          // local recalculation matches distribution within 1e-9
  distribution: { ... },       // local recalculation output (matches doc if calcMatch)
  warnings:     [],            // any non-fatal issues encountered
  graph_node_count: 4         // number of nodes used in calculation
}
```

The verifier fetches the graph at the tree size specified in `graph_tree_size`, fetches the session policy record identified by `policy_record_id`, fetches the agreed policy document, and runs the calculation algorithm (§4.6) locally. It does not call the resolution API.

#### 5.5.3 Post-Hoc Calculation (No Agent SDK)

When no agent SDK was present during the session, no session policy record exists. The merchant can still calculate using the default policy:

```
const recommendation = await verifier.calculate({
  context_id:   '4bf92f3577b34da6a3ce929d0e0e4736',
  policy:       'default',                  // or a policy document object
  signWith:     'merchant',                 // signs with merchantKey from init
})

// recommendation is a signed settlement recommendation document (§4.7)
// with policy_record_id: "default" and calculated_by: "local"
```

The verifier fetches the graph for the given `context_id`, applies the specified policy, runs the algorithm, and returns a signed recommendation. This path corresponds directly to Rule 7 of §4.5.2.

---

### 5.6 Key Management

#### 5.6.1 Key Generation

All atrib SDKs use the same Ed25519 key format defined in §1.4.1. A keypair can be generated using the atrib CLI:

```
npx @atrib/cli keygen

// Output:
ATRIB_PRIVATE_KEY=base64url(32-byte-ed25519-seed)
ATRIB_PUBLIC_KEY=base64url(32-byte-ed25519-public-key)

// ATRIB_PRIVATE_KEY stores the 32-byte seed only (not concatenated with the public key).
// The public key is deterministically derived from the seed at runtime.
// Only ATRIB_PRIVATE_KEY needs to be stored and secured.
```

**Note (Ed25519 seed vs expanded key):** Some Ed25519 libraries use a 64-byte "expanded" or "NaCl" format that concatenates the seed with the derived public key. atrib stores and transmits only the 32-byte seed. The public key is derived at runtime using standard Ed25519 scalar multiplication. Implementations MUST accept only 32-byte seeds in ATRIB_PRIVATE_KEY and MUST NOT accept or produce 64-byte concatenated formats as key values, to prevent confusion between key representations across implementations.

#### 5.6.2 Environment Variable Convention

The canonical environment variable names are:

| Variable           | Used by                  | Contents                                                                                                                                                                                                                  |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATRIB_PRIVATE_KEY  | @atrib/mcp, @atrib/agent | Base64url-encoded 32-byte Ed25519 seed. The public key is derived from this at runtime. This is the only value that needs to be stored and secured. See §5.6.1 for the distinction between seed and expanded key formats. |
| ATRIB_MERCHANT_KEY | @atrib/verify            | Base64url-encoded 32-byte Ed25519 seed used to sign settlement recommendations produced by post-hoc calculation. Uses the same format as ATRIB_PRIVATE_KEY.                                                               |
| ATRIB_LOG_ENDPOINT | @atrib/mcp, @atrib/agent | Optional. Override for the Merkle log submission endpoint. Overrides the `logEndpoint` init option.                                                                                                                       |

#### 5.6.3 Key Storage Requirements

The private key signs every attribution record emitted by the creator. Compromise of the private key allows forged attribution records to be submitted to the log under the creator's identity. Implementations MUST enforce the following:

- The private key MUST NEVER appear in logs, error messages, attribution records, or any transmitted data.

- The private key MUST NEVER be embedded in source code or committed to version control. The `ATRIB_PRIVATE_KEY` environment variable convention exists specifically to prevent this.

- In production deployments, the private key SHOULD be stored in a secrets manager (AWS Secrets Manager, HashiCorp Vault, or equivalent) and injected at runtime.

- SDK implementations MUST zero the key material from memory after use when the runtime supports it.

**Key compromise in v1** In v1 there is no key rotation mechanism (deferred to a future revision per §1.8). A compromised key cannot be revoked within the protocol; it can only be abandoned. Creators who believe their key has been compromised should generate a new key, publish a public attestation linking their old and new keys, and begin submitting records under the new key. The attestation document format is not specified in v1; a normative format will be defined in a future revision.

---

### 5.7 Automation Triggers (Normative)

This section is normative. A conforming implementation MUST fire each trigger at exactly the stated moment, with exactly the stated behavior. Implementations MUST NOT require developer input to activate any trigger. Implementations MUST NOT expose configuration options for suppressing individual triggers.

| Trigger              | When                                                                                                        | Package      | Action                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| session_init         | Before the first outbound `tools/call` in a session                                                         | @atrib/agent | Establish context_id, generate session_token, fetch and negotiate policies, create session policy record (§5.4.2).                                                                                                                                                                                  |
| tool_call_outbound   | Immediately before every outbound `tools/call` request is sent                                              | @atrib/agent | Attach attribution context token to request headers and `params._meta` (§5.4.3).                                                                                                                                                                                                                    |
| tool_call_inbound    | Immediately after every inbound `tools/call` response is received, if `isError: false`                      | @atrib/agent | Read and store attribution context from response. Update session state (§5.4.4). Check for transaction signal (§5.4.5).                                                                                                                                                                             |
| tool_served          | Immediately after a tool handler completes successfully (`isError: false`), before the response is returned | @atrib/mcp   | Construct, sign, and write attribution record (event_type: `"tool_call"` or `"transaction"` if tool is in `transactionTools`). Attach context token to response (§5.3.3–5.3.4). Submit to log (synchronously for transaction records, asynchronously for tool_call records per §5.3.5).               |
| transaction_detected | When `detectTransaction()` returns `true` during `tool_call_inbound` processing                             | @atrib/agent | Apply path selection rule (§5.4.5): if attribution token is present in the response, Path 1 is in use: update session state and skip emission. If no token, Path 2 applies: emit a `transaction` record, submit to log immediately (high priority, non-blocking), finalize session policy record. |
| task_created         | When a `tasks/create` response is received                                                                  | @atrib/agent | Store the task ID and associate it with the current session context. Continue forwarding attribution context on subsequent requests within the task.                                                                                                                                                |
| task_completed       | When a task polling response indicates completion                                                           | @atrib/agent | Treat task completion as a successful `tools/call` response. Apply `tool_call_inbound` trigger logic to the final task result.                                                                                                                                                                      |

---

### 5.8 Degradation Contract

atrib must never impair the primary function of a tool or agent. The attribution infrastructure is invisible infrastructure; it either works silently or fails silently. It does not fail loudly.

The degradation contract is:

**Any exception thrown inside an atrib trigger handler MUST be caught by the middleware.** Exceptions MUST NEVER propagate to the tool handler, the agent, or the calling code. The middleware MUST log the exception at warning level using a prefixed label (`"atrib:"`) and continue as if the trigger did not fire.

**Any network failure during log submission MUST be handled silently with retry.** This applies equally to `tool_call` and `transaction` records; both use exponential backoff with max 3 attempts over a 30-second window. Transaction records are queued at higher priority than tool_call records but are not submitted synchronously. If all retries fail, the signed record is cached locally. The tool or agent response is not affected in any case.

**Any timeout during policy negotiation MUST fall back to the default policy.** The timeout window is 3 seconds (§5.4.2). The session proceeds under default policy. The session policy record records the timeout.

**Any missing attribution context in an inbound response is not an error.** The tool simply didn't have `@atrib/mcp` installed. An OTel gap node represents this hop. The session continues.

**If `ATRIB_PRIVATE_KEY` is not set at init, the middleware MUST log a warning and operate in pass-through mode.** Pass-through mode: all requests and responses are forwarded without modification, no attribution records are emitted, no context is attached. The tool or agent operates as if the `atrib()` wrapper were not present.

The degradation contract means a developer can add `@atrib/mcp` or `@atrib/agent` to a production system with zero risk of introducing failures.
