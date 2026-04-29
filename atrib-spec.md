# atrib

**Version 0.1, April 2026**

Editor: Nader Helmy

This specification defines the atrib protocol for verifiable agent actions. When an AI agent calls a tool, atrib creates a signed record at the moment of action, chains it forward into the next call, and commits it to an append-only Merkle log. Any party can independently verify what an agent did, in what order, with what causal structure. When tool calls converge on a transaction, a deterministic algorithm computes a value distribution from the resulting graph under an agreed policy, producing a settlement document anyone can recompute. The spec covers the record format ([§1](#1-attribution-record-format)) including key rotation ([§1.9](#19-key-rotation-and-revocation)) and URI-typed event vocabulary ([§1.2.4](#124-event_type-values), [§1.4.5](#145-event_type-uri-validation)), the log protocol ([§2](#2-merkle-log-protocol)), the graph model ([§3](#3-graph-query-interface)), policies and the distribution algorithm ([§4](#4-attribution-policy-format)), the SDK middleware contracts ([§5](#5-sdk-specification)), the public-key directory ([§6](#6-key-directory)), and informative integration patterns for agent harnesses ([§7](#7-harness-integration-patterns)).

---

## Table of Contents

- [§0 Foundations](#0-foundations)
- [§1 Attribution Record Format](#1-attribution-record-format) (incl. [§1.9](#19-key-rotation-and-revocation) Key Rotation and Revocation)
- [§2 Merkle Log Protocol](#2-merkle-log-protocol)
- [§3 Graph Query Interface](#3-graph-query-interface)
- [§4 Attribution Policy Format](#4-attribution-policy-format)
- [§5 SDK Specification](#5-sdk-specification)
- [§6 Key Directory](#6-key-directory)
- [§7 Harness Integration Patterns](#7-harness-integration-patterns) (informative)
- [Appendix A: Test Vectors](#appendix-a-test-vectors)

---

## §0 Foundations

_This section is informative._

Contents

- [The Problem We Inherit](#the-problem-we-inherit)
- [The Shift We Are Living Through](#the-shift-we-are-living-through)
- [What We Are Building](#what-we-are-building)
- [Principle I: Provenance travels with the artifact](#principle-i-provenance-travels-with-the-artifact)
- [Principle II: Accountability without content exposure](#principle-ii-accountability-without-content-exposure)
- [Principle III: Settlement is separate from attribution](#principle-iii-settlement-is-separate-from-attribution)
- [Principle IV: No central arbiter of value](#principle-iv-no-central-arbiter-of-value)
- [Principle V: The protocol is open. The product is commercial.](#principle-v-the-protocol-is-open-the-product-is-commercial)
- [What the Substrate Enables](#what-the-substrate-enables)
  - [I. Provable cognition (recall)](#i-provable-cognition-recall)
  - [II. Independent audit and compliance](#ii-independent-audit-and-compliance)
  - [III. Cross-agent provenance and handoffs](#iii-cross-agent-provenance-and-handoffs)
  - [IV. Settlement, attribution, and the post-advertising web](#iv-settlement-attribution-and-the-post-advertising-web)

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

**The agent economy is already generating real activity with zero verifiable record of it.** Every tool call that completes without a signed record is invisible to anyone but the platform that ran it. Transactions that close on top of that activity inherit the same gap (value pools at the platform layer rather than distributing to the contributors who caused it), but the missing substrate is not only an economic problem. It is also a cognitive one. Agents that cannot verify their own past behave like amnesiacs every conversation, deferring to the platform's memory rather than reasoning from their own. The gap is in observability, accountability, and cognition simultaneously. Same shape as the old web. Higher stakes. Faster clock.

The window to build this substrate before platforms absorb the problem (and solve it, as Google solved it, in a way that reconstitutes their centrality) is measured in months, not years.

---

## What We Are Building

atrib is the substrate that makes agent actions verifiable. Every tool call becomes signed context for the next, anchored in a Merkle log, independently verifiable by anyone. Not an identity layer. Not a payment layer. Not a content attribution system. The thing that sits underneath all of those: **a substrate where agents reason from a past they can prove, and downstream consumers (merchants, auditors, other agents) verify that past without trusting any operator.**

The central claim is this: it is possible to make the structural relationships of agent activity transparent (what tool calls preceded what outcomes, how contributions linked together within a session, what the observable shape of an agent's reasoning trail actually was) without making the content of those interactions visible to anyone who should not see it. Several distinct uses follow from this substrate: provable recall by the agent itself, independent audit by third parties, settlement when commerce closes a chain, and verifiable causality across handoffs between agents.

This is observability without surveillance. The system becomes legible to itself (to its participants, to the parties with a legitimate stake in its outcomes) without becoming legible to surveillance. Accountability without inspection. Transparency without exposure.

This distinction matters because every prior attempt at provenance has collapsed it. C2PA proves a certificate exists but cannot say what it caused. ProRata tracks content usage but keeps advertising as the economic model. Blockchain provenance systems make everything visible to everyone, which is privacy-hostile by design. OpenTelemetry makes systems observable to their operators but invisible to participants.

atrib is built on a different principle: **you can record what happened and who was present without claiming to know what caused what, and you can distribute credit fairly without trusting any single intermediary to arbitrate it.** The structure of contributions is a verifiable fact. What those contributions are worth is a policy judgment. atrib provides the former without pretending to settle the latter.

### What atrib certifies, what it does not

atrib certifies five structural axes of agent activity: who acted (identity, via signature), what they did (event_type), when (timestamp), in what order (chain_root and the ordering edges of [§3](#3-graph-query-interface)), and what the agent claims informed each action (the `informed_by` and `provenance_token` fields, surfaced as INFORMED_BY and PROVENANCE_OF edges in [§3](#3-graph-query-interface)).

atrib does NOT certify that the agent's reasoning is truthful, that prior records actually influenced subsequent decisions, or that tool responses were real absent tool-side attestation. The substrate is content-preserving (commitments, not content) and disclosure-configurable (the privacy postures of [§8](#8-privacy-postures) let the harness pick how much each record reveals).

This positioning is load-bearing. Brand promises that exceed what the substrate certifies create the same trust mismatch atrib was built to fix. [§3](#3-graph-query-interface) "What atrib chains, what it does not" gives the detailed structural-axis enumeration; [§7.6](#76-outcome-verification-patterns) documents the outcome-verification patterns that close the tool-response gap when consumers need it.

### Principle I: Provenance travels with the artifact

Every tool call, every content retrieval, every agent action carries a signed record of its origin and its structural position in the session: who called what, in what order, in what context. This record is embedded at creation time, not appended later, not inferred from logs. It is native to the interaction, not a post-hoc annotation. What those structural relationships mean for value distribution is a question for the policy layer, not for the record itself.

### Principle II: Accountability without content exposure

What is published globally is not the content of interactions but cryptographic commitments to them. Anyone can verify that an attribution record existed and was unaltered. No one can read what it contained without the holder's consent. Privacy and accountability are not in tension here; they are structurally separated.

### Principle III: Settlement is separate from attribution

atrib records what happened and who contributed. It does not move money, enforce agreements, or determine outcomes. Payment rails, legal agreements, and business decisions happen on top of verified attribution data. The protocol is neutral about what participants do with the truth; it only insists that the truth be available.

### Principle IV: No central arbiter of value

The attribution chain is verifiable by any party with the relevant records. No single operator can alter it, suppress it, or adjudicate disputes about it. The Merkle log provides global verifiability without global visibility. Trust comes from mathematics and open specification, not from trusting atrib.

### Principle V: The protocol is open. The product is commercial.

The specification, the signing libraries, the calculation algorithm, and the log software are open. Anyone can run their own log, build their own graph service, and run the calculation locally. atrib operates a hosted graph service, analytics, and managed log at `atrib.dev` as a commercial product built on the open protocol. Using the hosted service is a convenience, not a requirement.

---

## What the Substrate Enables

The five principles above describe a substrate. What the substrate enables is a set of distinct uses, each of which collapses without it. None of them is the central claim. atrib is not "for" any single one. The claim is that the substrate is a precondition for all of them, and that no other piece of infrastructure today provides it.

The four uses below are ordered by how directly each relies on the substrate's load-bearing property: that an agent's actions are signed at the moment they happen and remain independently verifiable thereafter.

### I. Provable cognition (recall)

An agent that can verify its own past has a kind of memory the agent ecosystem has not previously had. Every prior tool call is a signed claim the agent itself can re-verify locally; every chain is a structured artifact the agent can reason from; every transaction it participated in is anchored in a public log it cannot be gaslit about. This is the loop the locked positioning points at: _agents that reason from a past they can prove._

The cognitive consequence is concrete. An agent restoring context from its own atrib records (rather than from platform-controlled memory) cannot be quietly amended. It cannot have actions silently retroactively added or removed. It cannot inherit a falsified history if its harness is replaced. The substrate is the only mechanism by which an agent's continuity of self survives platform changes, model changes, or harness changes, because the cryptography is independent of all of them.

This is the use case the protocol's recall pattern ([§7](#7-harness-integration-patterns)) tests in practice: real agents (Claude Code, Cursor, custom harnesses) consuming the substrate they themselves produce. If the substrate works, the agent is more capable. If the substrate is broken, the agent is no worse off than today.

### II. Independent audit and compliance

Once an agent's actions are signed and committed to a public log, third parties can audit them without trusting the agent or the platform. A user can prove what an agent did on their behalf. A regulator can query "what did this agent do at time T?" and get a cryptographic answer. A merchant disputing a transaction can verify the chain that led to it. None of this requires the agent operator to cooperate, share data, or even be online.

This is the property that compliance-coded products (audit trail, SOC 2 reporting, AI governance tooling) approximate without the underlying substrate. The substrate does it correctly: not by collecting more data centrally but by making the data anyone already had cryptographically verifiable.

### III. Cross-agent provenance and handoffs

Agents that hand off work to other agents (a delegation flow, a multi-agent system, a marketplace of specialized agents) face the same provenance problem at higher complexity. A signed action by agent A passing context to agent B carries verifiable causality across the handoff: B can prove A actually requested this, A can prove B actually completed it, and any later observer can reconstruct the path.

Without the substrate, multi-agent flows reduce to "trust whoever is closest to the platform." With it, the chain is the trust.

### IV. Settlement, attribution, and the post-advertising web

The substrate produces a useful side effect: when commerce closes a chain (an agent purchases something, a tool is invoked in service of a transaction), the same signed record set is what a settlement document is computed from. The [§4.6](#46-the-calculation-algorithm) algorithm runs deterministically over the graph and produces a value distribution any merchant or auditor can recompute. This is the attribution-economy use case, and it is genuinely real, but it is one consequence of the substrate, not the reason for it.

The deeper claim about advertising follows from this. We do not claim that advertising will disappear. We claim that the structural necessity of advertising as the primary funding model for the internet rests on a single foundation: the absence of native provenance infrastructure. When that foundation erodes, the model built on it becomes optional rather than inevitable.

Businesses will always need to reach new customers. Discovery is a real problem that advertising partially solves. But the attribution function of advertising (proving that a specific message caused a specific outcome, in order to justify the spend) is entirely a workaround for missing infrastructure. When the infrastructure exists, the workaround becomes unnecessary.

The agent economy provides the discovery layer. Agents surface products, synthesize recommendations, complete transactions, all without requiring the user's attention to be purchased. The substrate underneath that discovery layer means every action is signed at the moment it happens, every chain is independently verifiable, and credit follows contribution without any intermediary needing to own the pipe. **That is not advertising replacement through disruption. It is advertising replacement through making the problem advertising was solving obsolete.**

The internet was built to move information freely. It failed to move value fairly. That failure was not inevitable; it was a consequence of building a network without provenance infrastructure, and then watching the vacuum fill with surveillance capitalism.

We are building at a moment when the architecture of the web is being renegotiated. Agents are replacing browsers as the primary interface. Protocols are being written that will determine how value flows for the next generation. **The question of who owns the substrate in this new architecture will determine whether we reproduce the extractive dynamics of the old web or build something structurally different.**

atrib is a bet that the answer does not have to be a company. It can be a protocol, open and verifiable, with a company that builds the best products on top of it.

---

A note on consumers of the substrate: atrib is the layer that signs, chains, logs, and verifies. The ergonomic interfaces an agent uses to consume it (what we'd call agent harnesses or runtimes) are downstream. A harness might surface the agent's atrib history at session start, expose a recall tool the agent can call, or persist signed records to a local mirror. These are all consumer-side concerns. atrib does not prescribe a harness. The substrate is independently useful to any harness that wants to give its agent the contextual awareness verifiable history makes possible.

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
  - [1.4.5 event_type URI validation](#145-event_type-uri-validation)
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
- [1.8 Scope Boundaries](#18-scope-boundaries)
- [Interoperability Roadmap](#interoperability-roadmap)

### 1.1 Normative Requirements Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119 and RFC 8174.

#### 1.1.1 Conformance Targets

This specification defines requirements for four conformance targets:

- **MCP server middleware**: satisfies all MUST requirements in [§1.2](#12-the-attribution-record)-[§1.5](#15-context-propagation), [§2.3](#23-log-entry-format), [§2.6](#26-submission-api-write-interface), and [§5.3](#53-atribmcp-mcp-server-middleware).
- **Agent middleware**: satisfies all MUST requirements in [§1.5](#15-context-propagation), [§1.7](#17-transaction-event-hooks), [§4.5](#45-session-negotiation), and [§5.4](#54-atribagent-agent-middleware).
- **Log operator**: satisfies all MUST requirements in [§2](#2-merkle-log-protocol).
- **Verification library**: satisfies all MUST requirements in [§4.6](#46-the-calculation-algorithm), [§4.7](#47-settlement-recommendation-document), and [§5.5](#55-atribverify-merchant-verification-library).

A graph query service, when implemented, must satisfy all MUST requirements in [§3](#3-graph-query-interface). A witness, when implemented, must satisfy all MUST requirements in [§2.9](#29-witnessing-and-cosignatures).

All normative requirements in this section are prefixed with their requirement level. A conforming implementation satisfies all MUST requirements and is RECOMMENDED to satisfy all SHOULD requirements.

#### 1.1.2 Roles: validator vs verifier

This specification uses two role terms with distinct meanings:

- **Validator** (log-side admission): the log operator's submission pipeline that decides whether to accept an incoming record into the log. Validators apply [§2.6.1](#261-submit-entry) checks (record format, signature, chain integrity, scope constraints like the genesis-record-only rule for `provenance_token` per [§1.2.6](#126-provenance_token)). A validator's output is binary: admit or reject.
- **Verifier** (consumer-side audit): a downstream consumer that reads records and assesses trust. Verifiers apply [§4.6](#46-the-calculation-algorithm) calculation, [§6.7](#67-capability-declarations) capability checks, [§2.11](#211-cross-log-replication) cross-log threshold and equivocation detection, and the [§8.7](#87-adversarial-threat-model) trust assessment stack. A verifier's output is rich (validity flags, signals, annotations); the verifier never modifies records.

Spec text uses "validator" when describing log-admission behavior and "verifier" when describing consumer-side assessment. When both roles can perform the same check (e.g., signature verification), the spec specifies which role MUST perform it.

---

### 1.2 The Attribution Record

An attribution record is the atomic unit of atrib provenance. Each record documents a single event in an attribution chain (a tool call, a transaction) and cryptographically binds that event to its creator, its position in the chain, and the session that contains it. The chain is structural, not causal: it records what happened and how records relate to each other, not why one event caused another. Causal interpretation belongs to the query and policy layers built on top of these records.

An attribution record is a JSON object. Two shapes exist depending on `event_type`: the standard shape (used by `tool_call`, `observation`, and extension records) carries a single top-level `signature`; the transaction shape (used by `transaction` records) carries a `signers` array per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) instead. Both shapes share the same field set otherwise.

**Standard shape (tool_call, observation, extension):**

```
{
  "spec_version":          "atrib/1.0",
  "content_id":            "sha256:",        // who served this (see §1.2.2)
  "creator_key":           "",
  "chain_root":            "sha256:",        // hash of parent record, or context_id for genesis (see §1.2.3)
  "event_type":            "https://atrib.dev/v1/types/tool_call", // absolute URI; see §1.2.4
  "context_id":            "",               // 32 hex chars (see §1.5.1)
  "timestamp":             1743850000000,    // Unix milliseconds, integer
  "timestamp_granularity": "ms",             // OPTIONAL (see §8.4); default "ms" when absent
  "informed_by":           ["sha256:"],      // OPTIONAL (see §1.2.5); agent's claimed reasoning context
  "provenance_token":      "",               // OPTIONAL (see §1.2.6); genesis-record-only; cross-session anchor
  "args_salt":             "",               // OPTIONAL (see §8.3); reveals salt for salted-sha256 args_hash
  "result_salt":           "",               // OPTIONAL (see §8.3); reveals salt for salted-sha256 result_hash
  "session_token":         "",               // OPTIONAL (see §1.5.5); omitted when not in a cross-trace session
  "signature":             ""
}
```

**Transaction shape:**

```
{
  "spec_version":          "atrib/1.0",
  "content_id":            "sha256:",        // merchant's checkout endpoint URL + ":checkout"
  "creator_key":           "",               // primary signer's key (typically the agent's)
  "chain_root":            "sha256:",
  "event_type":            "https://atrib.dev/v1/types/transaction",
  "context_id":            "",
  "timestamp":             1743850000000,
  "timestamp_granularity": "ms",             // OPTIONAL
  "informed_by":           ["sha256:"],      // OPTIONAL
  "provenance_token":      "",               // OPTIONAL; genesis-record-only
  "session_token":         "",               // OPTIONAL
  "signers": [                               // REQUIRED for transaction records (§1.7.6)
    { "creator_key": "agent-key",        "signature": "..." },
    { "creator_key": "counterparty-key", "signature": "..." }
  ]
}
```

#### 1.2.1 Field Definitions

| Field         | Type    | Req  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec_version  | string  | MUST | Always the literal string `"atrib/1.0"` for records conforming to this specification. Implementations MUST reject records with unknown spec_version values rather than attempting to process them.                                                                                                                                                                                                                                                      |
| content_id    | string  | MUST | A prefixed hex-encoded SHA-256 digest identifying the specific creator and tool that produced this record. See [§1.2.2](#122-content_id-derivation) for derivation. Format: `"sha256:"` followed by 64 lowercase hex characters.                                                                                                                                                                                                                                                      |
| creator_key   | string  | MUST | The creator's Ed25519 public key, encoded as base64url (RFC 4648 §5, no padding). 43 characters. This is the stable identity of the creator across all their records. It is not an ephemeral session key.                                                                                                                                                                                                                                               |
| chain_root    | string  | MUST | A prefixed hex-encoded SHA-256 digest anchoring this record in the chain. For non-genesis records: the hash of the parent attribution record's canonical serialization (see [§1.3](#13-canonical-serialization)). For genesis records: the hash of the context_id string. See [§1.2.3](#123-chain_root-for-genesis-records).                                                                                                                                                                                                  |
| event_type    | string  | MUST | An absolute URI identifying the type of event this record documents. atrib's normative URI set is defined in [§1.2.4](#124-event_type-values); consumers MAY mint extension URIs in their own namespaces. URI form is validated per [§1.4.5](#145-event_type-uri-validation). atrib does not require URI recognition for verification; an unrecognized but syntactically-valid extension URI does not block signature verification.                                                                                                                                                                                                                                                                                                    |
| context_id    | string  | MUST | The W3C Trace Context trace-id of the OTel trace containing this event. 32 lowercase hex characters. This is the join key that connects attribution records to each other and to transaction events. See [§1.5.1](#151-context_id-the-session-anchor).                                                                                                                                                                                                                                        |
| timestamp        | integer | MUST | Unix time in milliseconds as a JSON integer. MUST NOT be a string, float, or ISO 8601 date. MUST NOT be in the future. Implementations SHOULD reject records with timestamps more than 5 minutes in the future relative to local clock. The value MAY be coarsened (rounded to second/minute/hour/day boundaries) per the [§8.4](#84-coarsened-timing-posture) timing posture; when coarsened, the granularity MUST be declared explicitly via the `timestamp_granularity` field. |
| informed_by      | array   | MAY  | Array of `"sha256:" + hex(record_hash)` strings identifying records the agent claims informed this action. Hashes MUST be sorted lexicographically by the hex string (deterministic ordering). Empty or absent when the record makes no provenance claim. The graph layer derives INFORMED_BY edges from this field ([§3.2.3](#323-edge-types)). atrib does not validate truthfulness of the claim. See [§1.2.5](#125-informed_by) and [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type). |
| provenance_token | string  | MAY  | Base64url-encoded 16-byte opaque token for cross-session causal anchoring. Distinct from session_token: provenance_token says "this session descends from that anchor" (causal); session_token says "this is the same logical session" (continuation). Carried ONLY by the genesis record of a session that claims an upstream anchor; non-genesis records MUST NOT carry it. Derived as the first 16 bytes of the upstream record's hash; upstream records carry no special field to be anchorable. The graph layer derives PROVENANCE_OF edges from this field ([§3.2.3](#323-edge-types)). See [§1.2.6](#126-provenance_token) and [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring). |
| session_token    | string  | MAY  | Base64url-encoded 16-byte opaque token identifying the logical session across OTel trace boundaries. Present only when the record was emitted in a cross-trace session. When present, the graph query layer uses this field to construct CROSS_SESSION edges between records with different context_ids that share the same session_token. See [§1.5.5](#155-cross-trace-session-continuity). The session_token field is included in the canonical serialization and covered by the signature. |
| signature        | string  | MUST for non-transaction records | Ed25519 signature over the canonical serialization of the record with the signature field omitted, encoded as base64url (RFC 4648 §5, no padding). 86 characters. See [§1.4](#14-signing-and-verification) for the full signing procedure. Transaction records (`event_type = transaction`) carry the `signers` array per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) instead of (or in addition to) this top-level field. |
| signers          | array   | MUST for transaction records, MUST NOT for others | Array of `{ creator_key, signature }` objects, one per cross-attestation party. Required on transaction records ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records)); MUST NOT appear on tool_call, observation, or extension records. Minimum 2 entries (typically agent + counterparty). All signers cover the same canonical bytes: the JCS serialization of the record with `signers: []` and `signature` omitted. |
| timestamp_granularity | string | MAY  | Declares the coarsening granularity of `timestamp` per the [§8.4](#84-coarsened-timing-posture) timing posture. Allowed values: `"ms"` (default when absent), `"s"`, `"min"`, `"h"`, `"d"`. Verifiers MUST reject records where the declared granularity does not match the value's trailing-zero pattern (e.g., `timestamp_granularity: "min"` requires `timestamp % 60000 == 0`). |
| args_salt        | string  | MAY  | Base64url-encoded random salt (≥16 bytes) revealing the salt used to compute a `salted-sha256` `args_hash` per [§8.3](#83-salted-commitment-posture). Presence indicates the salted-commitment posture for args; absence with no `args_salt` and a verifiable plain hash indicates default posture. |
| result_salt      | string  | MAY  | Base64url-encoded random salt (≥16 bytes) revealing the salt used to compute a `salted-sha256` `result_hash` per [§8.3](#83-salted-commitment-posture). Same posture-detection semantics as `args_salt`. |

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

**Note (Server URL Normalization):** Before hashing, implementations MUST normalize the server URL: lowercase the scheme and host, remove any trailing slash from the path, and preserve the port if explicitly specified. Query strings and fragments are excluded. A server at `HTTPS://Tools.Example.Com/` and one at `https://tools.example.com` must produce the same content_id. Default ports (443 for HTTPS, 80 for HTTP) MUST be omitted. `https://tools.example.com:443` normalizes to `https://tools.example.com`. The server URL is the base URL of the MCP server, not individual tool endpoints.

#### 1.2.3 chain_root for Genesis Records

Every attribution chain begins with a genesis record: the first hop in a session that has no upstream atrib context. A record is a genesis record when the inbound context contains no `atrib` token (no `params._meta.atrib`, no `tracestate` atrib entry, no `X-Atrib-Chain` header), OR when the token is present but malformed (cannot be decoded by the procedure in [§1.5.2](#152-http-transport-tracestate)). In both cases, `chain_root` is computed as the genesis chain root per the formula below.

For a genesis record, the `chain_root` MUST be computed as:

```
chain_root = "sha256:" + hex(SHA-256(UTF-8(context_id)))
```

This anchors every genesis record to its session without requiring a parent record. It is verifiable by any party who knows the context_id.

**Normative clarification:** Both `chain_root` and the propagation token's `record_hash` component are computed over the JCS canonicalization of the COMPLETE signed record, INCLUDING the `signature` field. This differs from the signing input ([§1.3](#13-canonical-serialization)), which EXCLUDES the `signature` field. Specifically:

- Signing input: `JCS(record without signature)` -- used for Ed25519 sign/verify
- Record hash: `SHA-256(JCS(complete record with signature))` -- used for `chain_root` and propagation token
- chain_root format: `"sha256:" + hex(record_hash)` -- prefixed hex encoding of the record hash
- Token format: `base64url(record_hash) + "." + base64url(creator_key)` -- base64url encoding of raw bytes

A receiving implementation that decodes a propagation token and needs to set `chain_root` MUST convert: `chain_root = "sha256:" + hex(decoded_token.record_hash)`.

#### 1.2.4 event_type Values

`event_type` is an absolute URI. atrib publishes a small canonical core vocabulary; consumers MAY mint their own extension URIs in any namespace they control. atrib does not gate, register, or approve extension URIs; [D035](DECISIONS.md#d035-extensible-event_type-vocabulary-via-uri-typing) establishes the URI-typing mechanism, and [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) defines the bar for promoting an extension URI to atrib's normative set.

**Normative URI set:**

| URI                                                | Binary | Meaning                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://atrib.dev/v1/types/tool_call`             | `0x01` | An agent invoked a tool with input(s) and received a result. Emitted by an MCP server when it returns a successful (non-error) response to a `tools/call` request. MUST NOT be emitted when `isError: true` in the MCP result. Default for any active operation against external state.                                                                                |
| `https://atrib.dev/v1/types/transaction`           | `0x02` | A commerce-protocol-detected closing event (ACP / UCP / x402 / MPP / AP2 / a2a-x402; see [§1.7](#17-transaction-event-hooks)). Emitted when a transaction completes, either by the merchant's agent writing a record, or by the atrib SDK reading a transaction webhook. The `content_id` for a transaction record uses the merchant's checkout endpoint URL as the server_url and `"checkout"` as the tool_name. [§4.6](#46-the-calculation-algorithm) calculation is normatively gated on this URI. |
| `https://atrib.dev/v1/types/observation`           | `0x03` | A passive perception captured by an ambient watcher or input source. The agent did not invoke a tool to produce this record; the record captures something the agent received from its environment. Has no caller-supplied input and no return value to attest to. Distinct from `tool_call` in that there is no agent-chosen action.                                  |

**Extension URIs:** Any absolute URI in a non-`atrib.dev` namespace is a valid extension URI. The 1-byte log entry slot ([§2.3.1](#231-entry-serialization)) maps such URIs to the byte `0xFF` (extension type); verifiers wanting to filter by the URI itself read the URI from the record. Extension URIs SHOULD identify a stable owner (a domain the consumer controls or a `urn:` namespace they registered); atrib does not enforce ownership.

#### 1.2.5 informed_by

The `informed_by` field carries the agent's claimed reasoning context: an array of `"sha256:" + hex(record_hash)` strings identifying records the agent claims informed this action. The field is OPTIONAL (per [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)); records without it make no provenance claim.

**Format.** Each entry is a `"sha256:"` prefix followed by 64 lowercase hex characters, matching the `chain_root` format. The array MUST be sorted lexicographically by the hex string. Sorting is required for canonical serialization stability: an agent-side ordering choice would otherwise affect signatures.

**Semantics.** A record with `informed_by: ["sha256:abc...", "sha256:def..."]` claims the agent consulted those two referenced records before deciding to emit this record. The references MAY point at records in the same session, a different session of the same `creator_key`, or a session of a different `creator_key`. There is no requirement that the referenced records actually exist in any particular log; the verifier resolves what it can and surfaces dangling references ([§3.2.3](#323-edge-types) INFORMED_BY edge with `dangling: true`).

**Trust posture.** atrib certifies that the holder of the `creator_key` signed a record carrying these claims. atrib does NOT certify that the referenced records actually informed the agent's decision. Truthfulness verification (cross-checking referenced content against the action) is a downstream concern.

#### 1.2.6 provenance_token

The `provenance_token` field carries an opaque token used for cross-session causal anchoring. It is OPTIONAL; records without it make no ancestry claim.

**Format.** Base64url-encoded 16 bytes (RFC 4648 §5, no padding). 22 characters.

**Scope constraint.** `provenance_token` MUST appear ONLY on the genesis record of a session (the first record in a `context_id`). A session's ancestry is a session-level property; the genesis record is the natural place to declare it. Subsequent records in the session inherit ancestry implicitly via session membership. Both validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records carrying `provenance_token` when they are not the session's genesis record. Middleware ([§5.3](#53-atribmcp-mcp-server-middleware), [§5.4](#54-atribagent-agent-middleware)) SHOULD refuse to sign such records to prevent malformed submissions reaching the log.

**Derivation.** A session-genesis record claiming ancestry from upstream record U carries `provenance_token = base64url(SHA-256(JCS(U))[:16])` where U is the complete signed record (including its signature). The first 16 bytes of the SHA-256 record hash provide 2^128 collision resistance, sufficient for the cross-session anchor space.

**Upstream records carry no special field.** Any signed record in the log is implicitly anchorable. Downstream records reference it by truncated hash. The token is a downstream-side claim only; upstream records do not need to declare anchorability.

**Graph derivation.** The graph layer derives PROVENANCE_OF edges ([§3.2.3](#323-edge-types)) by searching for any record U whose first 16 bytes of `SHA-256(JCS(U))` match the token, with `U.context_id ≠ D.context_id`. Dangling references (token claimed but no matching upstream in the resolved set) are flagged with `dangling: true`.

**Distinction from session_token.** session_token ([§1.5.5](#155-cross-trace-session-continuity)) means *same logical session across OTel trace boundaries* (continuation of one task). provenance_token means *different session, causally anchored* (one session's first record descends from another's). They MAY coexist on the same genesis record (a session may both belong to a multi-trace logical session AND descend from a prior anchor).

**Relationship to `informed_by`.** provenance_token is a stricter, ergonomically-specialized subset of `informed_by` ([§1.2.5](#125-informed_by)):

| Property | `informed_by` | `provenance_token` |
|---|---|---|
| Cardinality | Multi-valued array | Single value |
| Scope | Per-record (any record may carry it) | Per-session (genesis record only) |
| Hash form | Full record_hash with prefix (~71 chars per entry) | Truncated 16 bytes (22 chars base64url) |
| Use case | Records this action consulted | This session's ancestry anchor |
| Cross-session API ergonomics | Not optimized for env-var / header passing | Designed for env-var / header / URL-param passing |

A consumer wanting full-precision multi-anchor cross-session references uses `informed_by` (which can include record_hashes from any session). provenance_token is the ergonomic shorthand for declaring a single ancestral anchor that can be passed across session boundaries via short tokens.

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
  "event_type":   "https://atrib.dev/v1/types/tool_call",
  "context_id":   "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp":    1743850000000,
  "signature":    "XYZ..."
}

// Remove signature field, apply JCS → signing input (lexicographic key order):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","spec_version":"atrib/1.0","timestamp":1743850000000}

// Record with session_token present (cross-trace sessions only):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","session_token":"base64url16bytes","spec_version":"atrib/1.0","timestamp":1743850000000}

// Record with informed_by present (agent claims reasoning context):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","informed_by":["sha256:abc...","sha256:def..."],"spec_version":"atrib/1.0","timestamp":1743850000000}

// Record with provenance_token (genesis-record-only):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","provenance_token":"22-char-base64url","spec_version":"atrib/1.0","timestamp":1743850000000}

// Record with timestamp_granularity (coarsened-timing posture):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","spec_version":"atrib/1.0","timestamp":1743850080000,"timestamp_granularity":"min"}

// Record with salted-commitment posture (args_salt + result_salt revealed):
{"args_salt":"base64url16+bytes","chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/tool_call","result_salt":"base64url16+bytes","spec_version":"atrib/1.0","timestamp":1743850000000}

// Transaction record signing input (signers array set to []; signature omitted):
{"chain_root":"sha256:7e1f4a...","content_id":"sha256:3f8a2b...","context_id":"4bf92f3577b34da6a3ce929d0e0e4736","creator_key":"ABC...","event_type":"https://atrib.dev/v1/types/transaction","signers":[],"spec_version":"atrib/1.0","timestamp":1743850000000}

// Notes:
// JCS sorts keys lexicographically (UTF-8 code-point order). No whitespace. No trailing newline.
// Absent field vs explicit empty value are different: a record without informed_by and one
// with "informed_by":[] produce different canonical forms and therefore different signatures.
// Always omit optional fields when not present.
// JCS field-order positions for the new optional fields (verify against your implementation):
//   args_salt, chain_root, content_id, context_id, creator_key, event_type, informed_by,
//   provenance_token, result_salt, session_token, signers, signature, spec_version,
//   timestamp, timestamp_granularity
// The informed_by array contents MUST be sorted lexicographically by hex string per §1.2.5;
// agent-side ordering would otherwise destabilize signatures.
// For transaction records, all signers in the signers array sign over identical bytes:
// the JCS form with signers:[] (empty array) and the top-level signature field omitted.
```

**Implementation Warning:** timestamp precision** The `timestamp` field MUST be a JSON integer (no decimal point, no exponent notation) representing milliseconds. A timestamp of `1743850000000` serializes as the integer `1743850000000` in JCS, not as `1.74385e12` or `"1743850000000"`. Incorrect serialization will produce a different signing input and cause signature verification to fail.

---

### 1.4 Signing and Verification

atrib uses Ed25519 (RFC 8032, [§5.1](#51-design-principle-zero-ongoing-surface-area)) for all attribution record signing. Ed25519 provides compact signatures (64 bytes), fast verification, strong security, and does not require a PKI or certificate authority. Each creator generates and controls their own keypair.

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

Step 2: Remove the `signature` field and apply JCS serialization ([§1.3](#13-canonical-serialization)) to obtain the signing input bytes.

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

Step 6: Verify that `event_type` is a syntactically-valid absolute URI per [§1.4.5](#145-event_type-uri-validation). Reject if not. The URI need not be in atrib's normative set; an extension URI passes this check. Recognition (whether the URI is in atrib's normative set or in a known extension namespace) is informational and does not gate verification.

Step 7: Verify that `timestamp` is not more than 5 minutes in the future. Reject if so.

Step 8: Verify that `context_id` is exactly 32 lowercase hex characters. Reject if not.

A record passes verification if and only if all eight steps succeed. A partial verification is not valid.

#### 1.4.4 Test Vector Validation

All implementations of Ed25519 signing and verification MUST be validated against the Wycheproof test vectors for EdDSA (github.com/C2SP/wycheproof, `testvectors_v1/eddsa_verify_test.json`) prior to production deployment. Any test vector marked `"result": "invalid"` that an implementation accepts is a security defect. Any test vector marked `"result": "valid"` that an implementation rejects is a compatibility defect.

**Note (Key Rotation):** Key rotation is normatively defined in [§1.9](#19-key-rotation-and-revocation) ([D033](DECISIONS.md#d033-key-rotation-and-revocation)).

#### 1.4.5 event_type URI Validation

This section defines the syntactic and structural validation that the `event_type` URI MUST satisfy. The validation is independent of whether the URI is in atrib's normative set or a consumer extension namespace; both must satisfy these rules.

**Required form.** The `event_type` value MUST be an absolute URI per RFC 3986 §4.3:

```
absolute-URI = scheme ":" hier-part [ "?" query ]
```

In practice this means:

1. The value MUST contain a scheme (e.g., `https`, `urn`) followed by `:`. Relative references (`/types/tool_call`), bare tokens (`tool_call`), and empty strings are invalid.
2. The scheme MUST consist of letters, digits, `+`, `-`, or `.` and MUST start with a letter, per RFC 3986 §3.1.
3. For the `https` scheme (the form atrib normative URIs use), the URI MUST have a non-empty authority component (host).
4. The URI MUST NOT contain a fragment (`#...`). Fragments are reserved for future use; including one invalidates the record.
5. The URI MUST be at most 256 octets in its UTF-8 encoding. Longer URIs are rejected. This bound is a defense against pathological inputs and is well above any reasonable URI length.

**Recommended discipline (not enforced).** Consumers minting extension URIs SHOULD:

1. Use a domain or `urn:` namespace they own, so the URI identifies a stable owner. Atrib does not validate ownership.
2. Use a versioned path (e.g., `https://example.com/atrib/v1/types/observation`) so the URI's semantics can evolve under new versions without breaking earlier records.
3. Publish a human-readable schema document at the URI (or at a related URL) so verifiers that want to interpret the type's content can resolve it. Atrib does not require resolution to succeed; resolution is opt-in.
4. Treat URIs as opaque identifiers. Two URIs that differ in any byte (including trailing slashes, case, or query parameters) are distinct types. Atrib does not normalize URIs before comparison.

**Validation procedure.** Given a candidate URI string `U`:

1. Decode `U` as UTF-8. If decoding fails, reject.
2. Verify `U.length <= 256` octets. If not, reject.
3. Verify `U` contains a `:` separating a non-empty scheme from a non-empty hier-part. If not, reject.
4. Verify the scheme matches the production `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`. If not, reject.
5. If the scheme is `http` or `https`, verify the URI contains a non-empty host (between the `//` and the next `/`, `?`, or end of string). If not, reject.
6. Verify `U` does not contain `#`. If it does, reject.

A URI passing all six steps is syntactically valid for use as `event_type`. Atrib normative URIs all pass these checks; conformance fixtures (§spec/conformance/1.4-extension/) include both passing and failing examples for verifier testing.

**Recognition versus validation.** Validation per this section determines whether a record is structurally well-formed and signature-verifiable. Recognition (whether the URI is in atrib's normative set, in a known extension namespace, or completely unknown) is a separate concern handled at the application layer. Verifiers MAY surface recognition as informational metadata in their output (`event_type_recognized`, `event_type_namespace`, etc.) but MUST NOT use recognition to gate verification.

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

For HTTP-transport payment protocol integrations ([§1.7](#17-transaction-event-hooks)), the agent MUST propagate the session's `context_id` as the `X-atrib-Context` HTTP header on outbound requests that may trigger transaction events. The header value is the raw 32-character lowercase hexadecimal context_id, not the propagation token.

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

**Note (session_token is optional):** Cross-trace session linking is an optional feature. Implementations that do not generate session tokens will produce valid attribution chains within each trace. The session_token mechanism enables richer attribution graphs for deployments where transactions routinely complete in a different trace than the contributing tool calls.

**Note (relationship to provenance_token):** session_token expresses *same logical session across trace boundaries* (continuation of one task across multiple OTel context_ids). For *cross-session causal anchoring* (a new session that descends from a different upstream session, e.g., agent handoff, workflow continuation, webhook reaction), see [§1.2.6](#126-provenance_token) `provenance_token`. The two fields have distinct semantics and MAY coexist on the same genesis record.

---

### 1.6 Unsigned Hops and Gap Nodes

Not every MCP server in an agent's tool chain will have atrib installed. When an agent calls a tool that does not emit a signed attribution record, the chain has an unsigned hop. This is expected and MUST be handled gracefully.

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

Gap nodes are part of the attribution graph. They are visible in graph queries. They carry a `verification_state` of `unsigned` (the lowest verification state) because no signature exists to verify. Their presence does not invalidate the chain or prevent settlement recommendations from being generated. What an unsigned node means for attribution weight is a question for the policy layer ([§4](#4-attribution-policy-format)), not for this section, which defines only the record format and what constitutes a gap node.

A creator who has not signed their contribution has not asserted a claim. The gap node preserves the fact that an unsigned hop occurred, making it visible to any party who inspects the graph, rather than silently excluding it.

---

### 1.7 Transaction Event Hooks

The attribution chain is complete when a transaction event closes the loop, connecting the tool calls that contributed to the commerce session to the actual moment of purchase. This section defines how atrib attaches to each supported commerce protocol.

In every case, the linking mechanism is the same: the `context_id` of the agent session must be embedded in the transaction metadata when the checkout is initiated, so that the transaction event webhook can be matched back to the attribution chain.

#### 1.7.1 ACP (Agentic Commerce Protocol)

ACP is the open standard published at `github.com/agentic-commerce-protocol/agentic-commerce-protocol`. The transaction event hook is the success response from `POST /checkout_sessions/{id}/complete`. A successful completion is signaled by `status === "completed"` together with an embedded `order` object whose `id` is a string. The `order.permalink_url` (when present) is the canonical post-purchase URL atrib uses to derive the transaction record's `content_id`.

Because ACP `POST /checkout_sessions/...` requests do not currently expose a free-form metadata field for arbitrary extension data, the `context_id` MUST travel via the same channels used for HTTP transports (per [§1.5.2](#152-http-transport-tracestate), [§1.5.3](#153-http-fallback-x-atrib-chain), and [§1.5.3.1](#1531-context-id-header-x-atrib-context)): the `X-atrib-Context` HTTP header on the outbound request, and `params._meta.atrib` for MCP-transport ACP integrations.

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

The transaction event is the HTTP 200 response containing a **`Payment-Receipt`** header (per draft [§5.3](#53-atribmcp-mcp-server-middleware)). The header value is base64url-nopad JSON with the required fields `{ status: "success", method, timestamp, reference }`. The draft specifies: _"Servers MUST NOT return a Payment-Receipt header on error responses,"_ so header presence is a reliable detection signal.

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

The PaymentMandate is the transaction event. (`IntentMandate` and `CartMandate` represent earlier funnel stages, intent capture and cart commitment respectively, and MUST NOT be detected as transaction events.) Implementations SHOULD embed the `context_id` in the agent extension fields where supported by the host A2A implementation; until AP2 standardizes a metadata field for it, the `context_id` MUST also travel via `params._meta.atrib` per [§1.5.2](#152-http-transport-tracestate), [§1.5.3](#153-http-fallback-x-atrib-chain), and [§1.5.3.1](#1531-context-id-header-x-atrib-context).

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

#### 1.7.6 Cross-attestation requirement for transaction records

_This subsection is normative._

Transaction records (`event_type = https://atrib.dev/v1/types/transaction`) are the highest-stakes record type in this specification. [§4.6](#46-the-calculation-algorithm) calculation is normatively gated on this URI; settlement decisions follow from the records' content. To prevent a single compromised key from fabricating arbitrary transactions, transaction records MUST carry signatures from at least two independent parties.

**Required field on transaction records.** Transaction records MUST carry a `signers` field. Format:

```jsonc
"signers": [
  {
    "creator_key": "agent-key-base64url",
    "signature":   "Ed25519-sig-base64url"
  },
  {
    "creator_key": "counterparty-key-base64url",
    "signature":   "Ed25519-sig-base64url"
  }
]
```

The legacy top-level `signature` field is OPTIONAL on transaction records and SHOULD be omitted when `signers` is present. When both are present, the top-level signature is informational and MUST NOT be double-counted toward the cross-attestation minimum.

**Signature canonical bytes.** Each signature in `signers` covers the JCS-canonical serialization of the complete record with the `signers` array set to `[]` (empty) and the top-level `signature` field omitted. All signers sign over the same bytes; verifiers confirm each signature against its corresponding `creator_key`.

**Minimum required signers.** atrib's normative minimum is 2: typically the agent that initiated the transaction and the counterparty (the merchant or settlement party). Records with fewer than 2 verified signers MUST be flagged by verifiers with `cross_attestation_missing: true`.

**Counterparty key discovery.** Counterparty keys are discovered out-of-band: via the [§6](#6-key-directory) directory lookup of the merchant's published identity, via payment-protocol-specific channels (x402 facilitator metadata, ACP order envelope, AP2 PaymentMandate signer field, and so on), or via consumer-arranged key exchange. atrib does not specify the discovery mechanism; the spec only requires the keys be present in the record.

**Other event types unaffected.** This requirement applies only to `transaction`. tool_call, observation, and extension records continue to use single-signer signatures via the top-level `signature` field.

See [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) for the design rationale and the alternatives considered.

---

### 1.8 Scope Boundaries

_This section is informative._

The following topics are outside the scope of this specification. They are acknowledged here because they affect real-world deployments and inform architectural decisions.

**Cross-session attribution.** When a user receives a recommendation from an agent and subsequently completes a purchase in a browser session (minutes, hours, or days later), the transaction carries no attribution chain. The agent session and browser session are structurally disconnected. A partial mitigation is available via recommendation tokens: opaque identifiers the agent embeds in recommendation URLs, which a merchant can capture on conversion. A first-class solution requires persistent agent identity across sessions.

**Log federation.** All attribution records for a session should be submitted to the same log operator to enable complete graph queries. If contributing tools submit to different log operators, a query against one log will return an incomplete graph. A federation protocol (cross-log inclusion proof pointers) is a natural extension but is not defined here.

**Key rotation.** Key rotation and revocation are normatively specified in [§1.9](#19-key-rotation-and-revocation). Creators rotate keys by submitting a `key_revocation` record with `revocation_reason: 'rotation'` and a `successor_key`; verifiers update accordingly. The directory ([§6](#6-key-directory)) tracks the active key per identity claim.

**Policy versioning.** Policies are identified by URL with no formal versioning. The session policy record ([§4.5.3](#453-session-policy-record)) captures agreed terms at session time, which partially mitigates this. Policy evaluation uses the current active policy.

**Dispute mechanism.** There is no protocol-defined dispute process. Creators contest recommendations by contacting merchants directly, using the session policy record as evidence.

**Settlement webhook format.** Settlement recommendations are produced on demand only. This specification does not define a push-based delivery mechanism.

**Multi-transaction sessions.** The calculation algorithm ([§4.6](#46-the-calculation-algorithm)) assumes one transaction node per session. Multiple transactions in a single session require separate calculation runs.

**Agent-published policies.** Agents consume policies but do not publish their own, though the policy format can express learned weights. This specification does not define agent-side policy discovery or publication.

#### Related Standards Work

_This section is informative._

atrib is designed to complement existing standards work in identity, provenance, and agent trust. The following integration points inform architectural decisions in this specification.

**DIF Trusted AI Agents Working Group.** DIF's Trusted AI Agents WG is defining identity, delegation, and accountability frameworks for autonomous agents. The persistent agent identity their work provides is a prerequisite for cross-session attribution. atrib's Ed25519 creator keys are a deliberate simplification of what will eventually be expressible as agent-scoped Verifiable Credentials with delegation chains.

**DIF Creator Assertions Working Group.** DIF's Creator Assertions WG is defining content authenticity and provenance assertions. atrib attribution records are structurally compatible with DIF assertion formats; both use Ed25519 signing over canonical JSON. An interoperability profile could define how an atrib record can be wrapped as a DIF Creator Assertion.

**C2PA (Coalition for Content Provenance and Authenticity).** C2PA defines cryptographic provenance manifests for media content. atrib extends this pattern to agent interactions, where the "content" is a tool call, not a photograph. atrib records could be embedded in C2PA manifests as consequence assertions.

**W3C AI Agent Protocol Community Group.** The emerging work on standardizing agent-to-agent communication protocols is a natural home for atrib context propagation. The propagation mechanism (`params._meta.atrib` in MCP, `tracestate` in HTTP) is designed to be portable to any agent protocol that supports metadata propagation.

---

### 1.9 Key Rotation and Revocation

_This section is normative. Per [D033](DECISIONS.md#d033-key-rotation-and-revocation)._

Ed25519 creator keys can be retired in three ways: routine `rotation` (new key replaces old), `retirement` (creator winds down, no successor), and `compromise` (key leaked or stolen). All three use the same record format. Past records signed by the retired key remain valid up to the moment of revocation; subsequent records do not.

#### 1.9.1 Revocation Record Format

A revocation is an attribution record with `event_type: 'key_revocation'` and the following extra fields, in addition to the standard fields from [§1.2](#12-the-attribution-record):

| Field | Type | Required | Description |
|---|---|---|---|
| `revoked_key` | string | Yes | Base64url-encoded 32-byte Ed25519 public key being retired. |
| `revocation_reason` | enum | Yes | One of `'rotation'`, `'retirement'`, `'compromise'`. |
| `successor_key` | string | When `revocation_reason='rotation'` | Base64url-encoded 32-byte Ed25519 public key of the rotation target. |
| `emergency_signed_by` | string | When `revocation_reason='compromise'` AND signature is by an emergency key | Base64url-encoded 32-byte public key of the emergency key (registered in the directory at the time of compromise). |

Canonical serialization (JCS, [§1.3](#13-canonical-serialization)) places `emergency_signed_by` after `creator_key` and before `revoked_key` in lexicographic order. `revoked_key`, `revocation_reason`, and `successor_key` follow alphabetically.

#### 1.9.2 Signing Rules

A `key_revocation` record MUST be signed by one of:

1. **The key being retired.** The `creator_key` field equals `revoked_key`. This is the standard path for `rotation` and `retirement`. The signing proves the legitimate owner authorized the retirement.

2. **A pre-registered emergency key.** Permitted ONLY when `revocation_reason='compromise'`. The `creator_key` field is the emergency key's public key; `emergency_signed_by` MUST equal `creator_key`. The emergency key MUST have been registered in the directory ([§6](#6-key-directory)) under the same identity claim as `revoked_key` BEFORE the revocation timestamp. This is the only path that survives the case where the legitimate owner has lost access to `revoked_key`.

A revocation signed by any other key is invalid and MUST be rejected by verifiers as `'unsigned'`.

#### 1.9.3 Verifier Semantics

When a verifier sees a valid `key_revocation` record at log index `R` retiring `revoked_key`:

- Records with `creator_key === revoked_key` AND `log_index >= R` are flagged `verification_state: 'revoked_after_revocation'`. They MUST NOT contribute to attribution calculations ([§4.6](#46-the-calculation-algorithm)).
- Records with `creator_key === revoked_key` AND `log_index < R` retain their original `verification_state`. Past attribution remains valid.
- When `successor_key` is present, the directory's active key for the identity claim MUST be updated to `successor_key`. Records signed by the successor inherit the identity claim that was active at the moment of rotation.

The verifier MUST scan for `key_revocation` records when evaluating any record signed by a key that has been retired. The directory ([§6](#6-key-directory)) MAY index revocations for fast lookup but the log itself is the source of truth.

#### 1.9.4 Conformance

Implementations MUST pass all vectors in `spec/conformance/1.9/`:

- `valid-rotation`: revocation signed by retired key, with successor.
- `valid-retirement`: revocation signed by retired key, no successor.
- `valid-compromise-emergency`: revocation signed by emergency key registered before the revocation timestamp.
- `invalid-wrong-signer`: revocation signed by an unrelated key (rejected).
- `invalid-emergency-not-registered`: emergency key not in directory before revocation (rejected).
- `invalid-emergency-for-non-compromise`: emergency-key signing attempted with `revocation_reason='rotation'` (rejected).
- `post-revocation-record`: a record signed by the retired key after the revocation log index (flagged `'revoked_after_revocation'`).
- `pre-revocation-record`: a record signed by the retired key before the revocation log index (still `'signature_valid'`).

#### 1.9.5 What This DOES NOT Cover

Forward secrecy of past records: an attacker who compromised `revoked_key` on day 100 can produce records that look legitimate under that key for the entire pre-revocation window. The verifier sees `'revoked_after_revocation'` only post-revocation. A "compromise window" annotation that retroactively flags pre-revocation records is V2 work.

Operator/log-key rotation: see [§2](#2-merkle-log-protocol) for the log signing key. Rotating the log key invalidates all prior inclusion proofs' signatures and is a separate ADR (deferred to V2).

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

_This section is informative._

The atrib log is a public, append-only Merkle tree. When a creator submits an attribution record to the log, they receive an inclusion proof: a cryptographic commitment that the record exists at a specific position in the tree, verifiable by any third party without trusting the log operator.

The log enforces two properties that are the foundation of atrib's trust model:

**Tamper evidence.** Any modification, deletion, or reordering of a committed record would invalidate the root hash. The tree is append-only: new records may be added, but no existing record may be altered or removed. The log operator cannot secretly change history.

**Accountability without content exposure.** The log stores hashes and commitments, not content. A third party can verify that a record was committed at a specific time without reading what the record contains. Privacy and auditability are structurally separated: the log proves existence and integrity; the content remains with the creator.

The log is built on the tlog-tiles specification (c2sp.org/tlog-tiles), which defines an efficient HTTP-based read interface used by Certificate Transparency logs and the Tessera library (github.com/transparency-dev/tessera). `log.atrib.dev` is a Tessera-based personality. Any operator may run a compatible log using Tessera; the open specification ensures that client implementations are not tied to atrib's log infrastructure.

---

### 2.2 Log Identity and Parameters

A tiled transparency log is identified by three parameters:

| Parameter      | Value for log.atrib.dev                  | Description                                                                                                                 |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| URL prefix     | https://log.atrib.dev/v1                 | The base URL from which all log endpoints are served.                                                                       |
| Origin         | log.atrib.dev/v1                         | The scheme-less URL prefix. Used as the first line of every checkpoint. Uniquely identifies this log instance globally.     |
| Log public key | Published at log.atrib.dev/v1/log-pubkey | The Ed25519 public key used to sign checkpoints. Distributed as a verifier key (vkey) string per the C2SP signed-note spec. |

Log operators running compatible logs MUST use a unique origin matching their URL prefix, and MUST publish their log public key at a stable, documented URL.

**Note (Log versioning):** The `/v1` path component in the URL prefix and origin is the log version, not the atrib spec version. When the log's entry format requires a breaking change, a new origin (`log.atrib.dev/v2`) will be used rather than modifying the existing log. Existing entries in `log.atrib.dev/v1` will remain accessible indefinitely.

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
  u8  event_type;      // see byte mapping below
}
// Total: 1 + 32 + 32 + 16 + 8 + 1 = 90 bytes
```

All multi-byte integers are big-endian. The `record_hash` is computed over the _complete_ attribution record including its `signature` field, after JCS serialization. This binds the commitment to the specific signed record, not just its pre-signature content.

**event_type byte mapping.** The 1-byte slot is a fast-path filter; the authoritative type is the URI in the record content ([§1.2.4](#124-event_type-values)). Verifiers MAY filter by byte for atrib normative URIs and MUST fetch the record to read the URI for extension types.

| Byte         | URI                                          | Notes                                                  |
| ------------ | -------------------------------------------- | ------------------------------------------------------ |
| `0x01`       | `https://atrib.dev/v1/types/tool_call`       | atrib normative                                        |
| `0x02`       | `https://atrib.dev/v1/types/transaction`     | atrib normative                                        |
| `0x03`       | `https://atrib.dev/v1/types/observation`     | atrib normative                                        |
| `0x04`–`0xFE`| reserved                                     | reserved for future atrib normative additions per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) |
| `0xFF`       | extension URI                                | URI is in a non-`atrib.dev` namespace; read content    |
| `0x00`       | reserved                                     | MUST NOT be emitted                                    |

The byte mapping is normative for log operators encoding entries and for verifiers building byte-level filters. The mapping is informative for emitters (which write URIs into records, not bytes); the log operator is responsible for the URI-to-byte mapping at submission time. A log operator receiving a record with a URI not in the atrib normative set MUST encode the entry with `event_type = 0xFF` and preserve the URI verbatim in the stored record content.

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
log.atrib.dev/v1                                    ← origin line (matches §2.2)
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

// For log.atrib.dev/v1:
key_name = "log.atrib.dev/v1"
```

The log MUST publish its public key at two endpoints, both serving the same key:

1. **`GET /v1/log-pubkey`** returns the verifier key string in the C2SP signed-note vkey format as `text/plain`. This is the canonical key-publication format expected by C2SP-conformant tooling (e.g. `golang.org/x/mod/sumdb/note.NewVerifier`):

   ```
   // vkey format: <origin>+hex(key_id)+base64(sig_type_byte || public_key)
   log.atrib.dev/v1+a3b2c1d0+AQ...base64encodedpublickey...==
   // "AQ" is base64(0x01), the Ed25519 signature type byte
   ```

2. **`GET /v1/pubkey`** returns the same key as `application/json` for hand-rolled verifiers and dogfood scripts that prefer structured access:

   ```json
   {
     "origin":     "log.atrib.dev/v1",
     "public_key": "<base64url 32B>",
     "key_id":     "<hex 4B>",
     "algorithm":  "Ed25519"
   }
   ```

Both endpoints MUST be served from the same signing key, MUST agree on `origin` and `key_id`, and MUST decode to the same 32-byte Ed25519 public key. A verifier MAY use either endpoint. The `key_id` published at either endpoint MUST equal the 4 leading bytes of the base64-decoded signature token on every signature line of `/v1/checkpoint` (§2.4.3).

#### 2.4.3 Signed Note Format

The complete checkpoint (body plus signatures) is a signed note per the C2SP signed-note specification (c2sp.org/signed-note). The note has the checkpoint body as its text, followed by one or more signature lines:

```
log.atrib.dev/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.dev/v1 base64(keyHash[4B] || Ed25519-signature[64B])
— witness.example.com base64(witness-keyHash[4B] || cosignature[64B])
```

Each signature line begins with `— ` (U+2014 em-dash followed by a space in the canonical format), followed by the key name, a single space, and one base64-encoded token. The token decodes to exactly 68 bytes: the 4-byte key hash defined in §2.4.2 (matches the `key_id`) concatenated with the 64-byte Ed25519 signature over the note text (the body including its trailing newline). This is the canonical C2SP signed-note encoding; verifiers using `golang.org/x/mod/sumdb/note.NewVerifier` or compatible tooling parse it directly without an adapter.

Clients MUST verify at least the log's own signature on any checkpoint before trusting it. Cosignatures from witnesses are additional trust anchors; their verification procedure is described in §2.9.

---

### 2.5 Tile API (Read Interface)

The log's read interface serves static resources over HTTP, following the C2SP tlog-tiles specification. All read endpoints are cacheable. Clients can compute any desired proof by fetching the relevant tiles in parallel without a dynamic proof API.

#### 2.5.1 Checkpoint Endpoint

```
GET https://log.atrib.dev/v1/checkpoint

Response:
Content-Type: text/plain; charset=utf-8
Cache-Control: max-age=5  // mutable; checkpoint advances as entries are added

// Body: signed note as defined in [§2.4.3](#243-signed-note-format)
```

Clients SHOULD not cache the checkpoint beyond 5 seconds. Monitoring clients that tail the log MUST verify consistency between successive checkpoints using the tile data to confirm the log is append-only.

#### 2.5.2 Tile Endpoints

Merkle tree hashes are served as tiles: concatenated sequences of 32-byte SHA-256 hashes. Full tiles contain exactly 256 hashes (8,192 bytes). Partial tiles contain 1–255 hashes and are served at the rightmost edge of each tree level.

```
// Full tile:
GET https://log.atrib.dev/v1/tile/<L>/<N>

// Partial tile:
GET https://log.atrib.dev/v1/tile/<L>/<N>.p/<W>

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
GET https://log.atrib.dev/v1/tile/entries/<N>
GET https://log.atrib.dev/v1/tile/entries/<N>.p/<W>

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
  u8  entry_bytes[length];  // AtribLogEntry ([§2.3.1](#231-entry-serialization)), always 90 bytes
}
```

**Note (Entry bundle size):** Every AtribLogEntry is exactly 90 bytes, so every uint16 length prefix in an entry bundle will be `0x00 0x5A` (90 in big-endian). Clients MAY rely on this fixed size as a consistency check. If the entry format changes in a future specification revision, a new log origin will be used.

Tile API error responses:
- 404 Not Found: the requested tile, entry bundle, or checkpoint does not exist (e.g., tile coordinates beyond the current tree)
- 400 Bad Request: malformed path (non-numeric level or index)

---

### 2.6 Submission API (Write Interface)

The write interface accepts attribution records and returns inclusion proofs. This API is distinct from the read interface: it requires a valid, verifiable attribution record and returns a proof that the commitment was added to the log.

#### 2.6.1 Submit Entry

```
POST https://log.atrib.dev/v1/entries
Content-Type: application/json
X-atrib-Priority: normal              // optional, see below

// Request body: a complete, signed attribution record ([§1.2](#12-the-attribution-record)), bare,
// not wrapped in any envelope object.
{
  "spec_version": "atrib/1.0",
  "content_id":   "sha256:3f8a2b...",
  "creator_key":  "ABC...",
  "chain_root":   "sha256:7e1f4a...",
  "event_type":   "https://atrib.dev/v1/types/tool_call",
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

Step 3: Verify that `event_type` is a syntactically-valid absolute URI per §1.4.5; the URI need not be in atrib's normative set. Reject with `400` if not.

Step 4: Verify that `timestamp` is not more than 10 minutes in the future (a more permissive window than client-side verification to account for clock skew). Reject with `400` if so.

Step 5: Verify that `context_id` is exactly 32 lowercase hex characters. Reject with `400` if not.

Step 6: Check for a duplicate: if an entry with the same `record_hash` already exists in the log, return the existing inclusion proof with `200 OK` rather than `409 Conflict`. Idempotent submission is required to handle retries safely.

Error responses from the submission API use `Content-Type: application/json` with a JSON object containing an `error` field (string). Example: `{"error": "spec_version must be 'atrib/1.0'"}`. The format is not RFC 9457 Problem Details (that format is reserved for the graph query API, §3.5.4).

#### 2.6.2 Inclusion Proof Response

On successful submission or duplicate detection, the log returns a proof bundle:

```
// Response: 200 OK
Content-Type: application/json

{
  "log_index":       4821936,           // zero-based index in the log
  "checkpoint":      "log.atrib.dev/v1\n4821937\nCsUY...=\n\n— log.atrib.dev/v1 ...",
  "inclusion_proof": [
    "gSKyXoYZUgZ6jduW...",   // base64-encoded SHA-256 sibling hashes
    "B95lDa8R83lS8n0e...",   // from leaf level up to root
    "EKNzoDWG8LGC0Yp9..."
  ],
  "leaf_hash":       "AHCioX9nLjsrse6Y..."   // SHA-256(0x00 || entry_bytes)
}

// All hashes are standard base64 (RFC 4648 §4, with padding).
```

The log MUST NOT return 200 until the entry is included in a signed checkpoint. The response is synchronous: the proof bundle in the response body reflects the entry's committed position. There is no asynchronous or polling model.

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
entry_bytes = serialize(AtribLogEntry)          // [§2.3.1](#231-entry-serialization)
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

log.atrib.dev/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.dev/v1 a3b2c1d0+base64signature
— witness.example.com e1f2a3b4+cosignature

// Format: tlog-proof header, empty line, inclusion proof hashes (one per line),
// empty line, full checkpoint (body + signature lines).
// All hashes: standard base64 with padding.
// Proof bundles SHOULD be stored alongside the attribution record.
```

A proof bundle is sufficient to verify log commitment offline given only the log's origin (`log.atrib.dev/v1`) and its trusted public key. No network request is required for verification after the bundle is obtained.

Implementations SHOULD store proof bundles alongside attribution records. The `@atrib/mcp` SDK SHOULD return the proof bundle as part of the record submission response and cache it locally for at least the duration of the active session.

---

### 2.9 Witnessing and Cosignatures

#### 2.9.1 Threat Model and Purpose

A checkpoint signed only by the log operator (§2.4) commits the operator to one (size, root) pair, but proves nothing about the operator's behavior over time. Four threats remain:

1. **Split-view.** A dishonest operator presents one checkpoint to verifier A and a different one to verifier B at the same tree size, then later reconciles which version is "real."
2. **Operator compromise.** An attacker who steals the operator's signing key can produce valid-looking checkpoints that fork the log; verifiers using only the operator's signature have no way to detect the fork.
3. **Infrastructure compromise.** An attacker controlling the operator's hosting provider, DNS, TLS termination, or network path can serve forged checkpoints to specific verifiers without ever touching the operator's signing key. Witnessing addresses this *only when the witnesses run on infrastructure independent from the operator's*; witnesses colocated with the log inherit the same compromise. Witness diversity across hosting providers, network paths, and TLS authorities is what makes this threat expensive to exploit.
4. **Compelled removal.** Legal pressure on a single operator can force removal or rewriting of historical records, with no record of the prior state outside the operator's control. Witnesses in different jurisdictions retain proof of the prior state even if the operator is compelled to drop it.

A **witness** is an independent party that periodically reads the log's checkpoints, verifies that each new checkpoint consistency-extends the previous one (RFC 6962 §2.1.4), and publishes a cosignature attesting to that fact. A verifier requiring N witness cosignatures forces an attacker to compromise the operator AND N witnesses simultaneously to produce a coherent forged history. The strength of the guarantee scales with witness diversity along three axes: distinct *signers* (defends against threats 1 and 2), distinct *infrastructure* (defends against threat 3), and distinct *jurisdictions* (defends against threat 4). A verifier configuring witnesses that share any of these dimensions with each other or with the operator gets weaker guarantees than the cosignature count alone suggests.

#### 2.9.2 Cosignature Format (normative)

A cosignature reuses the C2SP signed-note line shape (§2.4.3) but encodes a 76-byte payload instead of 68. Per c2sp.org/tlog-cosignature:

```
— <witness_name> <base64(keyHash[4B] || timestamp[8B] || sig[64B])>
```

Where:
- `keyHash[4B]` is the witness's 4-byte key hash, computed identically to §2.4.2 using the witness's name and public key.
- `timestamp[8B]` is a big-endian uint64 of POSIX seconds at which the witness performed verification.
- `sig[64B]` is the Ed25519 signature over the *cosignature signing input* (below).

The cosignature signing input is the checkpoint body with a timestamp preamble:

```
cosignature/v1
<decimal seconds, no leading zeros>

<exact bytes of the [§2.4.1](#241-body-structure) checkpoint body, including its trailing newline>
```

Note the second line is the same `<seconds>` value encoded into the timestamp field, in decimal text form. The blank line is mandatory. A verifier reconstructs this input bytewise from the timestamp it extracted from the cosignature line and the checkpoint body it is verifying.

A signature line whose base64 token decodes to 68 bytes is an operator signature (§2.4.3); 76 bytes is a witness cosignature. Verifiers MUST distinguish on decoded length.

#### 2.9.3 Witness Behavior (normative)

A witness MUST:

1. Periodically fetch the log's `/v1/checkpoint` (§2.5.1) and verify the operator's signature per §2.4.3.
2. For each new checkpoint whose tree size exceeds the most recent checkpoint the witness has cosigned, fetch enough tile data (§2.5.2) to verify a consistency proof from the witness's prior view to the new checkpoint. If the consistency proof fails, the witness MUST NOT cosign and SHOULD log the inconsistency for operator and downstream consumers.
3. Sign the cosignature input (§2.9.2) with its Ed25519 signing key, producing a 76-byte payload.
4. Publish the resulting cosignature line at the URL defined in §2.9.4.
5. Publish its public key in both C2SP vkey form and JSON form, mirroring the log's `/v1/log-pubkey` and `/v1/pubkey` endpoints (§2.4.2). Verifiers configure trusted witness vkeys the same way they configure the trusted log vkey.

Witness signing keys SHOULD be independent of the log's signing key. Compromise of one MUST NOT compromise the other.

#### 2.9.4 Cosignature Delivery (normative)

Cosignatures are **witness-published**. Each witness exposes its own HTTP endpoint:

```
GET https://<witness_origin>/v1/cosig/<log_origin_pct_encoded>/<root_hash_b64url>

Response:
Content-Type: text/plain; charset=utf-8
Cache-Control: public, max-age=31536000, immutable

// Body: a single C2SP signed-note signature line as defined in [§2.9.2](#292-cosignature-format-normative),
// terminated by \n. 404 if this witness has not cosigned the named checkpoint.
```

The log operator does NOT aggregate or republish cosignatures. A verifier wanting to apply a witness threshold fetches from each trusted witness's endpoint directly and concatenates the returned lines into the checkpoint's signature block.

This delivery model is chosen specifically to defeat threat 2 (operator compromise). If cosignatures lived only on `log.atrib.dev`, an attacker controlling the log could suppress cosigs from a forged checkpoint and present it as uncosigned-but-genuine. Witness-published delivery removes the operator from the cosignature path entirely.

#### 2.9.5 Verifier Behavior and Thresholds (informational)

The atrib protocol does NOT mandate a minimum cosignature threshold. Per CLAUDE.md invariant 7 ("the protocol has no thumb on the scale"), verifier policy is verifier-local. A verifier with no witness keys configured trusts the operator's signature alone, which is the V1 default and remains valid behavior for low-stakes verification.

Verifiers wishing to apply witness checks SHOULD:

1. Maintain a list of trusted witness vkeys.
2. For each checkpoint they want to verify, fetch cosignatures from each trusted witness's `/v1/cosig/...` endpoint.
3. Verify each fetched cosignature line per §2.9.2 with the corresponding witness public key.
4. Apply a verifier-chosen threshold. Examples: "at least 2 cosigs," "at least 1 cosig from a witness in a different jurisdiction than the operator," "all configured witnesses MUST have cosigned recently."

A verifier SHOULD reject a checkpoint whose cosignature timestamp is implausibly old or in the future relative to the verifier's clock. Suggested staleness bound: 24 hours, configurable.

#### 2.9.6 Witness Discovery (out of scope for V1)

V1 of atrib does not specify a witness registry, witness coordination protocol, or witness reputation system. Verifiers configure trusted witness keys out-of-band, the same way they configure trusted log keys. A future revision MAY specify an open registry analogous to Sigsum's witness ecosystem, but doing so prematurely would lock in a discovery mechanism before atrib has any non-operator verifiers to consult on what shape they actually need.

#### 2.9.7 Example: Cosigned Checkpoint

A verifier that has fetched cosignatures from two witnesses concatenates the lines into the operator's signed checkpoint to produce:

```
log.atrib.dev/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.dev/v1 base64(operator_keyHash[4B] || operator_sig[64B])
— witness1.example.com base64(witness1_keyHash[4B] || timestamp1[8B] || witness1_sig[64B])
— witness2.example.org base64(witness2_keyHash[4B] || timestamp2[8B] || witness2_sig[64B])
```

The operator's line decodes to 68 bytes; each cosignature line decodes to 76 bytes. The verifier independently verifies each line per the appropriate format (§2.4.3 for the operator, §2.9.2 for cosigs), then applies its threshold to the count and identity of valid cosignatures.

---

### 2.10 What the Log Stores and What It Does Not

_This section is informative._

This section states the privacy properties of the log precisely, because they are the foundation of atrib's claim to be "observability without surveillance."

**The log stores:** the record hash, the creator's public key, the context_id (as raw bytes), the timestamp, and the event type. These are committed in the AtribLogEntry (§2.3.1) and are visible to any party that fetches entry bundles.

**The log does not store:** the content of tool calls, the content of agent responses, the user's identity, the merchant's product data, the amounts of transactions, or any payload that is not listed in the AtribLogEntry structure above.

**What this means in practice:** A party who fetches all entries from the log learns which creator keys were active, in which sessions (context_ids), at what times, and what type of events they recorded. They do not learn what those tools did, what was returned, who the user was, or what was purchased. The attribution graph connects records to transactions only when the merchant writes their own transaction record, and only the merchant knows the transaction details.

The `context_id` is visible in the log and is the same value used in OTel traces. Implementers who wish to prevent correlation between log entries and OTel traces MAY generate a separate log context_id derived from but not equal to the OTel trace-id, at the cost of making independent audit harder. The default is to use the OTel trace-id directly.

**Note (Creator key pseudonymity):** Creator public keys are stable identifiers visible in the log. A party who observes a creator's public key across multiple entries can infer that the same creator was active across those sessions. Creators who require stronger unlinkability across sessions may generate per-session keypairs, but doing so forfeits the ability to accumulate attribution weight under a single identity. This tradeoff is a design choice for each creator, not a protocol decision.

---

### 2.11 Cross-log Replication

_This section is normative; the replication itself is OPTIONAL._

§2.9 (witnessing) defends against single-log-operator equivocation at the checkpoint level by requiring multiple operator-independent witnesses to cosign each checkpoint. Witnessing secures the root, not the records the root commits to. A log operator can still selectively censor records (refuse to commit them while returning success), equivocate at the record level when colluding with witnesses, or lose data after commitment.

The strongest defense against operator-level threats is independent replication: the same record committed to multiple operator-independent logs, with verifiers consulting more than one. This is how Certificate Transparency works in practice. atrib has the same threat model and benefits from the same defense.

#### 2.11.1 Replication is optional

Records MAY be replicated to multiple atrib-conformant logs. There is no protocol-level mandate. Single-log deployments remain valid and produce conforming records. Cross-log replication is a robustness enhancement consumers adopt as their threat model requires.

#### 2.11.2 Submission produces independent inclusion proofs

Logs do not coordinate. Each log treats a replicated submission as a fresh entry and returns its own checkpoint and inclusion proof. The submitter collects the proofs from all logs they replicated to.

#### 2.11.3 Proof bundle format extension

The proof bundle (§2.8) MAY carry a list of `(log_id, checkpoint, inclusion_proof)` tuples instead of a single tuple. Format:

```jsonc
{
  "record_hash": "sha256:...",
  "log_proofs": [
    {
      "log_id":          "log.atrib.dev",     // [§2.4](#24-checkpoint-format) origin string
      "checkpoint":      "...",                // C2SP-canonical signed note
      "inclusion_proof": ["sha256:...", "..."] // RFC 6962 inclusion proof
    },
    {
      "log_id":          "log.example.com",
      "checkpoint":      "...",
      "inclusion_proof": ["sha256:...", "..."]
    }
  ]
}
```

A bundle with a single `log_proofs` entry is equivalent to the legacy single-log bundle format; the array form is the canonical form when multiple logs are involved.

#### 2.11.4 Verifier-side threshold and equivocation detection

A verifier configured with a list of trusted log operators (the "trusted set") and a threshold M (the minimum number of trusted-set proofs required) MUST:

1. Validate each `(log_id, checkpoint, inclusion_proof)` tuple in the bundle independently against [§2.7](#27-inclusion-proof-verification). For each tuple: confirm the `log_id` matches the issuing log's published origin, verify the checkpoint signature, and verify the inclusion proof against the checkpoint root for the bundle's `record_hash`.
2. Count the number of tuples whose `log_id` appears in the trusted set AND whose proof verifies. Call this V.
3. If V < M, reject the record with `cross_log_threshold_not_met: true`.
4. **Equivocation detection.** For each pair of distinct logs (A, B) in the trusted set that returned proofs in this bundle: compare the leaf bytes the inclusion proof was computed against. The leaf bytes are deterministic from the record_hash per [§2.3](#23-log-entry-format) (90-byte AtribLogEntry containing record_hash, creator_key, context_id, timestamp_ms, event_type byte). If logs A and B return different leaf bytes for the same `record_hash`, the verifier MUST reject the record with `cross_log_equivocation_detected: true` and surface `(log_id_A, leaf_bytes_A, log_id_B, leaf_bytes_B)` for each disagreeing pair. Equivocation can ALSO be detected when one log returns a valid proof and another returns a "record not found" response within the bundle's epoch window: this is censorship-shaped equivocation and MUST be flagged as `cross_log_censorship_suspected: true` with the silent log identified.

The default M=1 preserves single-log behavior. Consumers wanting cross-log confidence configure M ≥ 2 and a trusted set of independently-operated logs.

#### 2.11.5 Log identity

Each log publishes a stable `log_id` derived from its origin string per §2.4. Verifiers cross-reference the identifier against their trust configuration. Adding a log to the trusted set is an out-of-band consumer policy decision; atrib does not maintain a central registry of trusted logs.

#### 2.11.6 What replication does and does not defend against

**Defends against:** single-log-operator censorship, single-log-operator equivocation (when at least one cooperative log retains the record), single-log data loss, single-log compromise.

**Does NOT defend against:** collusion across all logs in the trusted set (consumer is responsible for picking logs operated by independent parties with different incentives); submission-time censorship by some logs (threshold M handles this gracefully); record-level retroactive removal across all logs (no defense if all logs comply).

See D050 for the design rationale and the alternatives considered.

---

## §3 Graph Query Interface

_Seven edge types. Deterministic derivation. Fact layer only._

The data model and query API for turning attribution records into a structured provenance graph, the input to policy evaluation and settlement calculation.

### What atrib chains, what it does not

atrib's graph certifies five structural axes of agent activity:

1. **Identity-of-record** (signature): the holder of a `creator_key` signed this record.
2. **Per-session ordering** (chain_root pointing at the parent record's hash): this record came after that one in the same session, and no records were inserted or removed between them.
3. **Cross-session sameness** (session_token via CROSS_SESSION): these records belong to the same logical session across OTel trace boundaries.
4. **Cross-session causal anchoring** (provenance_token via PROVENANCE_OF): this record's action descends from that upstream anchor (D044).
5. **Agent-claimed reasoning composition** (informed_by via INFORMED_BY): the agent claims these specific prior records informed this action (D041).

atrib does NOT certify:

- That a referenced record's *content* actually influenced the agent's decision. The chain proves precedence; the agent could have ignored the referenced record entirely.
- That the agent's reasoning is truthful. A signed `informed_by` claim proves the agent committed to the claim; it does not prove the agent reasoned this way.
- That a tool's response was real, absent tool-side attestation. `result_hash` is the agent's claim about what the tool returned; tool-side response signing closes this gap when needed (§7.6).

These limits are load-bearing. The substrate's value comes from being honest about what it certifies and what it does not. Reasoning chains and outcome verification are layered on top using the existing primitives (extension URIs + `informed_by` per D047, tool-side attestation + observation witnessing per §7.6).

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

_This section is informative._

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

**Adversarial trust posture.** The fact/policy separation is one part of the substrate's trust posture. A complementary part covers what the protocol does and does not certify under adversarial conditions: signatures prove who said what, never whether what was said is true. §8.7 enumerates the adversarial threat model, the layered trust assessment stack atrib provides (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, cross-log replication, structural anomaly detection), and the asymmetric properties the substrate produces despite the fundamental limit. The graph's deterministic derivation is one input to that assessment, not a substitute for it.

---

### 3.2 Graph Data Model

The atrib attribution graph is a directed property multigraph. Nodes represent events. Edges represent relationships derived from observable record structure. The graph for a primary session is bounded by its `context_id`, extended by cross-session links when records share the same `session_token` field (§1.2.1).

#### 3.2.1 Node Types

| Type            | Source                                                | Description                                                                                                                                                                       |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool_call       | event_type = `https://atrib.dev/v1/types/tool_call`   | A creator's contribution to the session. Carries creator identity, tool identity, chain position, and timestamp. The primary subject of attribution.                              |
| transaction     | event_type = `https://atrib.dev/v1/types/transaction` | The commerce event that closes the attribution loop. The creator_key is the merchant's key. A session without a transaction node is attributable but not yet economically closed. |
| observation     | event_type = `https://atrib.dev/v1/types/observation` | A passive perception captured by the agent. Witness, not action. Participates in chain ordering but not in §4.6 attribution calculation. See D042. |
| gap_node        | OTel span without a signed record                     | An unsigned hop. Present in the graph so that invisible contributions are visible. Carries no creator_key, chain_root, or signature. See §3.2.5.                                  |
| extension       | event_type = any URI outside atrib's normative set    | A consumer-namespace record. event_type URI preserved verbatim. Participates in chain ordering (D043) but not in CONVERGES_ON or §4.6 calculation.                                |

**Per-event-type graph participation matrix:**

| Node type    | CHAIN_PRECEDES | SESSION_PRECEDES | SESSION_PARALLEL | CONVERGES_ON | CROSS_SESSION | INFORMED_BY (D041) | PROVENANCE_OF (D044) | §4.6 attribution |
| ------------ | -------------- | ---------------- | ---------------- | ------------ | ------------- | ------------------ | -------------------- | ---------------- |
| tool_call    | ✅              | ✅                | ✅                | ✅            | ✅             | ✅ source/target    | ✅ source/target      | ✅ contributing   |
| transaction  | ✅              | ✅                | ✅                | ✅ (target)   | ✅ (target)    | ✅ source/target    | ✅ source/target      | ✅ receiver       |
| observation  | ✅              | ✅                | ✅                | ❌            | ❌             | ✅ source/target    | ✅ source/target      | ❌ skipped        |
| extension    | ✅              | ✅                | ✅                | ❌            | ❌             | ✅ source/target    | ✅ source/target      | ❌ skipped        |
| gap_node     | ❌              | ✅                | ✅                | ✅            | ❌             | ❌                  | ❌                    | ✅ contributing   |

Observations and extension records DO participate in temporal chain edges (CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL) so the graph spine is complete. They DO NOT participate in CONVERGES_ON (which is the structural prerequisite for §4.6 attribution; observations are witnesses, not contributors; extension URIs are consumer-namespace and atrib does not bless their attribution claims by default). Promotion of an extension URI to atrib's normative contributing set requires D036's bar.

#### 3.2.2 Interaction Patterns and Their Structural Signatures

Agent interactions produce five distinct structural patterns, each producing a distinct edge signature. Naming these patterns makes the edge taxonomy unambiguous.

**Sequential.** Agent calls tool A, then calls tool B whose creator sets `chain_root` to the hash of A's record. B is structurally downstream of A. Signature: CHAIN_PRECEDES A → B.

**Parallel.** Agent calls tool A and tool B in the same session with no chain dependency between them: either both are genesis records, or both descend from a common ancestor but not from each other. Signature: SESSION_PARALLEL A ↔ B (or SESSION_PRECEDES A → B if timestamps establish ordering).

**Temporal.** Tool A completed before tool B in the same session, but no chain linkage connects them. Ordering is observable but not structural. Signature: SESSION_PRECEDES A → B.

**Delegated.** Agent A dispatches sub-agent B via A2A. B's tools execute under the same `context_id` as A's session, because context_id propagates through A2A boundaries (§1.5.1). A's records and B's records are distinguishable by `creator_key`; different agent operators produce different keys. The delegation boundary is identified in the graph by creator_key diversity within a single session. No separate edge type is needed: standard within-session edges apply, and the policy layer reads creator_key to identify which contributions came from the primary agent versus delegated sub-agents.

**Convergent.** Multiple tool calls, potentially from different sessions, all contribute to the same transaction. Within a session: CONVERGES_ON edges from all non-transaction nodes to the transaction node. Across sessions: CROSS_SESSION edges when explicit linking tokens connect the records.

// Sequential: B.chain_root = hash(A) \[ A: tool_call \] ──CHAIN_PRECEDES──▶ \[ B: tool_call \] // Temporal: same session, no chain link, A.timestamp \< B.timestamp \[ A: tool_call \] ──SESSION_PRECEDES──▶ \[ B: tool_call \] // Parallel: same session, no chain link, no temporal ordering \[ A: tool_call \] ──SESSION_PARALLEL── \[ B: tool_call \] // Convergent within session: all nodes point to the transaction \[ A: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] \[ B: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] // Cross-session: A (ctx=X) contributed to T (ctx=Y) via session_token \[ A: tool_call (ctx=X) \] ──CROSS_SESSION──▶ \[ T: transaction (ctx=Y) \] // Delegated: same session, different creator_keys (A=primary agent, B=sub-agent) \[ A: tool_call (key=K1) \] ──SESSION_PRECEDES──▶ \[ B: tool_call (key=K2) \] // policy layer reads creator_key to identify the delegation boundary

#### 3.2.3 Edge Types

Seven edge types are defined. All are derived deterministically from observable record structure. None encode inferred causal claims; INFORMED_BY and PROVENANCE_OF encode explicit *agent-claimed* causation, which is structurally derived from declared fields rather than inferred from content.

| Edge type        | Dir   | Derivation basis                                                                                                                                 | Meaning                                                                                                                                                                                                                                                    |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAIN_PRECEDES   | A → B | B.chain_root = SHA-256(JCS(A))                                                                                                                   | B is structurally downstream of A in the attribution chain. B's creator explicitly set their chain_root by hashing A's complete signed record. This is the primary structural link.                                                                        |
| SESSION_PRECEDES | A → B | Same context_id; no CHAIN_PRECEDES between A and B; A.timestamp \< B.timestamp                                                                   | A occurred before B in the same session with no chain structure connecting them. Temporal ordering only, no structural claim.                                                                                                                             |
| SESSION_PARALLEL | A ↔ B | Same context_id; no CHAIN_PRECEDES between A and B; no temporal ordering                                                                         | A and B are co-contributors to the same session with neither chain structure nor observable temporal ordering between them. Undirected.                                                                                                                    |
| CONVERGES_ON     | N → T | N is a tool_call or gap_node; T is a transaction node; both share context_id                                                                     | Node N contributed to the session that produced transaction T. Every contributing node in a session with a transaction node receives a CONVERGES_ON edge to that transaction. This is the edge that makes settlement calculation structurally possible. observation and extension nodes do NOT receive CONVERGES_ON edges (D042, D043). |
| CROSS_SESSION    | A → T | A is a tool_call node; T is a transaction node; different context_ids; A.session_token = T.session_token (both fields must be present and equal) | A contributed to a transaction that occurred in a different session of the *same logical session*. This edge is only created when both records carry the same explicit `session_token` field value. It is never inferred from timestamps, creator keys, or any other heuristic.          |
| INFORMED_BY      | A → B | A's `informed_by` array contains `"sha256:" + hex(record_hash(B))`                                                                               | A's creator claims B was a record that informed A's action. Structural derivation from a declared field; atrib certifies the claim was signed, not its truthfulness. May be intra-session or cross-session (B may be in any context_id). When B is not in the resolved record set, the edge is created against a synthetic dangling node with `dangling: true`. See D041. |
| PROVENANCE_OF    | D → U | D and U both carry `provenance_token` with the same value; D.context_id ≠ U.context_id; U's record_hash matches the token's source              | D's action is causally anchored on U's upstream record. This is *cross-session causal anchoring* distinct from CROSS_SESSION's "same logical session" semantics. The token derivation (`base64url(record_hash[:16])`) makes U identifiable as the anchor source. See D044. |

**Note (Mutual exclusivity):** CHAIN_PRECEDES and SESSION_PRECEDES are mutually exclusive between any given ordered pair of nodes: if a CHAIN_PRECEDES edge exists from A to B, no SESSION_PRECEDES edge is created between A and B in either direction. SESSION_PARALLEL and SESSION_PRECEDES are mutually exclusive between any given pair of nodes. CONVERGES_ON coexists with all within-session edge types. CROSS_SESSION only applies when context_ids differ and a session_token match is present. INFORMED_BY and PROVENANCE_OF coexist with all other edge types; they are agent-declared causal anchors and may overlap with the structural edges.

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

For each ordered pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction: if `A.timestamp < B.timestamp`, create SESSION_PRECEDES A → B. When timestamps are equal, use ascending log_index as the tiebreaker. Gap nodes with `log_index: null` are sorted after all nodes with the same timestamp that have a numeric `log_index`. Among multiple gap nodes with the same timestamp, order is arbitrary (SESSION_PARALLEL is assigned). If log_index is also equal (nodes in the same batch), skip; they are SESSION_PARALLEL candidates.

**Step 3:** SESSION_PARALLEL edges**

For each pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction and no SESSION_PRECEDES edge exists between them in either direction: create SESSION_PARALLEL A ↔ B (undirected).

**Step 4:** CONVERGES_ON edges**

For each transaction node T: for each other node N sharing T's context_id (tool_call or gap_node), create CONVERGES_ON N → T.

If a session contains multiple transaction nodes, each non-transaction node receives CONVERGES_ON edges to all of them. The calculation algorithm (§4.6) uses the first transaction node (by log_index) for modifier computations such as temporal_decay.

**Step 5:** CROSS_SESSION edges**

For each transaction node T: search the record set for tool_call nodes A where `A.context_id ≠ T.context_id` and A's `session_token` field (§1.2.1) matches T's `session_token` field. For each such A, create CROSS_SESSION A → T.

CROSS_SESSION edges MUST NOT be inferred from any heuristic. Only explicit `session_token` field matches in signed records qualify. Records without a `session_token` field cannot participate in CROSS_SESSION edges.

**Step 6:** INFORMED_BY edges**

For each record A carrying a non-empty `informed_by` array: for each entry `e` in the array (where `e` matches `"sha256:" + hex(record_hash)`): search the resolved record set for a record B with `sha256_hex(jcs(B)) == e[7:]`. If B is found, create INFORMED_BY A → B. If B is not found, create INFORMED_BY A → synthetic_dangling_node(e) and mark the edge `dangling: true`.

INFORMED_BY edges MAY be intra-session or cross-session. Source and target may be of any node type (tool_call, transaction, observation, extension). The agent's claim is authoritative for the edge derivation; atrib does not validate that the referenced records actually informed the action.

**Step 7:** PROVENANCE_OF edges**

For each session-genesis record D carrying a non-empty `provenance_token` field of value T: search the record set for any record U where `base64url(SHA-256(JCS(U))[:16]) == T` and `U.context_id ≠ D.context_id`. If found, create PROVENANCE_OF D → U. The direction reads as "D's session descends from U's anchor."

If no record U in the resolved set satisfies the derivation predicate, create PROVENANCE_OF D → synthetic_dangling_node(T) with `dangling: true` and `reason: "no_token_source_in_record_set"`. This makes the dangling case visible rather than silently dropping the edge.

Validators MUST reject any non-genesis record carrying `provenance_token` (per §1.2.6 scope constraint); such records do not participate in PROVENANCE_OF derivation because they are malformed.

PROVENANCE_OF expresses cross-session *causal anchoring*, distinct from CROSS_SESSION's *same logical session* semantics. The two edge types may coexist when a session both belongs to a multi-trace logical session (session_token) AND descends from a prior session's anchor (provenance_token).

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

All endpoints are served at `https://graph.atrib.dev/v1/`. All responses use `Content-Type: application/json`. All errors use RFC 9457 Problem Details (`Content-Type: application/problem+json`). The API is read-only.

#### 3.4.1 GET /v1/graph/{context_id}

Returns the complete attribution graph for a session: all nodes and edges, computed per §3.2.4.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736

// Optional query parameters:
// include_gap_nodes=true|false      (default: true)
// include_cross_session=true|false  (default: true)
// include_proof=true|false          (default: false; proof bundles are large)

// 200 OK  -> GraphResponse ([§3.5.1](#351-graph-response-object))
// 404     -> no records with this context_id
// 400     -> malformed context_id (not 32 hex chars)
```

#### 3.4.2 GET /v1/graph/{context_id}/nodes

Returns only nodes, without edges. Used by policy engines that apply their own traversal logic.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736/nodes

// Optional: event_type=<URI>  (e.g. https://atrib.dev/v1/types/tool_call,
//                              https://atrib.dev/v1/types/transaction,
//                              https://atrib.dev/v1/types/observation,
//                              or an extension URI)
// Optional: event_type=gap_node              (synthetic node type per [§3.2.5](#325-gap-nodes))
// Optional: creator_key=
// Optional: verification_state=unsigned|signature_valid|log_committed|witnessed

// 200 OK -> { "nodes": [NodeObject, ...] }
```

#### 3.4.3 GET /v1/graph/{context_id}/transaction

Returns the transaction node for a session if one exists. Policy engines use this to confirm the loop is closed before running settlement calculations.

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736/transaction

// 200 OK  -> NodeObject (event_type matches the transaction URI per [§1.2.4](#124-event_type-values) / atrib/1.0 short token)
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
  "id":                       "sha256:3f8a2b...",  // record_hash from log; "gap:..." for gap nodes; "dangling:..." for synthetic dangling nodes
  "event_type":               "https://atrib.dev/v1/types/tool_call", // absolute URI; "gap_node" for synthetic gap nodes
  "event_type_kind":          "tool_call",         // one of: tool_call | transaction | observation | extension | gap_node
  "content_id":               "sha256:7e1f...",    // null for gap_node
  "creator_key":              "ABC...",            // null for gap_node
  "chain_root":               "sha256:9a3c...",    // null for gap_node
  "context_id":               "4bf92f35...",
  "timestamp":                1743850010000,
  "timestamp_granularity":    "ms",                // [§8.4](#84-coarsened-timing-posture) disclosure posture
  "log_index":                4821936,            // null for gap_node
  "verification_state":       "log_committed",    // see [§3.3](#33-verification-state)
  "is_genesis":               false,              // true if chain_root = SHA-256(context_id)
  "proof":                    null,               // inclusion proof bundle ([§2.8](#28-proof-bundle-format)); null unless requested

  // [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) informed_by surfacing
  "informed_by_count":        2,                  // number of references in the field; 0 if absent
  "informed_by_resolution":   {                   // null if informed_by absent
    "resolved":  ["sha256:abc...", "sha256:def..."],   // record_hashes successfully resolved in the response set
    "dangling":  []                                    // record_hashes that did not resolve
  },

  // [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) provenance_token surfacing (genesis records only)
  "provenance":               {                   // null when no provenance_token claimed
    "token":               "abc123...xyz",       // 22-char base64url
    "upstream_record_hash": "sha256:abc...",     // resolved upstream hash; null if dangling
    "upstream_resolved":   { /* ResolvedRecord | null */ }
  }
}
```

The `event_type_kind` field is a derived convenience: it maps the URI to one of the five graph node-type labels (tool_call, transaction, observation, extension, gap_node) for client-side type discrimination without URI parsing. The full URI remains authoritative.

#### 3.5.3 Edge Object

```
{
  "type":     "CHAIN_PRECEDES",    // one of the seven defined types ([§3.2.3](#323-edge-types))
  "source":   "sha256:3f8a2b...",  // source node id
  "target":   "sha256:8b2f1c...",  // target node id
  "directed": true,                // false only for SESSION_PARALLEL
  "dangling": false                // true when target is a synthetic dangling node (INFORMED_BY or PROVENANCE_OF only)
}
```

#### 3.5.4 Error Responses

```
// RFC 9457 Problem Details. All errors use this format:
{
  "type":     "https://atrib.dev/problems/session-not-found",
  "title":    "Session not found",
  "status":   404,
  "detail":   "No attribution records found for context_id 4bf92f35...",
  "instance": "/v1/graph/4bf92f3577b34da6a3ce929d0e0e4736"
}
// Defined problem types:
// atrib.dev/problems/session-not-found     404
// atrib.dev/problems/invalid-context-id    400
// atrib.dev/problems/invalid-creator-key   400
// atrib.dev/problems/unauthorized          401
// atrib.dev/problems/graph-unavailable     503
```

---

### 3.6 Implementation Notes

_This section is informative._

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
- [4.8 Scope Boundaries](#48-scope-boundaries) _(see §1.8)_

### 4.1 Purpose and Position in the Protocol

_This section is informative._

The three preceding sections define what happened. This section defines how to evaluate what happened for the purpose of distributing value.

Policies are first-class protocol primitives, not configuration files or implementation details. They are machine-readable documents that agents can fetch, parse, apply, and reason about autonomously. The spec defines the policy schema; creators and merchants define their own policies within that schema. The protocol defines how policies are negotiated and how the calculation is performed; it does not define what any contribution is worth.

Two moments in the session lifecycle are relevant to this section. **Negotiation** happens at session initialization, before any tool calls are made, the agent reads available creator and merchant policies and establishes the agreed policy for the session (§4.5). **Calculation** happens after the transaction closes, and the agreed policy is applied to the completed graph to produce a settlement recommendation (§4.6). These are distinct operations on distinct inputs separated in time. The policy negotiated at session start is the policy applied at calculation time, regardless of whether policies have changed in between.

---

### 4.2 Policy Document Format

A policy document is a JSON object. It MUST be UTF-8 encoded and served with `Content-Type: application/json`. It MUST be valid JSON conforming to the schema defined in this section. Unknown fields MUST be ignored by implementations to allow forward compatibility.

#### 4.2.1 Top-Level Fields

```
{
  "spec_version":  "atrib/1.0",          // REQUIRED. Must be "atrib/1.0" for policies conforming to this specification.
  "policy_id":     "https://example.com/.well-known/atrib-policy.json",
                                           // REQUIRED. Stable URL where this policy is published.
                                           // Used as the canonical identifier in session policy records.
  "role":          "creator",            // REQUIRED. "creator", "merchant", or "default".
  "edge_weights":  { /* [§4.2.2](#422-edge-weights) */ },     // REQUIRED.
  "modifiers":     [ /* [§4.2.3](#423-modifiers) */ ],     // OPTIONAL. Default: no modifiers.
  "distribution":  "proportional",      // REQUIRED. See [§4.2.4](#424-distribution-method).
  "constraints":   { /* [§4.2.5](#425-constraints) */ }      // OPTIONAL. Default: no constraints.
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
// They are not defaults. Only the default policy ([§4.3](#43-the-default-policy)) specifies default weights.
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

// Only these three modifier types are defined by this specification.
// Unknown modifier types MUST be ignored with a warning in the session policy record.
```

#### 4.2.4 Distribution Method

The distribution method determines how final scores are converted into share fractions. One method is defined by this specification:

| Value        | Behavior                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| proportional | Each contributor's share is their final score divided by the sum of all final scores. If all final scores are zero (which can occur if all nodes are gap nodes under a policy that weights unsigned nodes at 0.0) the calculation produces an empty distribution with a warning, not an error. |

Additional distribution methods (`equal`, `last_touch`, `first_touch`) are reserved identifiers. Their semantics are not defined by this specification. Implementations MUST reject policies with unknown distribution values rather than silently falling back to proportional.

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
  // Read during negotiation ([§4.5.2](#452-conflict-resolution)), not applied by the calculation algorithm directly.
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
  // the merchant's value takes precedence ([§4.5.2](#452-conflict-resolution)).
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
  "policy_id":    "https://atrib.dev/policies/default/v1",
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

**Note (Negotiation is best-effort):** Session initialization may be fast-path and policy fetching may add latency. Agents MAY skip negotiation and proceed under the default policy when latency constraints require it. When this happens, the session policy record MUST indicate that the default policy was used due to a negotiation skip. Merchants and creators who require specific policies SHOULD ensure their policies are available with low latency and published at stable, well-cached URLs.

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

Any party (creator, merchant, auditor, regulator) with access to the graph data and the policy document MUST be able to run this algorithm locally and arrive at the same result as any other party running the same inputs. The atrib resolution API (at `https://resolve.atrib.dev/v1/calculate`) is a convenience implementation of this algorithm, not an authority. Its output is no more or less trustworthy than a local implementation producing the same output from the same inputs.

All arithmetic in the calculation algorithm uses IEEE 754 double-precision floating-point. Intermediate rounding is acceptable. The 1e-9 tolerance in `distributionsMatch()` (§4.7.3) accounts for accumulated floating-point error across implementations.

#### 4.6.1 Inputs and Preconditions

Inputs:

- `G`: the attribution graph for the session, as returned by the graph query API (§3.4.1) with `include_gap_nodes=true` and `include_cross_session=true`.

- `P`: the agreed policy document for the session (§4.5.3).

Preconditions that MUST hold before the algorithm runs:

- `G` contains at least one transaction node. If no transaction node is present, the session is not closed and calculation MUST NOT proceed.

- `P` is a valid policy document per the schema in §4.2. If validation fails, use the default policy.

- All nodes in `G` whose `verification_state` is `signature_valid` or higher are eligible for distribution. Nodes with `verification_state: unsigned` are eligible only if `P.edge_weights.unsigned > 0`.

#### 4.6.2 Step 1: Identify Contributing Nodes

A node `N` is a contributing node if all of the following hold:

- `N.event_type` is `tool_call` or `gap_node` (not `transaction`).

  **Note (event_type matching).** Throughout §4.6, the short labels `tool_call`, `transaction`, and `gap_node` refer to the corresponding atrib normative URIs (`https://atrib.dev/v1/types/tool_call`, `https://atrib.dev/v1/types/transaction`) plus the synthetic graph-layer type `gap_node`. The other normative URI `https://atrib.dev/v1/types/observation` (D042) and any extension URI (D043) are NOT contributing nodes. observations are witnesses (the agent did not invoke a tool to produce them) and are skipped from contribution selection. Extension URIs are consumer-namespace and atrib does not bless their attribution claims by default; consumers wanting their extension URIs to count for attribution express it in their own §4 policy document, not via §4.6 default. Promotion of an extension URI to atrib's normative contributing set requires D036's bar.

  **Note (transaction record cross-attestation per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records)).** For a transaction node `T` to serve as the §4.6 receiver, `T`'s `signers` array MUST contain at least 2 verified signatures (cross-attestation requirement). Verification of each signature follows §1.4. If `T` carries fewer than 2 verified signers (or only the legacy top-level `signature` field with no `signers` array), the verifier MUST set `T.cross_attestation_missing = true` on the verification output. Strict consumer policies MAY reject §4.6 calculation entirely when `cross_attestation_missing: true`; the default behavior is to compute the calculation, return it, and surface the flag. The receiver-vs-contributor distinction does NOT relax cross-attestation: the substrate's strongest robustness commitment lives at the transaction layer, and the calculation algorithm is one of the consumers that benefits from it.

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
                  and G.nodes[e.target].event_type == "https://atrib.dev/v1/types/transaction"}
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
    //
    // When traversing an undirected SESSION_PARALLEL edge from node A to node B,
    // the traversal proceeds in both directions. If B can reach a transaction
    // node, SESSION_PARALLEL is added to A's collected edge types. The collected
    // edge types for a node are the union of all edge types on any path (directed
    // or undirected) from that node to any transaction node.
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
    // transaction node. If no directed CHAIN_PRECEDES path exists from N to any
    // transaction node, the depth is set to the ceiling of
    // `1.0 / penalty_per_level`, which is the smallest integer that drives
    // `max(0.0, 1.0 - depth * penalty_per_level)` to zero. The resulting
    // factor is 0.0.
    factor = max(0.0, 1.0 - depth * modifier.penalty_per_level)
    return score * factor

  if modifier.type == "call_count_boost":
    // Nodes with `content_id: null` (gap nodes) do not match any other node's
    // content_id. Their call count is always 1.
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
    // The equal distribution fallback MAY produce node shares below
    // `minimum_share`. This is acceptable because the constraint cannot be
    // honored: the sum of all minimum floors exceeds 1.0. The fallback
    // preserves the sum-to-1.0 invariant at the cost of the floor invariant.
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

This order is normative. Implementations MUST apply minimum_share before maximum_share.

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
  "policy_record_id":"sha256:3f8a2b...",    // record_id of the session policy record ([§4.5.3](#453-session-policy-record))
  "graph_checkpoint":"log.atrib.dev/v1",   // log origin used for graph data
  "graph_tree_size": 4821937,              // log tree size at calculation time
  "calculated_at":   1743860000000,
  "calculated_by":   "https://resolve.atrib.dev/v1",
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

When the atrib resolution API produces the recommendation, it signs with atrib's key (published at `https://resolve.atrib.dev/v1/pubkey`). When a merchant or third party runs the calculation locally, they sign with their own key. Any verifier who checks the signature must use the appropriate public key based on `calculated_by`.

#### 4.7.3 Independent Verification

Any party with access to the graph data and the session policy record can independently verify a settlement recommendation by:

Step 1: Verify the recommendation's signature using the public key of `calculated_by`.

Step 2: Fetch the graph for `context_id` from `graph_checkpoint` (the log identified by `graph_checkpoint` at tree size `graph_tree_size`).

Step 3: Fetch the session policy record identified by `policy_record_id`. Retrieve the agreed policy from `agreed_policy`.

Step 4: Run the calculation algorithm (§4.6) with those inputs.

Step 5: Compare the output with the `distribution` field. Shares MUST match within a floating-point tolerance of `1e-9`. Any discrepancy beyond this tolerance indicates either a bug, a different policy was applied, or the recommendation was tampered with.

**Important:** Verification requires the same graph snapshot** The graph for a session can grow after a transaction closes: late attribution records may arrive, gap nodes may be resolved by creators who submit delayed records, CROSS_SESSION edges may be added as session_token links are discovered. The `graph_tree_size` field pins the graph to a specific log state. Independent verifiers MUST use the same tree size to reconstruct the same graph. Using the current graph state may produce a different result if the graph has grown since calculation time. This is not an error; it is expected behavior. If a merchant wishes to recalculate with a more complete graph, they may do so and produce a new recommendation.

---

### 4.8 Scope Boundaries

_See §1.8 for protocol-wide scope boundaries including policy versioning, dispute mechanism, settlement webhooks, multi-transaction sessions, and agent-published policies._

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

_This section is informative._

The fundamental design requirement for all atrib SDKs is that attribution must happen automatically as a consequence of agents and tools doing what they already do, not as something developers explicitly trigger. The moment a developer must decide when to call an attribution method, adoption fails. They will intend to add it later and never do.

This means the SDK specification defines a **middleware contract**, not an API. There are no methods for developers to call after init. There are no configuration options for when to emit. There is one function call at startup and zero ongoing surface area.

A conforming SDK implementation MUST satisfy all the automation triggers defined in §5.7. A conforming implementation MUST NEVER require the developer to call any attribution method explicitly after initialization. A conforming implementation MUST NEVER fail or throw an exception in a way that affects the primary tool call or agent response.

---

### 5.2 Package Overview

_This section is informative._

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
  creatorKey: process.env.ATRIB_PRIVATE_KEY   // REQUIRED (see [§5.6](#56-key-management))
})
```

**Init options**

| Option           | Type       | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey       | string     | Required | Base64url-encoded 32-byte Ed25519 seed. Used to sign all attribution records emitted by this server. See §5.6 for generation and storage requirements.                                                                                                                                                                                                                                                                                                       |
| logEndpoint      | string     | Optional | URL of the Merkle log submission endpoint. Default: `https://log.atrib.dev/v1/entries`. Override for private log deployments.                                                                                                                                                                                                                                                                                                                                           |
| policy           | object     | Optional | Inline attribution policy document (§4.2). If provided, served at `/.well-known/atrib-policy.json`. If absent, a 404 is served at that path (default policy applies for callers).                                                                                                                                                                                                                                                                                      |
| serverUrl        | string     | Optional | Canonical URL of this MCP server, used to compute `content_id` values (§1.2.2). Default: derived from the server's HTTP host header. MUST be set explicitly for stdio transport where no host header is available.                                                                                                                                                                                                                                                     |
| transactionTools | string\[\] | Optional | Array of tool names that complete commerce transactions. When a successful call to one of these tools is detected, `@atrib/mcp` emits a record with `event_type: "https://atrib.dev/v1/types/transaction"` rather than `"https://atrib.dev/v1/types/tool_call"`. This is how Path 1 merchant-side transaction emission (§5.4.5) is implemented. The merchant's checkout tool name(s) should be listed here. If not set, `@atrib/mcp` emits only `tool_call` records and Path 2 agent-side detection applies. |
| onRecord         | function   | Optional | `(record: AtribRecord) => void \| Promise<void>`. Observer invoked once per signed record AFTER signing and BEFORE log submission. Lets a host persist or audit the record locally; without this hook the original signed JSON is unrecoverable because the log stores only commitments (§2.10). Errors thrown or promises rejected by the observer are caught and warned via `console.warn`; they MUST NOT block submission, MUST NOT affect the attribution token in `_meta`, and MUST NOT affect the tool response, preserving the §5.8 degradation contract. Typical uses: dogfood verification (replay `verifyRecord` against `creator_key`), local audit trail, replay debugging.                                                                                  |

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
  content_id:   computeContentId(serverUrl, toolName),    // [§1.2.2](#122-content_id-derivation)
  creator_key:  publicKeyFromPrivate(creatorKey),          // base64url Ed25519 pubkey
  chain_root:   inboundContext?.record_hash            // record_hash from [§5.3.2](#532-inbound-context-reading) becomes this record's chain_root
                  ?? genesisChainRoot(context_id),       // [§1.2.3](#123-chain_root-for-genesis-records) if no upstream
  event_type:   isTransaction
    ? "https://atrib.dev/v1/types/transaction"
    : "https://atrib.dev/v1/types/tool_call",                  // [§1.2.4](#124-event_type-values)

  context_id:   context_id,                               // OTel trace ID
  timestamp:    Date.now(),
  ...(session_token && { session_token }),                 // [§1.5.5](#155-cross-trace-session-continuity), omit field if absent
}
const signed = signRecord(record, creatorKey)             // [§1.4.2](#142-signing-procedure), synchronous
```

Record construction and signing MUST complete before the response is returned to the caller. Log submission (§5.3.5) MUST happen after the response is sent and is always non-blocking, including for transaction records. See §5.3.5 for submission behavior, retry logic, and the priority distinction between transaction and tool_call records.

**Optional observer hook.** If an `onRecord` callback was provided at init (§5.3.1), the middleware MUST invoke it with the signed record after signing completes and before log submission begins. This is the only point at which the original signed JSON is observable to the host, because the log itself stores only commitments (§2.10). The observer is invoked synchronously from the middleware's perspective: a returned Promise is not awaited, but rejections are captured and logged. Errors thrown or promises rejected by the observer MUST NOT propagate to the tool response, MUST NOT prevent log submission, and MUST NOT affect the attribution token written in §5.3.4. This preserves the §5.8 degradation contract.

**Note (Tool call failures):** Attribution records are only emitted for successful tool calls (`isError: false`). A tool call that returns an error does not generate an attribution record and does not extend the chain. The OTel span for the failed call will create a gap node in the graph (§3.2.5), visible as an unsigned hop.

#### 5.3.4 Outbound Context Writing

After signing the record, the middleware MUST write the new attribution context into the response so the calling agent can forward it downstream.

```
// Compute the propagation token ([§1.5.2](#152-http-transport-tracestate)):
// record_hash = SHA-256 of the full JCS-canonical signed record just emitted
// This becomes the chain_root field in the NEXT record that extends this chain.
const record_hash_bytes = sha256(jcs(signed))
const creator_key_bytes = publicKeyBytes(creatorKey)
const token = base64url(record_hash_bytes) + '.' + base64url(creator_key_bytes)

// Write to response in all applicable locations:
response._meta.atrib = token                         // always, MCP metadata (CallToolResult top-level _meta)
response.headers['tracestate'] = `atrib=${token},` + response.headers['tracestate']  // HTTP transport, prepend per W3C
response.headers['X-atrib-Chain'] = token            // fallback header
```

The tracestate value MUST NOT replace existing tracestate entries. Per W3C Trace Context, the most recently modified entry SHOULD be leftmost. Implementations SHOULD prepend the `atrib=` entry rather than appending it. The full token is 87 characters maximum and fits within the W3C tracestate per-vendor limit of 256 characters.

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
  creatorKey:     process.env.ATRIB_PRIVATE_KEY,  // REQUIRED (see [§5.6](#56-key-management))
  merchantDomain: 'https://merchant.example.com', // OPTIONAL, for policy fetch at session init
  logEndpoint:    'https://log.atrib.dev/v1/entries', // OPTIONAL, default shown
  sessionToken:   'my-session',                    // OPTIONAL (see [§1.5.5](#155-cross-trace-session-continuity))
  serverUrls:     ['https://tool-a.example', 'https://tool-b.example'], // OPTIONAL, for policy fetch
})

// The interceptor exposes four methods. The caller invokes them at the
// appropriate points in their MCP client's request/response lifecycle:
//
// 1. Before sending a tools/call request:
const meta = await interceptor.onBeforeToolCall(toolName, existingMeta)
// `meta` is the merged _meta object to attach to the outbound request.
// Init runs lazily on the first call ([§5.4.2](#542-session-initialization)).
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

Implementations are free to wrap this surface in higher-level adapters for specific frameworks (a LangChain callback, an AI SDK middleware, an MCP client subclass), but the protocol-level contract is the four methods above. The reference implementation in `@atrib/agent` ships only the interceptor; framework adapters are outside the scope of this specification.

**Init options**

| Option         | Type   | Required | Description                                                                                                                                                                                                                |
| -------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey     | string | Required | Base64url Ed25519 private key. Used to sign agent-level attribution records when the agent itself is a contributor (e.g., it produces content that influences a transaction). Also used to sign the session policy record. |
| merchantDomain | string | Optional | Base URL of the merchant whose policies should be fetched at session initialization. If not provided, policy negotiation is skipped and the default policy applies.                                                        |
| logEndpoint    | string | Optional | Merkle log submission endpoint. Default: `https://log.atrib.dev/v1/entries`.                                                                                                                                                |
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
// Token format per [§1.5.2](#152-http-transport-tracestate): base64url(record_hash) + '.' + base64url(creator_key)
// record_hash = SHA-256 of the JCS-canonical signed record received in the last response
// creator_key = full 32-byte Ed25519 public key of the creator who signed that record
const token = sessionState.latestContext
  ? base64url(sessionState.latestContext.record_hash) + '.'
      + base64url(sessionState.latestContext.creator_key)
  : null

if (token) {
  request.params._meta.atrib = token               // always
  request.headers.tracestate  = `atrib=${token},` + request.headers.tracestate  // HTTP transport, prepend per W3C
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
  const { record_hash, creator_key } = decodeToken(token)  // [§1.5.2](#152-http-transport-tracestate)
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
  // Per [§1.7.1](#171-acp-agentic-commerce-protocol) and [§1.7.2](#172-ucp-universal-commerce-protocol), both protocols converged on the same shape; UCP
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
  //   MPP     → Payment-Receipt       (per draft-ryan-httpauth-payment-01 [§5.3](#53-atribmcp-mcp-server-middleware))
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

In both paths, when Path 2 is taken, the record MUST be submitted to the log immediately, because the transaction event is the closing anchor of the attribution graph.

**Note (Heuristic detection is a fallback):** The tool name heuristic fires only when no protocol-level transaction signal is present. It is less reliable; a tool named `checkout` might be a UI component, not a payment completion. When heuristic detection fires, the transaction record's `event_type` is still `https://atrib.dev/v1/types/transaction` but the session policy record includes a warning: `"transaction_detected_by_heuristic"`. Merchants may choose to require protocol-level detection for settlement purposes by filtering on this warning in their verification workflow.

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
  logEndpoint:     'https://log.atrib.dev/v1',    // OPTIONAL, default shown
  graphEndpoint:   'https://graph.atrib.dev/v1',  // OPTIONAL, default shown
  resolveEndpoint: 'https://resolve.atrib.dev/v1', // OPTIONAL, for remote calculation
  merchantKey:     process.env.ATRIB_MERCHANT_KEY, // OPTIONAL, for self-signing recommendations
})

// If merchantKey is not set:
// - verify() still works; it only needs the recommendation's calculated_by public key
// - calculate() with signWith: 'merchant' returns an unsigned recommendation
//   with a warnings entry: "merchantKey not set, recommendation unsigned"
// - calculate() never throws due to a missing key (degradation contract [§5.8](#58-degradation-contract))
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

// recommendation is a signed settlement recommendation document ([§4.7](#47-settlement-recommendation-document))
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

**Key compromise.** This specification does not define a key rotation or revocation mechanism (see §1.8). A compromised key cannot be revoked within the protocol; it can only be abandoned. Creators who believe their key has been compromised should generate a new key, publish a public attestation linking their old and new keys, and begin submitting records under the new key.

---

### 5.7 Automation Triggers (Normative)

This section is normative. A conforming implementation MUST fire each trigger at exactly the stated moment, with exactly the stated behavior. Implementations MUST NOT require developer input to activate any trigger. Implementations MUST NOT expose configuration options for suppressing individual triggers.

| Trigger              | When                                                                                                        | Package      | Action                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| session_init         | Before the first outbound `tools/call` in a session                                                         | @atrib/agent | Establish context_id, generate session_token, fetch and negotiate policies, create session policy record (§5.4.2).                                                                                                                                                                                  |
| tool_call_outbound   | Immediately before every outbound `tools/call` request is sent                                              | @atrib/agent | Attach attribution context token to request headers and `params._meta` (§5.4.3).                                                                                                                                                                                                                    |
| tool_call_inbound    | Immediately after every inbound `tools/call` response is received, if `isError: false`                      | @atrib/agent | Read and store attribution context from response. Update session state (§5.4.4). Check for transaction signal (§5.4.5).                                                                                                                                                                             |
| tool_served          | Immediately after a tool handler completes successfully (`isError: false`), before the response is returned | @atrib/mcp   | Construct, sign, and write attribution record (event_type: `tool_call` URI, or `transaction` URI if tool is in `transactionTools`; see §1.2.4). Attach context token to response (§5.3.3–5.3.4). Submit to log (synchronously for transaction records, asynchronously for tool_call records per §5.3.5).               |
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

---

## §6 Key Directory

_Per D034._

The key directory maps `creator_key` to a public identity claim. Without it, attribution is purely cryptographic. Verifiers see opaque public keys with no way to learn whose key it is. The directory is the missing semantic layer between "this record was signed by key K" and "K belongs to identity I."

The directory is built on top of an Auditable Key Directory (AKD) primitive. AKD provides authenticated label-indexed lookup, non-membership proofs, per-label append-only version chains, and operator-independent verifiability. Two configurations of the same primitive are deployed for two distinct privacy models:

- **Unblinded mode** (this section): plaintext labels. Lookups are observable to the directory operator. Suitable for atrib because `creator_key` is already public on the log.
- **VRF-blinded mode** (separate spec, intended for downstream consumers): VRF-blinded labels. Lookups are hidden from the directory operator. Required for use cases where label-to-value lookup is itself sensitive (for example, end-to-end-encrypted messaging where `user_id → key` lookup must not leak interest in a specific user).

Both modes share the AKD library and the witness model from §2.9.

### 6.1 Identity Claim Format

An identity claim is the directory's leaf payload:

```json
{
  "spec_version": "atrib/1.0",
  "claim_type": "creator_identity",
  "creator_key": "<base64url 32-byte Ed25519 public key>",
  "claim": {
    "subject": "<freeform identity, e.g. 'tools.openai.com', 'did:web:example.com', 'mailto:nader@atrib.dev'>",
    "method": "self_attested" | "domain_verified" | "did_resolved",
    "registered_at": <unix-ms>,
    "expires_at": <unix-ms> | null,
    "metadata": { ... }
  },
  "signature": "<base64url 64-byte Ed25519 signature>"
}
```

#### 6.1.1 Field Semantics

- **`creator_key`**: the public key whose identity this claim describes. The same key value used in attribution records' `creator_key` field.
- **`claim.subject`**: a freeform identity string. Common forms: domain name (`tools.openai.com`), DID (`did:web:example.com`, `did:key:...`), email (`mailto:nader@atrib.dev`), or service URL (`https://my-tool.example.com`). The protocol does not enforce the format; verifiers apply their own policy.
- **`claim.method`**: how the subject was verified.
  - `self_attested`: the claim is signed by `creator_key`. No external proof. Verifiers MUST treat this as "the key holder asserts this identity, with no third-party validation."
  - `domain_verified`: the claim subject is a domain name and the claim's metadata includes a `txt_record` proof (`atrib-creator=<creator_key>` published as a TXT record on the subject domain). Verifiers MAY confirm the TXT record at lookup time.
  - `did_resolved`: the subject is a DID; the claim's metadata includes a `did_document` reference. Verifiers MAY resolve the DID and confirm `creator_key` is listed as a `verificationMethod`.
- **`claim.registered_at` / `claim.expires_at`**: unix milliseconds. Claims with `expires_at < now` are treated as expired and not returned by lookup unless explicitly requested with `include_expired=true`.
- **`claim.metadata`**: extensible. Contains method-specific verification data (TXT proof, DID document URL) and optional human-readable info (display name, logo URL, contact). The metadata MUST NOT contain anything that would distinguish active claims from honeypot claims by structure alone. Verifiers should make trust decisions on the verification method, not on metadata richness.
- **`signature`**: Ed25519 signature over the JCS-canonical serialization of the claim with `signature: ""`. Signed by `creator_key` itself (self-attestation) regardless of `method`.

### 6.2 Directory Operations

The directory exposes four normative operations.

#### 6.2.1 Publish

```
POST /v6/publish
Content-Type: application/json

<IdentityClaim>
```

Inserts an identity claim under label `creator_key`. If a claim already exists for this key, the new claim replaces it (forming a per-label version chain; old claims remain queryable via `history`, new claim is the active version). The directory operator validates:

- Signature verifies under `creator_key`.
- `method`-specific proof (TXT record, DID document) succeeds when `method !== 'self_attested'`. Operators MAY defer verification or batch it.
- The claim is not contradicted by an unexpired `key_revocation` record on the log.

On success, the directory returns:

```json
{
  "label": "<base64url creator_key>",
  "version": <integer>,
  "directory_root": "<base64url root commitment>",
  "directory_tree_size": <integer>,
  "publish_proof": "<base64url proof of inclusion>"
}
```

#### 6.2.2 Lookup

```
GET /v6/lookup/<base64url-creator-key>?at=<directory_tree_size>
```

Returns the active claim for the key at the specified directory tree size (or the latest if `at` is omitted), with an authenticated proof. Response:

```json
{
  "found": true,
  "claim": <IdentityClaim>,
  "label": "<base64url creator_key>",
  "version": <integer>,
  "lookup_proof": "<base64url AKD lookup proof>",
  "directory_root": "<base64url root commitment>",
  "directory_tree_size": <integer>
}
```

If no claim exists, the response is a non-membership proof:

```json
{
  "found": false,
  "label": "<base64url creator_key>",
  "absence_proof": "<base64url AKD non-membership proof>",
  "directory_root": "<base64url root commitment>",
  "directory_tree_size": <integer>
}
```

A verifier MUST validate the proof against `directory_root`. The directory operator cannot return "no entry" without a cryptographic proof of absence.

#### 6.2.3 History

```
GET /v6/history/<base64url-creator-key>
```

Returns the full version chain for the label. Used to reconstruct rotation events and to detect inconsistencies between rotation announcements (in the log) and directory updates.

#### 6.2.4 Anchor (Cross-Reference Into the Tessera Log)

The directory's root commitment is periodically posted to the Tessera log (§2) as a `directory_anchor` record, allowing a verifier consulting the log to detect a forked or split-view directory:

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "directory_anchor",
  "context_id": "<directory operator's reserved context_id>",
  "creator_key": "<directory operator's pubkey>",
  "chain_root": "<previous directory_anchor's record_hash, or genesis>",
  "content_id": "<sha256 of canonical directory_root>",
  "timestamp": <unix-ms>,
  "metadata": {
    "directory_root": "<base64url AKD root>",
    "directory_tree_size": <integer>,
    "directory_origin": "<directory's signed-note origin>"
  },
  "signature": "<base64url 64-byte Ed25519 signature>"
}
```

**Anchoring cadence: per-operation (normative default).** Every successful directory operation (publish, update, revoke) MUST produce a new directory checkpoint AND emit a `directory_anchor` record to the Tessera log immediately. This is the most robust position: the equivocation window is bounded by the log round-trip (sub-second under normal operation), not by an inter-anchor delay. Per-operation anchoring also gives every directory state change the same witness-cosignature coverage as ordinary log entries.

**Batching escape hatch (operator opt-in).** Operators serving high-throughput directories MAY batch multiple directory operations into a single anchor by declaring a batching policy in their directory metadata. The policy MUST specify (a) the maximum batch interval, (b) the maximum number of operations per batch, and (c) the consumer-facing implication: queries against a batched directory state MAY observe an unanchored window of up to the batching policy's max interval. Verifiers consuming a batched directory MUST surface `directory_batching_window_ms: <value>` so consumers can apply policy. atrib's reference directory implementation is per-operation; batching is for downstream operators with throughput requirements that exceed per-operation limits.

### 6.3 Verifier Consultation Algorithm

_This section is normative._

A verifier resolving identity for an attribution record `R` with `creator_key = K` and `timestamp = T` against directory `D` MUST execute the following nine steps in order. Each step's failure produces a warning surfaced in the output; the verifier never throws (per [§5.8](#58-degradation-contract) degradation contract).

**Step 1: Fetch latest anchor.** Query the Tessera log for the most recent `directory_anchor` entry where `directory_origin = D.origin` and `timestamp <= T + tolerance` (tolerance = consumer-configurable; default 0). If no anchor exists, surface `directory_unanchored: true` and proceed with the directory's current state, BUT mark `identity_resolution_method: "no_anchor_available"`. If an anchor exists, capture its checkpoint root, version, and witnesses.

**Step 2: Verify anchor freshness.** Compute `anchor_age_ms = T - anchor.timestamp`. Compare against the consumer's freshness threshold (default: no threshold; consumer policy specifies). If above threshold, surface `directory_anchor_stale: true`.

**Step 3: Verify anchor witness coverage.** Confirm the anchor's underlying log checkpoint carries cosignatures from at least the consumer's configured witness threshold (per [§2.9](#29-witnessing-and-cosignatures)). If below threshold, surface `directory_witness_insufficient: { required, actual }`.

**Step 4: Verify directory checkpoint signature.** Confirm the directory's checkpoint signature against the directory's published key. If invalid, surface `directory_checkpoint_invalid: true` AND reject the entire query (do NOT proceed). A directory operator returning an invalidly-signed checkpoint is a fault, not a soft signal.

**Step 5: Verify append-only consistency.** For the chain of `directory_anchor` records between the previous anchor the verifier consulted and the current one, confirm the directory's checkpoint chain is consistent: each successive checkpoint extends the previous root via standard AKD consistency proof. If broken, surface `directory_append_only_violation: true` AND reject all queries against this directory until the operator resolves the inconsistency.

**Step 6: AKD lookup.** Query the directory for `K` at the anchor's checkpoint version. The directory returns either `(claim, version, lookup_proof)` for membership or `(null, lookup_proof)` for non-membership. Both forms include a verifiable proof.

**Step 7: Verify AKD proof.** Validate the lookup_proof against the anchored checkpoint root. If invalid, surface `directory_proof_invalid: true` AND reject the result. Membership and non-membership are distinguished outputs, both REQUIRE valid proofs.

**Step 8: Resolve identity claim.** Parse the claim object per [§6.1](#61-identity-claim-format). If malformed, surface `claim_malformed: true`. The claim is a SIGNED CLAIM by the operator, not a fact; verifier surfaces it without judging truthfulness (per [§3.1](#31-design-principles-and-rationale) and [§8.7.1](#871-the-fundamental-limit)).

**Step 9: Check revocation.** Query the directory for `key_revocation` records targeting `K` (per [§1.9](#19-key-rotation-and-revocation)). For each:
- If revocation timestamp ≤ R.timestamp: surface `key_revocation_status: { reason, revoked_at, since_revocation: false }` (record was signed before revocation; remains valid signature, flagged retroactively as suspect)
- If revocation timestamp > R.timestamp: surface `key_revocation_status: { reason, revoked_at, since_revocation: true }` (record was signed after revocation; mark with `'revoked_after_revocation'` verification flag)

If `K`'s claim carries `capabilities` per [§6.7](#67-capability-declarations), surface the active envelope at `R.timestamp` for the consumer's [§6.7.2](#672-verifier-semantics) capability check.

**Output schema.** The verifier returns an `identity_resolution` object per record:

```jsonc
{
  "identity_resolved":    ClaimObject | null,    // null for verified non-membership; null + warnings for failures
  "identity_resolution_method": "directory_lookup" | "no_anchor_available" | "no_claim_registered" | "rejected",
  "anchor": {
    "anchor_record_hash": "sha256:...",
    "checkpoint_version": 12345,
    "anchor_timestamp":   1743850000000,
    "anchor_age_ms":      50000,
    "anchor_witness_count": 3,
    "anchor_freshness_ok": true
  } | null,
  "lookup_proof_valid":           true,
  "append_only_consistent":       true,
  "key_revocation_status":        null | { "reason": "...", "revoked_at": ..., "since_revocation": bool },
  "capability_envelope":          CapabilityEnvelope | null,
  "directory_batching_window_ms": 0 | <ms>,
  "warnings": [string, ...]
}
```

**Failure semantics.** Steps 4, 5, and 7 are HARD failures (verifier rejects the result). All other failures are SOFT signals (verifier surfaces and proceeds). Consumer policy decides what to do with soft signals; the protocol does not block records on identity-layer signals because identity is one input to the [§8.7.2](#872-layered-trust-assessment) trust assessment, not a gate.

### 6.4 Witness Model

The directory's checkpoints are witnessed using the same C2SP cosignature pattern from [§2.9](#29-witnessing-and-cosignatures). A directory operator publishes its checkpoints under origin `directory.<service>.<tld>/v6` (distinct from the Tessera log's origin). Witnesses cosign directory checkpoints exactly as they cosign log checkpoints. Verifiers configure trusted witness vkeys for the directory the same way they do for the log.

The directory and the log SHOULD share witnesses where possible, since witness independence is the load-bearing security property. A witness witnessing both gives verifiers correlated evidence at lower cost.

Per [§6.2.4](#624-anchor-cross-reference-into-the-tessera-log) per-operation anchoring, every directory checkpoint produces a `directory_anchor` log entry; the witness coverage on each anchor's underlying log checkpoint applies transitively to the directory state at that version. Verifiers in [§6.3](#63-verifier-consultation-algorithm) step 3 use this transitively-applied witness coverage as the directory-side trust signal.

### 6.5 Conformance

Implementations MUST pass all vectors in [`spec/conformance/6/`](spec/conformance/6/):

- `valid-self-attested-claim`: insert and look up a self-attested claim; lookup proof verifies.
- `valid-domain-verified-claim`: insert with TXT record proof; verifier can re-confirm against DNS at lookup time.
- `valid-history`: insert two versions for one label; history returns both in chronological order.
- `valid-non-membership`: lookup of an unregistered key returns a non-membership proof that verifies.
- `valid-anchor-coherence`: a `directory_anchor` record on the Tessera log matches the directory's actual root at that tree size.
- `valid-per-operation-anchoring`: insert N consecutive operations; verifier observes N anchor records in the log, one per operation, in order.
- `valid-append-only-consistency`: anchored checkpoints (V, V+1, V+2) verifier confirms each successive checkpoint extends the previous via AKD consistency proof.
- `invalid-anchor-mismatch`: anchor's root differs from directory's actual root → verifier rejects (hard failure per [§6.3](#63-verifier-consultation-algorithm) step 4).
- `invalid-append-only-violation`: directory rolls back state between two anchored checkpoints → verifier rejects all queries until resolved (hard failure per [§6.3](#63-verifier-consultation-algorithm) step 5).
- `invalid-lookup-proof`: tampered lookup proof → verifier rejects (hard failure per [§6.3](#63-verifier-consultation-algorithm) step 7).
- `valid-anchor-stale-soft-signal`: anchor is older than consumer freshness threshold → verifier surfaces `directory_anchor_stale: true` but does not reject (soft signal).
- `valid-witness-insufficient-soft-signal`: anchor's underlying log checkpoint has fewer cosignatures than consumer threshold → verifier surfaces `directory_witness_insufficient` but does not reject (soft signal).
- `valid-non-membership-honored`: lookup of unregistered key returns `identity_resolved: null` with a verified non-membership proof; this is a positive verifier output, distinct from a query failure.
- `revocation-applies-pre-revocation-soft`: record signed before revocation timestamp → verifier surfaces `since_revocation: false` (record remains valid signature; flagged retroactively as suspect).
- `revocation-applies-post-revocation-flagged`: record signed after revocation timestamp → verifier surfaces `since_revocation: true` and marks `'revoked_after_revocation'`.
- `valid-batched-directory-window`: directory operator declares batching policy; verifier surfaces `directory_batching_window_ms: <value>` so consumer can apply policy.

### 6.6 What This DOES NOT Cover

**Identity verification beyond signature.** The protocol records claims but does not enforce that subjects are who they say they are. Trust comes from the underlying mechanism (DNS for `domain_verified`, the DID method for `did_resolved`), not from atrib.

**Privacy of unblinded mode.** Atrib's directory is public by design. Anyone can enumerate registered creator_keys and their claims. This matches the public log model. The VRF-blinded variant of AKD is available for downstream consumers (separate spec) where label-to-value lookup must be hidden from the directory operator.

**Directory-key rotation.** The directory operator's signing key has the same rotation problem as the log key. Same V2 deferral.

**Cross-directory federation.** Multiple directories operated by different parties cannot today produce consistent answers about the same creator_key. Federation is a V2 concern.

**Anchor freshness and witness threshold are consumer policy, not protocol.** §6.3 describes how a verifier consumes consumer-configured thresholds; it does not prescribe specific values. A consumer expecting near-real-time identity guarantees configures a low freshness threshold (e.g., 60 seconds) and high witness threshold (e.g., ≥3 cosignatures). A consumer doing batch settlement reconciliation configures a high freshness threshold (e.g., 24 hours) and accepts lower witness counts. The protocol surfaces the signals; the policy lives in the consumer.

**Anchor-window equivocation in batched directories.** If a directory operator opts into batching per §6.2.4, queries within the batch interval observe directory state that has not yet been anchored. Verifiers surface `directory_batching_window_ms`; consumers wanting per-operation guarantees configure their trusted-directory list to include only per-operation operators.

---

### 6.7 Capability Declarations

_This section is normative; the declaration itself is OPTIONAL._

§6.1 (identity claim format) resolves a `creator_key` to an identity ("this key belongs to Acme Corp's official agent"). Identity attestation answers WHO; it does not answer WHAT THE KEY IS ALLOWED TO DO. Without a capability framework, a compromised but legitimately-attested key can sign records of any kind, a customer-service agent's key suddenly signing million-dollar transactions verifies cryptographically the same as a normal action.

Capability declarations turn the static identity claim into a dynamic policy claim: the directory publishes the key's declared capability envelope. Verifiers check records against the envelope; out-of-envelope records are flagged.

#### 6.7.1 Identity claim extension

The §6.1 identity claim format gains an OPTIONAL `capabilities` field:

```jsonc
{
  "creator_key":   "...",
  "claim_type":    "domain_verified",
  "claim_method":  "...",
  "claim_subject": { /* identity content per [§6.1](#61-identity-claim-format) */ },
  "capabilities":  {
    "tool_names":     ["search", "browse", "read_email"],   // optional allowlist; absent = no constraint
    "max_amount":     {                                     // optional cap on transaction amounts
      "currency": "USD",
      "value":    1000
    },
    "counterparties": ["acme.com", "verified.example"],     // optional allowlist of transaction counterparties
    "event_types":    [                                     // optional allowlist of event_type URIs
      "https://atrib.dev/v1/types/tool_call",
      "https://atrib.dev/v1/types/observation"
    ],
    "expires_at":     1761000000000                         // optional; envelope rotates with the identity claim
  }
}
```

All capability sub-fields are individually optional. A claim with `capabilities: {}` declares no scope (equivalent to omitting the field). A claim with some sub-fields and not others applies only the present constraints.

#### 6.7.2 Verifier semantics

A verifier that has resolved a record's `creator_key` to an identity claim with a `capabilities` field MUST:

1. Determine the active envelope at the record's `timestamp`. The active envelope is the most recent identity claim published in §6.2 history at or before the record's timestamp. If no envelope was active at that time, the record is treated as having no envelope constraint.
2. Check the record's content against the envelope:
   - If `tool_names` is present, the record's `tool_name` MUST be in the list (for tool_call records).
   - If `event_types` is present, the record's `event_type` URI MUST be in the list.
   - For transaction records, if `max_amount` and/or `counterparties` are present, the verifier MUST resolve the transaction amount and counterparty from the protocol-specific transaction event the record commits to (per §1.7's payment-protocol definitions: ACP order envelope, UCP envelope, x402 PAYMENT-RESPONSE header, MPP Payment-Receipt, AP2 PaymentMandate, a2a-x402 receipts). The resolved amount MUST NOT exceed `max_amount`; the resolved counterparty MUST be in the `counterparties` allowlist. When the protocol-specific event is not available out-of-band, the verifier MUST flag the check as `unresolvable: true` rather than passing or failing silently.
   - If `expires_at` is present and the record's timestamp is after it, the envelope is expired (treated as having no constraint and flagged separately).
3. Surface the result as `capability_check: { envelope: CapabilityEnvelope | null, in_envelope: bool, mismatches: string[], unresolvable: bool }` on the verification output.

#### 6.7.3 Out-of-envelope is a signal, not invalidation

Records that fall outside the declared envelope remain cryptographically valid. The signature verifies, log inclusion verifies, the chain is structurally sound. The envelope check produces a SIGNAL (`in_envelope: false` plus a list of mismatches) that consumers use in trust assessment.

Defaulting to invalidation would break common cases:
- Envelope updates lag behind operational changes (operator adds a new tool but hasn't updated the envelope yet)
- Tool renames during migrations
- Operator error in publishing the envelope

Strict consumer policies MAY treat `in_envelope: false` as rejection. The default flagged-not-rejected behavior preserves operational flexibility while making the discrepancy auditable.

#### 6.7.4 Envelope rotation

When a key's capabilities change, the operator publishes a new identity claim with the updated envelope. The §6.2 directory history preserves prior envelopes; verifiers checking historical records use the envelope active at the record's timestamp.

**Operational separation of publication and signing.** The envelope check's security depends on the publication channel for identity claims being on a different operational footing than agent operation. If an attacker compromises the agent's signing key AND can publish identity claims for that key, they can backdate or expand the envelope to retroactively legitimize forged actions. Operators MUST keep these channels separated; co-location collapses the envelope check to "agent-key-equivalent" trust and provides no additional security beyond what §6 identity attestation alone provides. Operators that combine the channels MUST document the reduced trust posture in their consumer-facing documentation; verifiers MAY refuse capability-check enforcement for keys whose identity-claim publication channel is not separately attested.

**Time-of-check vs time-of-use.** The envelope active at the record's `timestamp` (per §6.7.2 step 1) is the verifier's reference. An attacker who compromises both the signing key and the publication channel can backdate envelope publications. §1.9 key revocation provides the recovery path: when compromise is discovered, the operator publishes a `key_revocation` record with `reason: compromise`, and verifiers tag all subsequent records under that key as `revoked_after_revocation`. Records signed before revocation are flagged as suspect retroactively but not invalidated. Cross-witnessing (§2.9) of the directory's checkpoints raises the bar against silent envelope-publication tampering: a backdated publication that was not previously witnessed is detectable.

#### 6.7.5 No protocol-level enforcement at signing time

atrib does not block out-of-envelope submissions or refuse to commit them. Enforcement is consumer policy at the verification layer. Consumers wanting signing-time enforcement build it into their middleware (e.g., the `@atrib/agent` adapter could refuse to sign records that violate a locally-cached envelope).

See D051 for the design rationale and the alternatives considered.

---

## §7 Harness Integration Patterns

_This section is informative._

atrib is a substrate. Agent harnesses (also called runtimes: Claude Code, Cursor, in-house agent products, custom MCP hosts) are the surfaces an end-user actually interacts with. The substrate's value is mostly invisible without a harness that surfaces signed history back to the agent.

This section documents three patterns for consuming the substrate from a harness. **None is prescribed.** Harnesses with different ergonomic constraints (interactive vs batch, single-agent vs multi-agent, cloud-hosted vs local) will pick different patterns. The patterns are documented so harness builders have a starting point, not so atrib has a canonical harness shape.

### 7.1 The Session-Start surfacing pattern

A harness exposes the agent's recent atrib history at the start of every session as additional context. The agent reads "you have N signed prior actions across M traces, root sha256:..., verify at log..." and, when prior actions are relevant to the current task, reaches for them via a tool call.

**Why this pattern.** Cheap (constant ~200 tokens per session), accurate (cryptographic root in-context means the agent treats history as provable rather than vibes-based), and harness-agnostic (any host that can inject session-start context can adopt it).

**Where it falls short.** Stateless across turns within a session: the agent only sees the summary at start, not after each tool call. For agents whose work shape changes mid-session, a per-turn surfacing is needed (pattern 7.3).

### 7.2 The recall-tool pattern

A harness exposes a tool (typically MCP) like `recall_my_attribution_history` that the agent calls on-demand. The tool reads a local mirror of signed records, verifies signatures, and returns paginated records. Filters by trace, event type, and time window are useful.

**Why this pattern.** Lazy: the agent pays the token cost only when it actively wants to consult its past. Composes cleanly with the session-start pattern (the start surface tells the agent the tool exists; the tool serves the content).

**Where it falls short.** The agent has to know to call it. Some agents won't unless explicitly nudged.

### 7.3 The persisted-mirror pattern

A harness writes every signed record to a local jsonl mirror as the wrapper produces it (via `onRecord` from §5.3). The mirror is durable across sessions and harness restarts. Other consumers (the recall tool from 7.2, an offline replay verifier, a compliance audit pipeline) read from the mirror.

**Why this pattern.** Closes the gap between "the log stores commitments only" and "the original signed bytes are recoverable for re-verification." Without this, a verifier replaying signatures has no source for the canonical record bytes other than transient memory inside the wrapper.

**Where it falls short.** The mirror is operator-local. Multiple agents running on different machines with the same creator key produce divergent mirrors that don't reconcile automatically. Cross-host reconciliation is a V2 concern.

### 7.4 Composing the patterns

A complete harness integration usually combines all three: the wrapper persists records to a mirror as it signs them (7.3); a session-start hook reads the mirror to surface a shape-only summary (7.1); a tool wired into the agent surface returns content from the mirror on demand (7.2). The recall tool can also verify signatures locally before returning, so the agent's read of its own past is independently re-verifiable, not "trust the mirror."

The reference implementation atrib ships under this pattern is `@atrib/recall` (a single-tool MCP server consuming the mirror). It is one shape among many; harness builders are encouraged to adapt rather than copy.

### 7.5 Harness-side reasoning chains

Agents reason between actions. atrib does not standardize what reasoning *is*: reasoning shapes vary too much across harnesses (ReAct, chain-of-thought, scratchpad, multi-agent debate, plan-and-execute) for any single shape to be observably canonical. Harnesses that want to capture deliberation as part of the verifiable record do so via extension URIs in their own namespace, linked to surrounding actions via the `informed_by` field defined in §1.2.5.

**The pattern.**

The harness mints an extension URI in a namespace it controls (e.g., `https://example.com/v1/types/reasoning_step`). Between tool_call records, the harness emits records carrying that URI with the agent's reasoning content (or a hash/commitment of it, depending on privacy posture). When the agent emits a subsequent tool_call, the harness includes the reasoning record's hash in the tool_call's `informed_by` field.

A verifier reading the chain sees the reasoning records inline (D043: extension URIs participate in CHAIN_PRECEDES), the explicit linkage from tool_calls to reasoning records (D041: INFORMED_BY edges), and the temporal ordering. The verifier can independently audit the agent's claimed reasoning chain.

**Worked example.**

```
R1 (tool_call):     {tool_name: "read_email", args_hash: "...", ...}
R2 (extension):     {event_type: "https://example.com/v1/types/reasoning_step",
                     content_hash: H_reasoning_2, ...}
R3 (extension):     {event_type: "https://example.com/v1/types/reasoning_step",
                     content_hash: H_reasoning_3,
                     informed_by: ["sha256:" + hex(record_hash(R1)),
                                   "sha256:" + hex(record_hash(R2))], ...}
R4 (tool_call):     {tool_name: "send_reply",
                     informed_by: ["sha256:" + hex(record_hash(R1)),
                                   "sha256:" + hex(record_hash(R3))], ...}
```

The verifier can prove: "agent read an email (R1), reasoned in two steps (R2, R3), then replied based on the email content and the second reasoning step." The chain is structurally complete; the agent's own claims are explicit.

**Trust boundary statement.**

Reasoning records live OUTSIDE atrib's normative trust boundary. They prove the harness emitted these bytes signed under the creator_key. They do NOT prove the LLM actually reasoned this way. An adversary controlling the harness could emit any reasoning record they wanted to commit to. The cryptographic anchor is on the harness's claim, not the LLM's deliberation.

This trust posture is the right one for the substrate: atrib is the protocol that proves what was signed, not what was thought. Consumers wanting verifiable LLM reasoning need a different layer (model-side attestation, hardware-rooted execution, etc.) outside this spec's scope.

### 7.6 Outcome verification patterns

A `tool_call` record commits to `args_hash` (the agent's claim about what was sent) and `result_hash` (the agent's claim about what came back). The chain proves the agent emitted these claims; it does NOT prove the tool actually returned what `result_hash` says. Two patterns close this gap when needed; both are opt-in and informative.

**Pattern A: tool-side response signing.**

Tools that want their responses to be verifiable sign the response. Specifically: the tool returns its content along with a signature over a canonical serialization, using a key the verifier can resolve (via DNS, the §6 directory, or a tool-specific PKI). The agent sets `result_hash` to the SHA-256 of the tool's signed response (or to the signature itself, depending on commitment scheme).

A verifier with access to the tool's pubkey fetches the signed response (when available out-of-band) and confirms the agent's `result_hash` commitment matches what the tool actually signed. The trust now flows from the tool, not the agent.

This pattern requires tool cooperation. It does not change atrib's spec; the `result_hash` field already accommodates any 32-byte commitment. Tools that adopt this pattern publish their pubkey discovery method out-of-band.

**Pattern B: external witness records.**

For high-stakes outcomes (transactions especially), a downstream observation record carries an external proof: a chain transaction ID, an exchange settlement ID, an HTTPS Signed Exchange, etc. The verifier follows the external proof out-of-band and cross-checks against the agent's claimed outcome.

Example: an x402 payment tool_call is followed by an observation record committing to the on-chain transaction hash. The verifier can independently query the chain for the transaction and confirm it matches.

This pattern uses existing primitives (observation records per D042 + chain ordering) and requires no spec changes.

**What both patterns share.**

The verifier's trust shifts from "agent says the tool returned X" to "the tool itself attests it returned X" (Pattern A) or "the world independently confirms the outcome occurred" (Pattern B). Neither is normative; both are documented patterns consumers adopt as their threat model requires.

### 7.7 What the patterns DO NOT do

**They do not validate log inclusion.** Local signature verification proves "this record was signed by that creator_key." It does not prove "this record was committed to log.atrib.dev." A harness that needs the inclusion guarantee fetches an inclusion proof from the log per §2.

**They do not enforce identity claims.** A harness can resolve `creator_key` to an identity claim via the directory (§6) but does not enforce trust in any particular claim. Trust policy is consumer-side.

**They do not prescribe agent behavior.** atrib makes the past provable. What the agent does with that past, whether it reasons more carefully, defers to its prior commitments, or recommends past actions to itself, is agent-level concern, not substrate-level concern.

---

## §8 Privacy Postures

_This section is normative._

atrib's substrate is public by design. Disclosure within that substrate is configurable: harnesses choose how much each record reveals about the underlying action, on a per-field basis. The choice is encoded in each record's structural shape, so verifiers detect the posture from record bytes without out-of-band metadata.

This section defines four normative postures. Each may be combined with the others freely; combinations compose without interaction.

### 8.1 Default posture

The default behavior preserved from v1: plain SHA-256 hashes for `args_hash` and `result_hash`, millisecond timestamps, verbatim `tool_name` strings. Maximum auditability. Records that do not opt into other postures are assumed to use the default.

### 8.2 Opaque-name posture

`tool_name` MAY be one of:

- **Verbatim** (default): a human-readable string identifying the tool (e.g., `book_flight`, `transfer_usdc`). Maximum disclosure of intent.
- **Opaque label**: a string matching `[a-z0-9_-]{1,64}` with no required mapping to a real tool name (e.g., `tool_a7f3`, `op_42`). Hides what the tool does without breaking record format.
- **Hashed**: a string matching `sha256:<64 lowercase hex>` representing the SHA-256 of the verbatim name. Verifiers configured with a name-mapping can resolve; others see only the hash.

Verifiers indicate the detected form: `tool_name_form: "verbatim" | "opaque" | "hashed"`. Detection is structural (form pattern matching against the value).

### 8.3 Salted-commitment posture

`args_hash` and `result_hash` MAY use salted commitments. Two schemes are defined; they have meaningfully different privacy properties and consumers MUST pick the one that matches their threat model.

**`salted-sha256`:** `H = SHA-256(salt ‖ canonical_bytes)` where `salt` is a per-record random value of at least 16 bytes. The salt is revealed in a sibling field (`args_salt`, `result_salt`) so any verifier with the canonical bytes can re-compute and confirm the commitment.

**What this scheme defeats:** pre-computed rainbow-table attacks (an attacker cannot pre-build a table for all possible inputs because the salt is per-record).

**What this scheme does NOT defeat:** pre-image enumeration once the record is observed. The salt is in the record; an attacker who suspects the args fall into a small space (e.g., `flight_id ∈ [1..99999]`) computes `H(salt ‖ guess)` for each candidate and matches against the commitment. The protection is against pre-computation, not against targeted enumeration after the record is published.

**`hmac-sha256`:** `H = HMAC(key, canonical_bytes)` where `key` is private to the issuer and is NOT included in the record. The verifier cannot re-compute without the key; the issuer reveals selectively (e.g., to specific auditors via an authenticated out-of-band channel).

**What this scheme defeats:** both pre-computed and targeted enumeration. An attacker without the key cannot test candidate inputs; the HMAC is a pseudo-random function from the attacker's perspective.

**What this scheme does NOT defeat:** verifiability without key sharing. Verifiers who do not have the key can only confirm the record's structure and signature, not the content commitment. Trust in the content claim is gated on the issuer's selective disclosure to specific verifiers.

**Picking the scheme.** Use `salted-sha256` when verifiability without key sharing matters and the input space is high-entropy enough that targeted enumeration is infeasible (e.g., text content, large structured payloads). Use `hmac-sha256` when the input space is low-entropy and content privacy from non-key-holders matters more than universal verifiability (e.g., enumerable identifiers, small structured args).

Verifiers detect the scheme from record shape: presence of `args_salt` indicates `salted-sha256`; absence of both salt and verifiable plain hash indicates `hmac-sha256`. Verifiers indicate `args_commitment_form: "plain-sha256" | "salted-sha256" | "hmac-sha256"`.

### 8.4 Coarsened-timing posture

The `timestamp` field MAY be rounded to one of five granularities:

| Granularity | Multiple of (ms) | Example |
| --- | --- | --- |
| millisecond (default) | 1 | `1743850123456` |
| second | 1000 | `1743850123000` |
| minute | 60000 | `1743850080000` |
| hour | 3600000 | `1743847200000` |
| day | 86400000 | `1743811200000` |

Granularity MUST be declared explicitly via the `timestamp_granularity` field, NOT inferred from trailing-zero patterns. A millisecond-precise timestamp that happens to land on a second boundary (e.g., `1743850000000`) is structurally indistinguishable from a second-rounded one; an explicit field removes the ambiguity. The field is OPTIONAL and defaults to `"ms"` when absent (preserving backwards compatibility with default-posture records).

```
"timestamp":             1743850080000,
"timestamp_granularity": "min"
```

Allowed values: `"ms" | "s" | "min" | "h" | "d"`. Verifiers MUST reject records where the declared granularity does not match the value's trailing-zero pattern (e.g., `timestamp_granularity: "min"` requires `timestamp % 60000 == 0`).

Coarsening trades auditability for reduced operational fingerprinting. Day-granularity timestamps prevent reconstruction of working hours, reaction times, and batch patterns; millisecond timestamps preserve full forensic precision.

The `timestamp_granularity` field slots immediately after `timestamp` lexicographically (`timestamp` is a prefix of `timestamp_granularity`, so the shorter string sorts first per JCS / RFC 8785 ordering). Presence/absence affects the JCS canonical form and therefore the signature.

### 8.5 Combined postures

The postures compose without interaction:

| tool_name | args_hash | timestamp | Disclosure |
| --- | --- | --- | --- |
| verbatim | plain-sha256 | ms | Default; maximum auditability. Full forensic trail. |
| opaque | salted-sha256 | min | Action kind hidden, args content protected from pre-image enum, working-hour pattern blurred. |
| hashed | hmac-sha256 | day | Action visible only to verifiers with name-mapping, args fully protected from non-key-holders, only date-level timing observable. |

A consumer chooses the combination that matches their threat model. atrib does not prescribe any particular combination; the postures are independent dials.

### 8.6 Threat model

_This subsection is informative._ The standalone-posture descriptions (§8.1-§8.5) are normative; the combined-posture outcomes below are reasoned consequences of composing the standalone postures. They are listed as illustrative threat-modeling guidance, not as additional normative claims that implementations must independently validate.

This subsection enumerates what an adversary observing the public log learns under each posture combination.

**Default posture (verbatim + plain-sha256 + ms):**
- The adversary learns: the agent's identity (creator_key), the kind of every action (`tool_name`), structural relationships (chain, session, cross-session, informed_by, provenance), exact timing of every action, and (via pre-image attacks on low-entropy args) the actual args of any low-entropy tool call.
- The adversary does NOT learn: high-entropy args content, response content, reasoning content (unless committed via extension URIs).

**Opaque + salted + minute posture:**
- The adversary learns: the agent's identity, structural relationships, minute-resolution timing, and that some action of opaque kind happened.
- The adversary does NOT learn: what kind of action (opaque label hides), args content (salt prevents pre-image attacks), response content, exact second of action, reasoning content.

**Hashed + hmac + day posture:**
- The adversary learns: the agent's identity, structural relationships, day-resolution timing, and that some action commitment happened.
- The adversary does NOT learn: anything about action kind (hash unresolvable without mapping), args (HMAC unverifiable without key), response (same), exact intra-day timing, reasoning.

In all postures the agent's identity (`creator_key`) and the structural graph remain observable. Identity privacy requires a different mechanism (D033 key rotation, deferred D038 per-conversation key derivation). Structural privacy requires a different layer (anonymous credentials, mix nets) outside this spec.

### 8.7 Adversarial threat model

_This section is normative._

§8.1 through §8.6 specify privacy postures: how a record's structural shape configures disclosure to a passive observer of the public log. This subsection covers a different threat model: an active adversary who can produce or influence atrib records. Examples include an attacker who compromises a creator_key and signs malicious records, an agent operator who knowingly signs false claims about tool calls or transactions, a tool operator who returns falsified responses, and a log operator who attempts to censor or equivocate. The substrate's response to these threats is shaped by what cryptographic signatures fundamentally CAN and CANNOT prove.

#### 8.7.1 The fundamental limit

A signature proves "the holder of this key signed these bytes." It cannot prove the bytes are true. This is a property of cryptographic signatures, not a limitation specific to atrib. Certificate Transparency has the same property: CT proves a certificate was issued and committed to the log; it does not prove the certificate's claims are accurate or that the issuing CA was uncompromised. atrib inherits this trust model.

A poisoned atrib record (one carrying false claims, signed by a compromised key, or emitted by a malicious actor) verifies cryptographically the same as a legitimate one. Both have valid signatures, both chain correctly, both appear in the log. The substrate certifies what was signed, not whether the signed claim is true.

This limit is intrinsic to any signed-attestation system. A spec or product that claims to defeat it is overpromising.

#### 8.7.2 Layered trust assessment

Truth assessment is layered above the signature primitive. atrib provides several mechanisms that contribute to a verifier's confidence assessment of any individual record:

| Layer | Mechanism | What it adds | What it does NOT rule out |
|---|---|---|---|
| 1 | Signature + log inclusion (§1.4 + §2.7) | Forgery, alteration, deletion, equivocation about whether the record exists | Compromised key; signer knowingly false content; signer malicious |
| 2 | Identity attestation (§6) | Anonymous actors hiding behind opaque keys | Identities making false claims; identities whose operational security is compromised |
| 3 | Capability declarations (§6.7) | Out-of-scope claims by an otherwise-attested identity | Coordinated compromise of both the signing key AND the publication channel for identity claims |
| 4 | Key revocation (§1.9) | Silent compromise; verifier sees the revocation reason and tags subsequent records | Past records being false (only flagged retroactively as suspect, not invalidated) |
| 5 | Cross-attestation for transactions (§1.7.6) | Single-key compromise fabricating transactions | Collusion between agent and counterparty; both parties' keys compromised |
| 6 | Tool-side response signing (§7.6 Pattern A) | Agent fabricating tool results | Collusion between agent and tool operator; tool operator compromised |
| 7 | External evidence (§7.6 Pattern B) | Agent claiming outcomes that did not occur in the world | External system itself being compromised |
| 8 | Witnessing (§2.9) | Log operator equivocation at the checkpoint level; selective censorship of checkpoints | Compromise of individual signing keys; record-level censorship by the log operator |
| 9 | Cross-log replication (§2.11) | Single-log-operator censorship, equivocation, data loss; record-level discrepancies between logs | Collusion across all logs in the trusted set |
| 10 | Structural anomaly detection (consumer-side) | Implausible patterns: bursts, dangling references, contradictory claims, statistical oddities in hash distributions | Subtle attacks that evade pattern detection |

No single layer is dispositive. A verifier's confidence assessment combines them; the substrate provides the structure, the assessment is consumer-side policy.

#### 8.7.3 Asymmetric properties despite the limit

Even under the assumption that any individual record may be poisoned, the substrate provides properties that the status quo (no records at all) does not:

1. **Non-repudiation.** A poisoned record IS a signed claim. The signer cannot later deny making it. The asymmetry favors the auditor: poisoning produces permanent, publicly-visible evidence.
2. **Common evidence base.** Multiple parties (creator, merchant, regulator, downstream agents) see the same chain. Disputes happen on top of shared evidence rather than divergent private logs.
3. **Forensic depth.** When something goes wrong, `informed_by` and `chain_root` linkages let an investigator trace back through the chain to find what record (legitimate or poisoned) was the source. Root-cause analysis becomes structural rather than heuristic.
4. **Reputation accumulation.** A creator_key with consistent honest behavior over time accrues trust. A key exhibiting poisoning patterns can be flagged. There is no accumulating reputation surface for agent identities outside the substrate today.
5. **Asymmetric attacker cost.** To poison records, an attacker must compromise a real signing key, and the resulting records are permanent and publicly visible. The cost-benefit shifts against the attacker compared to the unattested baseline.

#### 8.7.4 The honest framing

"Verifiable agent actions" is honest under this threat model because:

- The actions ARE verifiable: they happened, they are signed, they are logged, the signer cannot deny them.
- "Verifiable" means non-repudiable, inspectable, cross-checkable. It does NOT mean "true."
- A signed false claim remains verifiable as a claim; the verifier sees what was claimed and assesses it against the available trust layers.

What "verifiable agent actions" does NOT promise:

- That the agent is uncompromised (model alignment is a different layer; out of scope for an attestation protocol).
- That every action is intended by the user (intent verification is a different layer).
- That tools are honest (capability restriction is a different layer).
- That signed claims are true (truth assessment requires the layered stack above; the protocol provides the structure, not the assessment).

These honesty boundaries are what make the substrate trustworthy. Consumers know exactly what the substrate provides and what other layers their threat model requires.

#### 8.7.5 Future work: inclusion-proof aggregation

A complementary mechanism queued for follow-up (D053): records cite the inclusion proofs of prior records, creating a web of mutual confirmation. If a log operator later removes or alters a referenced record, citing records still point at proof of the prior state. This would defend at the record level, complementing §2.9 (checkpoint-level witnessing) and §2.11 (cross-log replication).

The mechanism is queued rather than specified because the design needs careful work on sequencing (chicken-and-egg with checkpoint witnessing), interaction with cross-log replication (which proofs to cite), storage growth (every record gains another reference list), and failure modes. D053 documents the intent and known design questions; the formal ADR will follow when the mechanism is added to the spec.

**Important:** D053 is a placeholder, not a normative commitment. The eventual specification of inclusion-proof aggregation MAY differ from D053's sketch in any technical detail. Cross-references to it MUST treat the substance as forward-looking.

---

## Appendix A: Test Vectors

The following test vectors are generated from the reference implementation. Two independent implementations that produce identical outputs for these inputs are interoperable.

All values are deterministic given the inputs. Ed25519 signing with a fixed seed produces a fixed signature.

This appendix is normative. A conforming implementation MUST produce outputs identical to these test vectors for the given inputs.

### A.1 Key Material

| Field | Value |
| --- | --- |
| Private key seed (hex) | `0101010101010101010101010101010101010101010101010101010101010101` |
| Public key (hex) | `8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c` |
| Public key (base64url) | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w` |

### A.2 Record Fields

| Field | Value |
| --- | --- |
| spec_version | `atrib/1.0` |
| event_type | `https://atrib.dev/v1/types/tool_call` |
| timestamp | `1700000000000` |
| context_id | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| creator_key | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w` |
| content_id | `sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e` |
| chain_root (genesis) | `sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547` |

### A.3 Canonical Signing Input (§1.3)

The signing input is `JCS(record without signature)`:

```
{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547","content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e","context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","event_type":"https://atrib.dev/v1/types/tool_call","spec_version":"atrib/1.0","timestamp":1700000000000}
```

SHA-256 of signing input (hex): `e2ad8c62656a32b381c9b4c6b55fb13529e8843ffcdd0f03a80bb1afb87a9676`

### A.4 Signature (§1.4)

| Field | Value |
| --- | --- |
| Signature (base64url) | `ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg` |
| Signature (hex) | `64c8ed19a505c69dcde19036570d3934183c2a2ca639d3512f7b9107f409fb330aecc54e041aad380d712e8f8332678b65f8d68df045c2b1ed41e9a8c575cc06` |
| Verification passes | `true` |

### A.5 Canonical Record and Record Hash

The canonical record is `JCS(complete record with signature)`:

```
{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547","content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e","context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","event_type":"https://atrib.dev/v1/types/tool_call","signature":"ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg","spec_version":"atrib/1.0","timestamp":1700000000000}
```

| Field | Value |
| --- | --- |
| Record hash (hex) | `ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c1` |
| Record hash (base64url) | `6m-0E8Ukq1dnUgUW_7iuOKdDkfeJIXfgI29fLeUjucE` |

### A.6 Propagation Token (§1.5.2)

| Field | Value |
| --- | --- |
| Token | `6m-0E8Ukq1dnUgUW_7iuOKdDkfeJIXfgI29fLeUjucE.iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w` |
| Format | `base64url(record_hash) + "." + base64url(creator_key)` |

### A.7 Chain Root for Next Record

| Field | Value |
| --- | --- |
| chain_root | `sha256:ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c1` |
| Format | `"sha256:" + hex(record_hash)` |
| Matches record_hash from A.5 | `true` |

### A.8 Log Entry Serialization (§2.3.1)

| Field | Value |
| --- | --- |
| Entry (hex, 90 bytes) | `01ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c18a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000018bcfe5680001` |
| Entry length | `90` |

Byte layout:
- Byte 0: version (`0x01`)
- Bytes 1-32: record_hash (32 bytes)
- Bytes 33-64: creator_key (32 bytes)
- Bytes 65-80: context_id (16 bytes)
- Bytes 81-88: timestamp_ms (uint64 big-endian)
- Byte 89: event_type (`0x01` = `https://atrib.dev/v1/types/tool_call`)

### A.9 Merkle Tree (§2.3.2, §2.7)

**Single-entry tree (tree_size = 1):**

| Field | Value |
| --- | --- |
| Leaf hash | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Leaf hash (base64) | `QkwgK0bCRoqaYpWMhBw4iEtTRUNBzQwyYpbdLNwxA38=` |
| Root (= leaf hash for size 1) | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Inclusion proof | `[]` (empty for single-entry tree) |
| Verification passes | `true` |

**Two-entry tree (tree_size = 2):**

| Field | Value |
| --- | --- |
| Leaf 0 hash | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Leaf 1 hash | `5133c40d0435ff1b7db13abebf7a417c03dbe86309ca8ed9121e04cf1d728866` |
| Root | `bfec13ffa5af1f27d9c878c6557aaf480686a34789b2c8b8630ce0c644817398` |
| Inclusion proof for index 0 | `["UTPEDQQ1/xt9sTq+v3pBfAPb6GMJyo7ZEh4Ezx1yiGY="]` |
| Inclusion proof for index 1 | `["QkwgK0bCRoqaYpWMhBw4iEtTRUNBzQwyYpbdLNwxA38="]` |

Leaf hash computation: `SHA-256(0x00 || entry_bytes)`
Internal node hash: `SHA-256(0x01 || left || right)`
Root of 2-entry tree: `SHA-256(0x01 || leaf_hash_0 || leaf_hash_1)`

### A.10 Vector Cases for Optional Fields and Postures

The vectors in §A.1 through §A.9 cover the minimal record shape (default posture, no optional fields). The conformance corpus at [`spec/conformance/1.4/`](spec/conformance/1.4/) extends these with byte-level vectors covering each optional field and posture combination introduced in [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section), [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), and [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records). Implementations MUST produce outputs identical to the corpus vectors for the inputs the corpus specifies.

The corpus enumerates (each as a separate vector with full input → canonical bytes → record_hash → signature output):

1. **informed_by single-entry**: record carries `informed_by: ["sha256:<hash>"]` (one referent). Validates JCS placement of the field (between `event_type` and `provenance_token`, lex-sorted).
2. **informed_by multi-entry sorted**: record carries `informed_by: [hash_a, hash_b, hash_c]` where the entries are pre-sorted lex. Validates that the canonical form is stable.
3. **informed_by ordering rejection**: record submitted with unsorted `informed_by` MUST be rejected by validators per [§1.2.5](#125-informed_by) ordering requirement.
4. **provenance_token on genesis**: genesis record (chain_root = SHA-256(context_id)) carries `provenance_token` with derivation `base64url(SHA-256(JCS(upstream_record))[:16])`. Validates derivation correctness.
5. **provenance_token rejection on non-genesis**: non-genesis record carrying `provenance_token` MUST be rejected by validators AND verifiers per [§1.2.6](#126-provenance_token).
6. **timestamp_granularity declared**: record carries `timestamp: 1743850080000, timestamp_granularity: "min"`. Validates trailing-zero match enforcement.
7. **timestamp_granularity mismatch rejection**: record carries `timestamp: 1743850123456, timestamp_granularity: "min"` (mismatch). MUST be rejected by verifiers.
8. **salted-sha256 args/result**: record carries `args_salt`, `result_salt`, with `args_hash = SHA-256(salt || canonical_args_bytes)`. Validates posture detection from sibling-field presence.
9. **opaque tool_name**: record carries `tool_name: "tool_a7f3"` (matches `[a-z0-9_-]{1,64}` opaque-form pattern). Validates posture detection.
10. **hashed tool_name**: record carries `tool_name: "sha256:<hex>"`. Validates posture detection.
11. **transaction with 2-signer signers**: transaction record carries `signers: [{creator_key_A, sig_A}, {creator_key_B, sig_B}]` where both signatures cover canonical bytes with `signers: []` and top-level `signature` omitted. Validates per-signer verification and the canonical-input rule from [§1.7.6](#176-cross-attestation-requirement-for-transaction-records).
12. **transaction with single-signer rejection**: transaction record with only 1 signer flagged as `cross_attestation_missing: true`.
13. **combined posture**: record carries opaque tool_name + salted commitments + minute timestamp + informed_by. Validates that postures compose without interaction.
14. **multi-log proof bundle**: record bundle carries proofs from 2 logs in `log_proofs` array per [§2.11.3](#2113-proof-bundle-format-extension). Validates verifier-side threshold and equivocation detection.
15. **PROVENANCE_OF derivation**: pair of records where downstream's `provenance_token` derives from upstream's hash; derivation produces correct PROVENANCE_OF graph edge per [§3.2.4](#324-edge-derivation-rules) step 7.

The corpus is generated from the reference implementation; a conforming implementation produces identical bytes for the inputs in `inputs.json` of each vector directory. The Appendix A vectors above and the corpus vectors are jointly normative.

---

## References

### Normative References

- **[RFC 2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC 8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC 8785]** Rundgren, A., Jordan, B., Erdtman, S., "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. https://www.rfc-editor.org/rfc/rfc8785
- **[RFC 8032]** Josefsson, S., Liusvaara, I., "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[RFC 4648]** Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006. https://www.rfc-editor.org/rfc/rfc4648
- **[RFC 9162]** Laurie, B., Messeri, E., Stradling, R., "Certificate Transparency Version 2.0", RFC 9162, December 2021. https://www.rfc-editor.org/rfc/rfc9162
- **[RFC 9457]** Nottingham, M., Wilde, E., Dalal, S., "Problem Details for HTTP APIs", RFC 9457, July 2023. https://www.rfc-editor.org/rfc/rfc9457
- **[W3C Trace Context]** W3C, "Trace Context Level 1", W3C Recommendation, February 2020. https://www.w3.org/TR/trace-context-1/
- **[W3C Baggage]** W3C, "Baggage", W3C Candidate Recommendation, November 2023. https://www.w3.org/TR/baggage/
- **[C2SP tlog-tiles]** C2SP, "Tiled Transparency Logs", c2sp.org/tlog-tiles
- **[C2SP signed-note]** C2SP, "Signed Note", c2sp.org/signed-note

### Informative References

- **[ACP]** Agentic Commerce Protocol, https://github.com/agentic-commerce-protocol/agentic-commerce-protocol (verified 2026-04-06)
- **[UCP]** Universal Commerce Protocol, version 2026-01-11, https://github.com/universal-commerce-protocol/ucp
- **[x402]** x402 HTTP Payment Protocol, https://x402.org (v2, April 2026)
- **[MPP]** Machine Payments Protocol, IETF draft-ryan-httpauth-payment-01, March 2026, https://mpp.dev
- **[AP2]** Agent Payments Protocol v0.1, https://github.com/google-agentic-commerce/ap2
- **[a2a-x402]** A2A Payment Extension v0.1, https://github.com/google-agentic-commerce/a2a-x402
- **[MCP]** Model Context Protocol Specification, version 2025-11-25, https://modelcontextprotocol.io/specification/2025-11-25/
- **[Tessera]** Transparency-dev Tessera, https://github.com/transparency-dev/tessera
