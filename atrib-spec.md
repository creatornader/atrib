# atrib

**Version 0.1, April 2026**

Editor: Nader Helmy

This specification defines the atrib protocol for verifiable agent actions. When an AI agent calls a tool, atrib creates a signed record at the moment of action, chains it forward into the next call, and commits it to an append-only Merkle log. Any party can independently verify what an agent did, in what order, with what signed structure and declared relationships. When tool calls converge on a transaction, a deterministic algorithm computes a value distribution from the resulting graph under an agreed policy, producing a settlement document anyone can recompute. The spec covers the record format ([§1](#1-attribution-record-format)) including key rotation ([§1.9](#19-key-rotation-and-revocation)) and URI-typed event vocabulary ([§1.2.4](#124-event_type-values), [§1.4.5](#145-event_type-uri-validation)), the log protocol ([§2](#2-merkle-log-protocol)), the graph model ([§3](#3-graph-query-interface)), policies and the distribution algorithm ([§4](#4-attribution-policy-format)), the SDK middleware contracts ([§5](#5-sdk-specification)), the public-key directory ([§6](#6-key-directory)), informative integration patterns for agent harnesses ([§7](#7-harness-integration-patterns)), privacy postures ([§8](#8-privacy-postures)), and informative runtime integration patterns ([§9](#9-runtime-integration-patterns)).

---

## Table of Contents

- [§0 Foundations](#0-foundations)
- [§1 Attribution Record Format](#1-attribution-record-format) (incl. [§1.9](#19-key-rotation-and-revocation) Key Rotation and Revocation)
- [§2 Merkle Log Protocol](#2-merkle-log-protocol)
- [§3 Graph Query Interface](#3-graph-query-interface)
- [§4 Attribution Policy Format](#4-attribution-policy-format) (policy layer relocated to the [payments profile](docs/payments-profile.md); position statement and stable anchors remain)
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
  - [IV. Verifiable investigations and repair](#iv-verifiable-investigations-and-repair)
  - [V. Settlement, attribution, and the post-advertising web](#v-settlement-attribution-and-the-post-advertising-web)

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

atrib is the substrate that makes agent actions verifiable. Every action becomes signed context for the next, anchored in a Merkle log, independently verifiable by anyone. Not an identity layer. Not a payment layer. Not a content attribution system. The thing that sits underneath all of those: **a substrate where agents reason from a past they can prove, and downstream consumers (merchants, auditors, other agents) verify that past without trusting any operator.**

The central claim is this: it is possible to make the structural relationships of agent activity transparent (what tool calls preceded what outcomes, how contributions linked together within a session, what the observable shape of an agent's reasoning trail actually was) without making the content of those interactions visible to anyone who should not see it. Several distinct uses follow from this substrate: provable recall by the agent itself, independent audit by third parties, settlement when commerce closes a chain, and verifiable continuity across handoffs between agents.

This is observability without surveillance. The system becomes legible to itself (to its participants, to the parties with a legitimate stake in its outcomes) without becoming legible to surveillance. Accountability without inspection. Transparency without exposure.

This distinction matters because every prior attempt at provenance has collapsed it. C2PA proves a certificate exists but cannot say what it caused. ProRata tracks content usage but keeps advertising as the economic model. Blockchain provenance systems make everything visible to everyone, which is privacy-hostile by design. OpenTelemetry makes systems observable to their operators but invisible to participants.

atrib is built on a different principle: **you can record what happened and who was present without claiming to know what caused what, and you can distribute credit fairly without trusting any single intermediary to arbitrate it.** The structure of contributions is a verifiable fact. What those contributions are worth is a policy judgment. atrib provides the former without pretending to settle the latter.

### What atrib certifies, what it does not

atrib certifies five structural axes of agent activity: who acted (identity, via signature), what they did (event_type), when (timestamp), in what order (chain_root and the ordering edges of [§3](#3-graph-query-interface)), and what the agent claims informed each action (the `informed_by` and `provenance_token` fields, surfaced as INFORMED_BY and PROVENANCE_OF edges in [§3](#3-graph-query-interface)).

atrib does NOT certify that the agent's reasoning is truthful, that prior records actually influenced subsequent decisions, or that tool responses were real absent tool-side attestation. A signature proves who committed to a claim, never that the claim is true. The first two limits are intrinsic to signed claims. The third narrows when another party signs its own evidence: the tool signs its response, a counterparty co-signs a transaction, an evaluator signs a diagnostic, or a witness attests the outcome. Those signatures corroborate the action, not the agent's reasoning. The substrate is content-preserving (commitments, not content) and disclosure-configurable (the privacy postures of [§8](#8-privacy-postures) let the harness pick how much each record reveals).

This positioning keeps the claim honest. Brand promises that exceed what the substrate certifies create the same trust mismatch atrib was built to fix. [§3](#3-graph-query-interface) "What atrib chains, what it does not" gives the detailed structural-axis enumeration; [§7.6](#76-outcome-verification-patterns) documents the outcome-verification patterns that close the tool-response gap when consumers need it.

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

The five uses below are ordered by how directly each relies on the substrate's core property: an agent's actions are signed at the moment they happen and remain independently verifiable thereafter.

### I. Provable cognition (recall)

An agent that can verify its own past has a kind of memory the agent ecosystem has not previously had. Every prior tool call is a signed claim the agent itself can re-verify locally; every chain is a structured artifact the agent can reason from; every transaction it participated in is anchored in a public log it cannot be gaslit about. This is the loop the locked positioning points at: _agents that reason from a past they can prove._

The cognitive consequence is concrete. An agent restoring context from its own atrib records (rather than from platform-controlled memory) cannot be quietly amended. It cannot have actions silently retroactively added or removed. It cannot inherit a falsified history if its harness is replaced. The substrate is the only mechanism by which an agent's continuity of self survives platform changes, model changes, or harness changes, because the cryptography is independent of all of them.

This is the use case the protocol's recall pattern ([§7](#7-harness-integration-patterns)) tests in practice: real agents (Claude Code, Cursor, custom harnesses) consuming the substrate they themselves produce. If the substrate works, the agent is more capable. If the substrate is broken, the agent is no worse off than today.

### II. Independent audit and compliance

Once an agent's actions are signed and committed to a public log, third parties can audit them without trusting the agent or the platform. A user can prove what an agent did on their behalf. A regulator can query "what did this agent do at time T?" and get a cryptographic answer. A merchant disputing a transaction can verify the chain that led to it. None of this requires the agent operator to cooperate, share data, or even be online.

This is the property that compliance-coded products (audit trail, SOC 2 reporting, AI governance tooling) approximate without the underlying substrate. The substrate does it correctly: not by collecting more data centrally but by making the data anyone already had cryptographically verifiable.

### III. Cross-agent provenance and handoffs

Agents that hand off work to other agents (a delegation flow, a multi-agent system, a marketplace of specialized agents) face the same provenance problem at higher complexity. A signed action by agent A passing context to agent B carries verifiable continuity across the handoff: B can prove A actually requested this, A can prove B actually completed it, and any later observer can reconstruct the path.

Without the substrate, multi-agent flows reduce to "trust whoever is closest to the platform." With it, the signed record graph becomes the shared evidence base.

### IV. Verifiable investigations and repair

Support, incident, billing, and RCA workflows expose another use of the same substrate. An investigation is not a single answer; it is a sequence of ticket reads, tenant-scoped log queries, code-path checks, hypotheses, diagnostics, revisions, and handoffs. Each step needs to be inspected later without pretending the public log can carry the private ticket or log body.

atrib makes that trail verifiable without replacing observability systems. The log store keeps operational evidence. The support system keeps customer context. The local mirror or archive keeps record bodies under the chosen privacy posture. atrib proves how the agent moved through those systems, which prior evidence it claimed informed each step, and where the next harness should resume.

This is the support/RCA form of repair: a future agent can trace a bad hypothesis, read the signed diagnostic that corrected it, and continue from the latest chain tail instead of replaying the whole investigation from memory or platform chat history.

### V. Settlement, attribution, and the post-advertising web

The substrate produces a useful side effect: when commerce closes a chain (an agent purchases something, a tool is invoked in service of a transaction), the same signed record set is what a settlement document is computed from. The [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) algorithm runs deterministically over the graph and produces a value distribution any merchant or auditor can recompute. This is the attribution-economy use case, and it is genuinely real, but it is one consequence of the substrate, not the reason for it.

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
  - [1.4.6 Signing key isolation for sandboxed execution](#146-signing-key-isolation-for-sandboxed-execution)
- [1.5 Context Propagation](#15-context-propagation)
  - [1.5.1 context_id: the session anchor](#151-context_id-the-session-anchor)
  - [1.5.2 HTTP transport: tracestate](#152-http-transport-tracestate)
  - [1.5.3 HTTP fallback: X-atrib-Chain](#153-http-fallback-x-atrib-chain)
    - [1.5.3.1 Context ID Header: X-atrib-Context](#1531-context-id-header-x-atrib-context)
  - [1.5.4 MCP transport: params.\_meta](#154-mcp-transport-params_meta)
    - [1.5.4.1 Negotiated Extension Carriage: dev.atrib/attribution](#1541-negotiated-extension-carriage-devatribattribution)
  - [1.5.5 Cross-trace session continuity](#155-cross-trace-session-continuity)
- [1.6 Unsigned Hops and Gap Nodes](#16-unsigned-hops-and-gap-nodes)
- [1.7 Transaction Event Hooks](#17-transaction-event-hooks) (per-rail hooks moved to the [payments profile](docs/payments-profile.md#2-transaction-detection-hooks))
  - [1.7.1 ACP](#171-acp-agentic-commerce-protocol)
  - [1.7.2 UCP](#172-ucp-universal-commerce-protocol)
  - [1.7.3 x402](#173-x402)
  - [1.7.4 MPP](#174-mpp-machine-payments-protocol)
  - [1.7.5 AP2 / a2a-x402](#175-ap2-and-a2a-x402)
- [1.8 Scope Boundaries](#18-scope-boundaries)
- [Interoperability Roadmap](#interoperability-roadmap)

### 1.1 Normative Requirements Language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119 and RFC 8174.

#### 1.1.1 Conformance Targets

This specification defines requirements for four conformance targets:

- **MCP server middleware**: satisfies all MUST requirements in [§1.2](#12-the-attribution-record)-[§1.5](#15-context-propagation), [§2.3](#23-log-entry-format), [§2.6](#26-submission-api-write-interface), and [§5.3](#53-atribmcp-mcp-server-middleware).
- **Agent middleware**: satisfies all MUST requirements in [§1.5](#15-context-propagation), [§1.7](#17-transaction-event-hooks), [payments profile §7](docs/payments-profile.md#7-session-negotiation), and [§5.4](#54-atribagent-agent-middleware).
- **Log operator**: satisfies all MUST requirements in [§2](#2-merkle-log-protocol).
- **Verification library**: satisfies all MUST requirements in [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm), [payments profile §9](docs/payments-profile.md#9-settlement-recommendation-document), and [§5.5](#55-atribverify-merchant-verification-library).

A graph query service, when implemented, must satisfy all MUST requirements in [§3](#3-graph-query-interface). A witness, when implemented, must satisfy all MUST requirements in [§2.9](#29-witnessing-and-cosignatures).

All normative requirements in this section are prefixed with their requirement level. A conforming implementation satisfies all MUST requirements and is RECOMMENDED to satisfy all SHOULD requirements.

#### 1.1.2 Roles: validator vs verifier

This specification uses two role terms with distinct meanings:

- **Validator** (log-side admission): the log operator's submission pipeline that decides whether to accept an incoming record into the log. Validators apply [§2.6.1](#261-submit-entry) checks (record format, signature, chain integrity, scope constraints like the genesis-record-only rule for `provenance_token` per [§1.2.6](#126-provenance_token)). A validator's output is binary: admit or reject.
- **Verifier** (consumer-side audit): a downstream consumer that reads records and assesses trust. Verifiers apply [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation, [§6.7](#67-capability-declarations) capability checks, [§2.11](#211-cross-log-replication) cross-log threshold and equivocation detection, and the [§8.7](#87-adversarial-threat-model) trust assessment stack. A verifier's output is rich (validity flags, signals, annotations); the verifier never modifies records.

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
  "tool_name":             "",               // OPTIONAL (see §8.2); discloses the tool name; absent = §8.1 default posture
  "args_hash":             "sha256:",        // OPTIONAL (see §8.3); commitment to the canonical args bytes
  "args_salt":             "",               // OPTIONAL (see §8.3); reveals salt for salted-sha256 args_hash
  "result_hash":           "sha256:",        // OPTIONAL (see §8.3); commitment to the canonical result bytes
  "result_salt":           "",               // OPTIONAL (see §8.3); reveals salt for salted-sha256 result_hash
  "session_token":         "",               // OPTIONAL (see §1.5.5); omitted when not in a cross-trace session
  "checkpoint":            { },              // OPTIONAL (see §1.2.10); REQUIRED on session_checkpoint records, FORBIDDEN elsewhere
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

| Field                 | Type    | Req                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec_version          | string  | MUST                                              | Always the literal string `"atrib/1.0"` for records conforming to this specification. Implementations MUST reject records with unknown spec_version values rather than attempting to process them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| content_id            | string  | MUST                                              | A prefixed hex-encoded SHA-256 digest identifying the specific creator and tool that produced this record. See [§1.2.2](#122-content_id-derivation) for derivation. Format: `"sha256:"` followed by 64 lowercase hex characters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| creator_key           | string  | MUST                                              | The creator's Ed25519 public key, encoded as base64url (RFC 4648 §5, no padding). 43 characters. This is the stable identity of the creator across all their records — either a principal key (delegation depth 0) or a run key certified by a principal per [§1.11](#111-delegation-certificates), in which case the durable identity is the principal resolved through the [§1.11.4](#1114-verifier-walk) walk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| chain_root            | string  | MUST                                              | A prefixed hex-encoded SHA-256 digest anchoring this record in the chain. For non-genesis records: the hash of the parent attribution record's canonical serialization (see [§1.3](#13-canonical-serialization)). For genesis records: the hash of the context_id string. See [§1.2.3](#123-chain_root-for-genesis-records).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| event_type            | string  | MUST                                              | An absolute URI identifying the type of event this record documents. atrib's normative URI set is defined in [§1.2.4](#124-event_type-values); consumers MAY mint extension URIs in their own namespaces. URI form is validated per [§1.4.5](#145-event_type-uri-validation). atrib does not require URI recognition for verification; an unrecognized but syntactically-valid extension URI does not block signature verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| context_id            | string  | MUST                                              | The W3C Trace Context trace-id of the OTel trace containing this event. 32 lowercase hex characters. This is the join key that connects attribution records to each other and to transaction events. See [§1.5.1](#151-context_id-the-session-anchor).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| timestamp             | integer | MUST                                              | Unix time in milliseconds as a JSON integer. MUST NOT be a string, float, or ISO 8601 date. MUST NOT be in the future. Implementations SHOULD reject records with timestamps more than 5 minutes in the future relative to local clock. The value MAY be coarsened (rounded to second/minute/hour/day boundaries) per the [§8.4](#84-coarsened-timing-posture) timing posture; when coarsened, the granularity MUST be declared explicitly via the `timestamp_granularity` field.                                                                                                                                                                                                                                                                                                                                                                                                   |
| informed_by           | array   | MAY                                               | Array of `"sha256:" + hex(record_hash)` strings identifying records the agent claims informed this action. Hashes MUST be sorted lexicographically by the hex string (deterministic ordering). Empty or absent when the record makes no provenance claim. The graph layer derives INFORMED_BY edges from this field ([§3.2.3](#323-edge-types)). atrib does not validate truthfulness of the claim. See [§1.2.5](#125-informed_by) and [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type).                                                                                                                                                                                                                                                                                                                                                           |
| provenance_token      | string  | MAY                                               | Base64url-encoded 16-byte opaque token for cross-session causal anchoring. Distinct from session_token: provenance_token says "this session descends from that anchor" (causal); session_token says "this is the same logical session" (continuation). Carried ONLY by the genesis record of a session that claims an upstream anchor; non-genesis records MUST NOT carry it. Derived as the first 16 bytes of the upstream record's hash; upstream records carry no special field to be anchorable. The graph layer derives PROVENANCE_OF edges from this field ([§3.2.3](#323-edge-types)). See [§1.2.6](#126-provenance_token) and [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring).                                                                                                                                                          |
| delegation_cert_hash  | string  | MAY | `"sha256:" + 64 lowercase hex` commitment to a delegation certificate per [§1.11.3](#1113-the-delegation_cert_hash-field). Permitted ONLY on session genesis records (committing the signer's run key to its certificate) and on `key_revocation` records ([§1.11.5](#1115-run-key-revocation)). JCS-canonical form sorts the field between `creator_key` (`c-r`) and `event_type` (`e`). See [D140](DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys). |
| session_token         | string  | MAY                                               | Base64url-encoded 16-byte opaque token identifying the logical session across OTel trace boundaries. Present only when the record was emitted in a cross-trace session. When present, the graph query layer uses this field to construct CROSS_SESSION edges between records with different context_ids that share the same session_token. See [§1.5.5](#155-cross-trace-session-continuity). The session_token field is included in the canonical serialization and covered by the signature.                                                                                                                                                                                                                                                                                                                                                                                      |
| signature             | string  | MUST for non-transaction records                  | Ed25519 signature over the canonical serialization of the record with the signature field omitted, encoded as base64url (RFC 4648 §5, no padding). 86 characters. See [§1.4](#14-signing-and-verification) for the full signing procedure. Transaction records (`event_type = transaction`) carry the `signers` array per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) instead of (or in addition to) this top-level field.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| signers               | array   | MUST for transaction records, MUST NOT for others | Array of `{ creator_key, signature }` objects, one per cross-attestation party. Required on transaction records ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records)); MUST NOT appear on tool_call, observation, or extension records. Minimum 2 distinct verified signer keys (typically agent + counterparty). Duplicate entries from one key do not satisfy the minimum. All signers cover the same canonical bytes: the JCS serialization of the record with `signers: []` and `signature` omitted.                                                                                                                                                                                                                                                                                                                                                           |
| timestamp_granularity | string  | MAY                                               | Declares the coarsening granularity of `timestamp` per the [§8.4](#84-coarsened-timing-posture) timing posture. Allowed values: `"ms"` (default when absent), `"s"`, `"min"`, `"h"`, `"d"`. Verifiers MUST reject records where the declared granularity does not match the value's trailing-zero pattern (e.g., `timestamp_granularity: "min"` requires `timestamp % 60000 == 0`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| tool_name             | string  | MAY                                               | Discloses the verbatim or transformed tool name per the [§8.2](#82-opaque-name-posture) opaque-name posture. Absence indicates the [§8.1](#81-default-posture) default posture (no tool-name disclosure beyond what `content_id` derives from `serverUrl + toolName`). When present, value is one of: a verbatim string (e.g., `"book_flight"`), a transformed opaque label matching the [§8.2](#82-opaque-name-posture) form regex `[a-z0-9_-]{1,64}`, or `"sha256:" + 64 lowercase hex` for the hashed form. JCS-canonical form places the field last in the current record schema: `tool_name` (`t-o-...`) sorts after `timestamp_granularity` (`t-i-m-e-s-t-a-m-p-_-...`) and after `signature` / `spec_version` (`s-` sorts before `t-`). No subsequent field exists at the time of writing. See [D061](DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121). |
| args_hash             | string  | MAY                                               | Commitment to the canonical args bytes per the [§8.3](#83-salted-commitment-posture) salted-commitment posture. Format: `"sha256:" + 64 lowercase hex`. Absence indicates the [§8.1](#81-default-posture) default posture (no args commitment surfaced; verifiers cannot independently confirm what the agent claims to have sent). When present without `args_salt`, the commitment is `plain-sha256(canonical_args_bytes)`. When present with `args_salt`, the commitment is `salted-sha256(salt ‖ canonical_args_bytes)`. JCS-canonical form sorts the field between `annotates` (`a-n`) and `args_salt` (`a-r-g-s-_-s`) since `a-r-g-s-_-h` lies between them. See [D061](DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121).                                                                                                                                |
| args_salt             | string  | MAY                                               | Base64url-encoded random salt (≥16 bytes) revealing the salt used to compute a `salted-sha256` `args_hash` per [§8.3](#83-salted-commitment-posture). Presence indicates the salted-commitment posture for args; absence indicates the default plain-sha256 scheme (or the [§8.3](#83-salted-commitment-posture) hmac-sha256 variant which is signaled out-of-band and not structurally detectable).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| result_hash           | string  | MAY                                               | Commitment to the canonical result bytes per the [§8.3](#83-salted-commitment-posture) salted-commitment posture. Same shape and semantics as `args_hash` but for the tool's response. JCS-canonical form sorts the field between `provenance_token` (`p`) and `result_salt` (`r-e-s-u-l-t-_-s`) since `r-e-s-u-l-t-_-h` lies between them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| result_salt           | string  | MAY                                               | Base64url-encoded random salt (≥16 bytes) revealing the salt used to compute a `salted-sha256` `result_hash` per [§8.3](#83-salted-commitment-posture). Same posture-detection semantics as `args_salt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| checkpoint | object | MAY | Session checkpoint commitment per [§1.2.10](#1210-checkpoint). REQUIRED when event_type is the session_checkpoint URI; FORBIDDEN on any other event_type. Carries session_root / tree_size / first_index / prior_checkpoint / retroactive. JCS-canonical form sorts the field between chain_root ("c-h-a") and content_id ("c-o"). |

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

##### 1.2.3.1 Multi-producer chain composition

When more than one producer signs records under the same `creator_key` for the same `context_id` across process boundaries (e.g., the wrapper middleware in `@atrib/mcp` signing tool calls alongside the `attest` write verb, or its legacy `atrib-emit` alias, running as a cognitive-primitive subprocess in the same agent session), each producer MUST resolve `chain_root` for a new non-genesis record using the precedence ordering below. Honoring the ordering keeps records on the same context coherent under producer composition; deviating produces records that share `context_id` but split into multiple chains, which downstream consumers cannot recompose. Conformance fixtures live at [`spec/conformance/1.2.3/multi-producer/`](spec/conformance/1.2.3/multi-producer/) and the reference implementation is `resolveChainRoot` in `@atrib/mcp`. See [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) for the decision rationale and rejected alternatives.

Precedence (highest to lowest):

1. **Inbound propagation token.** If the call carries an inbound atrib token decoded per [§1.5.2](#152-http-transport-tracestate) (MCP `_meta.atrib`, W3C tracestate `atrib=...`, or `X-Atrib-Chain` header), the token's `record_hash` MUST become the new record's `chain_root`. Ignoring it would re-genesis a chain the caller explicitly extended.
2. **Within-process auto-chain tail.** If the producer signed a previous record under the same `context_id` in the current process and remembers its hash in memory, that hash MUST be the new record's `chain_root`.
3. **Cross-producer env-var handoff.** If the env var `ATRIB_CHAIN_TAIL_<context_id>` is set with a value matching `^sha256:[0-9a-f]{64}$`, that value MUST be the new record's `chain_root`. The env var is namespaced by `context_id`; a value set for a different context MUST NOT be consulted. Malformed values MUST fall through to lower-priority sources rather than be treated as a chain anchor.
4. **Cross-producer mirror-file inheritance.** The effective mirror file, after producer configuration and environment resolution, identifies a local mirror corpus: every `*.jsonl` file in its directory (file-as-IPC channel; see [§5.9](#59-local-mirror-conventions)). If that corpus contains records on the same `context_id`, the newest per-file tail's canonical hash MAY be used as the new record's `chain_root`. Append order selects the tail within one file. Across files, the greatest signed `timestamp` wins; equal timestamps use the lexicographically greater canonical record hash. Producers consulting mirrors MUST filter to records matching `context_id`; chaining to a mirror tail on a different `context_id` produces a malformed record (`chain_root` pointing into a chain whose `context_id` differs from the new record's) and MUST be rejected by both validators ([§2.6.1](#261-submit-entry)) and verifiers. An implementation MAY keep a deletable advisory tail index. It MUST validate the index against the current corpus, update it atomically, and fall back to a full scan when files disappear, shrink, are replaced, or otherwise conflict with the indexed state.
5. **Synthetic genesis.** If no upstream chain context exists, `chain_root` MUST be the genesis chain root per the formula in [§1.2.3](#123-chain_root-for-genesis-records).

The precedence ordering reflects fidelity to the upstream signal: inbound tokens are the spec-canonical handoff, within-process state is fresher than out-of-process state, env-var handoff is set explicitly by a spawning process while a mirror file may lag (writes pending, peer producer signed something not yet flushed). Producers in any language MAY implement their own resolver but MUST pass the conformance corpus.

#### 1.2.4 event_type Values

`event_type` is an absolute URI. atrib publishes a small canonical core vocabulary; consumers MAY mint their own extension URIs in any namespace they control. atrib does not gate, register, or approve extension URIs; [D035](DECISIONS.md#d035-extensible-event_type-vocabulary-via-uri-typing) establishes the URI-typing mechanism, and [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) defines the bar for promoting an extension URI to atrib's normative set.

**Normative URI set:**

| URI                                           | Binary | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://atrib.dev/v1/types/tool_call`        | `0x01` | An agent invoked a tool with input(s) and received a result. Emitted by an MCP server when it returns a successful (non-error) response to a `tools/call` request. MUST NOT be emitted when `isError: true` in the MCP result. Default for any active operation against external state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `https://atrib.dev/v1/types/transaction`      | `0x02` | A commerce-protocol-detected closing event (ACP / UCP / x402 / MPP / AP2 / a2a-x402; see [§1.7](#17-transaction-event-hooks)). Emitted when a transaction completes, either by the merchant's agent writing a record, or by the atrib SDK reading a transaction webhook. The `content_id` for a transaction record usually uses the merchant's checkout endpoint URL as the server_url and `"checkout"` as the tool_name. AP2 Path 2 MAY use the receipt identity ladder in [payments profile §2.5](docs/payments-profile.md#25-ap2-and-a2a-x402). The [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation is normatively gated on this URI.                                                                                                                                                                                                 |
| `https://atrib.dev/v1/types/observation`      | `0x03` | A standalone perception or noting, with no required referent on a prior record. Two production shapes: (a) a passive perception captured by an ambient watcher or input source (the original framing in [§1.2.4.1](#1241-canonical-examples) example C below); (b) an agent self-emitted noting of an environmental fact, hypothesis, or in-the-moment discovery that does not point at a specific prior record. Distinguished from `tool_call` by the absence of agent-chosen action against external state. Distinguished from `annotation` and `revision` by the absence of a referent: observation has no `annotates` and no `revises` field. The agent or watcher is recording a first-class noting that future-self or downstream consumers can read back, weight, or anchor against.      |
| `https://atrib.dev/v1/types/directory_anchor` | `0x04` | A commitment by a directory operator to its current state, emitted per [§6.2.4](#624-anchor-cross-reference-into-the-tessera-log) after each directory operation. Carries `directory_root`, `epoch`, and `version` for downstream verifier consultation per [§6.3](#63-verifier-consultation-algorithm) step 7 (AKD anchor consistency check). Emitted by atrib-system directory services, not by agents. Promoted from extension namespace by [D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04).                                                                                                                                                                                                                                                       |
| `https://atrib.dev/v1/types/annotation`       | `0x05` | A commentary record pointing at any prior record via the `annotates` field ([§1.2.7](#127-annotates)). The recall-fidelity primitive: an agent reading back its own signed records uses annotations to weight, summarize, and topic-tag earlier records that future-self should not lose to flat scanning. Distinct from `observation`: annotation is a forward-pointing claim _about_ an earlier record; observation is a first-class signed event. Validators MUST require `annotates` on annotation records and MUST reject `annotates` on any other event_type. The graph layer derives ANNOTATES edges per [§3.2.4](#324-edge-derivation-rules) step 8. Promoted from extension namespace by [D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05).          |
| `https://atrib.dev/v1/types/revision`         | `0x06` | A claim that supersedes a prior record via the `revises` field ([§1.2.9](#129-revises)). The contradiction-handling primitive: when the agent now holds a position incompatible with a prior claim, the revision is the way to surface the change as a first-class graph node rather than a silent edit (records are immutable). Distinct from `annotation`: annotation comments while leaving the prior position intact, revision asserts the prior is no longer held. Validators MUST require `revises` on revision records and MUST reject `revises` on any other event_type. The graph layer derives REVISES edges per [§3.2.4](#324-edge-derivation-rules) step 9. Promoted from extension namespace by [D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06). |

**Extension URIs:** Any absolute URI in a non-`atrib.dev` namespace is a valid extension URI. The 1-byte log entry slot ([§2.3.1](#231-entry-serialization)) maps such URIs to the byte `0xFF` (extension type); verifiers wanting to filter by the URI itself read the URI from the record. Extension URIs SHOULD identify a stable owner (a domain the consumer controls or a `urn:` namespace they registered); atrib does not enforce ownership. atrib itself stages promotions this way: https://atrib.dev/v1/types/session_checkpoint ([§1.2.10](#1210-checkpoint)) is produced under 0xFF ahead of its [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) byte allocation (0x08), per the [D073](DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) pattern.

##### 1.2.4.1 Canonical examples

Each example is an unsigned record skeleton (without `signature`, `creator_key`, `chain_root`, `context_id`, `timestamp`, which appear identically on every record). Captions explain the structural and semantic positioning. Example records elsewhere in this spec ([§A](#a-conformance-test-vectors-1) conformance corpora) provide complete signed instances; the examples here pin down the _type-selection_ question only.

**Example A: `tool_call`**, agent invoked an external tool with side effects.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/tool_call",
  "content_id": "sha256:<canonical hash of {tool_name, args, result}>",
  "tool_name": "Edit",
  "args_hash": "sha256:<...>",
  "result_hash": "sha256:<...>"
}
```

Caption: an MCP server returned a non-error result for a `tools/call` request. The `Edit` invocation modified state (filesystem). The record signs the action; verifiers reading the chain can prove the agent took this step.

**Example B: `transaction`**, commerce-protocol-detected closing event.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/transaction",
  "content_id": "sha256:<canonical hash of {merchant_url, amount, ...}>",
  "signers": [
    { "creator_key": "<agent>", "signature": "..." },
    { "creator_key": "<merchant>", "signature": "..." }
  ]
}
```

Caption: payment closed via x402 / ACP / UCP / MPP / AP2 / a2a-x402. The `signers` array carries cross-attestation per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records). The [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation gates on this URI.

**Example C: `observation` (passive watcher)**, ambient process noted environmental state.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/observation",
  "content_id": "sha256:<canonical hash of content>",
  "content": {
    "kind": "substrate_health",
    "tree_size": 846,
    "errors_in_window": 0,
    "window_ms": 14400000
  }
}
```

Caption: a periodic prerun script reports health every four hours. No prior record is being commented on; the agent did not invoke a tool. This is a first-class noting that future-self can read back to anchor "the substrate was healthy at this moment."

**Example D: `observation` (agent self-emitted)**, agent recorded an in-the-moment noting that does not point at a specific prior record.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/observation",
  "content_id": "sha256:<canonical hash of content>",
  "content": {
    "kind": "discovery",
    "summary": "the upstream HTTP client returns 502 on payloads larger than 64 KB",
    "importance": "medium"
  },
  "informed_by": ["sha256:<the tool_call that surfaced the discovery>"]
}
```

Caption: an agent learned something during work that future-self should be able to find. The `informed_by` field acknowledges sources that produced the discovery, but no `annotates` field is set because the observation is a _standalone_ noting, not commentary about a specific prior record. Distinguishes observation from annotation: observation does not pick out _one_ prior record as the target; annotation does.

**Example E: `directory_anchor`**, directory operator commitment.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/directory_anchor",
  "content_id": "sha256:<canonical hash of {directory_root, epoch, version}>",
  "content": {
    "directory_root": "...",
    "epoch": 12345,
    "version": "akd-v1"
  }
}
```

Caption: emitted by an atrib-system directory service per [§6.2.4](#624-anchor-cross-reference-into-the-tessera-log) after each directory operation. Not emitted by agents.

**Example F: `annotation`**, agent commentary about a specific prior record.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/annotation",
  "content_id": "sha256:<canonical hash of content>",
  "annotates": "sha256:<the prior record being commented on>",
  "content": {
    "summary": "session covered the lint-rule rewrite plus its rollout plan",
    "importance": "high",
    "topics": ["lint-rule-rewrite", "session-summary"]
  }
}
```

Caption: a session-end retrospective hook commenting on the chain-tail of the trace it ran in. The `annotates` field REQUIRED per [§1.2.7](#127-annotates) makes this a forward-pointing claim _about_ an earlier record. Annotation does not assert the prior record was wrong; it weights, summarizes, or tags the prior record for recall fidelity.

**Example G: `revision`**, agent superseding a prior claim.

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/revision",
  "content_id": "sha256:<canonical hash of content>",
  "revises": "sha256:<the prior record being superseded>",
  "content": {
    "prior_position": "the upstream service supports streaming responses",
    "new_position": "the upstream service does not support streaming; the SSE-shaped traffic came from a different endpoint",
    "reason": "tested empirically; verify against the OpenAPI document rather than inference"
  }
}
```

Caption: the agent now holds a position incompatible with a prior signed claim. Records are immutable, so the substrate surfaces the change as a first-class graph node rather than a silent edit. The `revises` field REQUIRED per [§1.2.9](#129-revises) carries the predecessor reference; the content carries the prior position, the new position, and the reason.

##### 1.2.4.2 Choosing event_type

The decision tree (consumer-facing; producers MUST emit the event_type that matches the structural reality of the record):

1. **Is this a commerce-protocol-detected closing event?** → `transaction`. Carries `signers` array per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records).
2. **Is this a directory operator's state commitment?** → `directory_anchor`. Emitted by atrib-system directory services, not agents.
3. **Did the agent invoke a tool with side effects on external state?** → `tool_call`. Result attested via `args_hash` / `result_hash` per [§1.2.1](#121-field-definitions).
4. **Does the record point at a specific prior record as its target?**
   - YES, the new claim supersedes the prior position (the agent no longer holds it) → `revision`. REQUIRES `revises` per [§1.2.9](#129-revises).
   - YES, the new claim comments on, weights, summarizes, or tags the prior record without overturning it → `annotation`. REQUIRES `annotates` per [§1.2.7](#127-annotates).
   - NO (standalone noting, no specific prior record being targeted) → `observation`.
5. **Otherwise?** → mint or use an extension URI in your namespace per [D035](DECISIONS.md#d035-extensible-event_type-vocabulary-via-uri-typing). atrib does not gate extension URIs.

**Common confusion: observation vs annotation.** The structural distinction is _referent_. If the record points at a specific prior record (`annotates` set), it's an annotation. If the record is a standalone noting that may reference sources via `informed_by` but does not pick out a single prior record as its target, it's an observation. A discovery the agent makes during work, with no specific prior record being commented on, is an observation (Example D). A summary of "the trace covered topic Y" pointing at the trace's chain-tail is an annotation (Example F).

**Common confusion: annotation vs revision.** Both carry forward-pointing claims about an earlier record. Annotation says "here is commentary on this prior record"; the agent's stance is unchanged. Revision says "I no longer hold the position I claimed in this prior record." Annotations weight, summarize, or tag for recall; revisions overturn. The semantic strength differs.

**Producer guidance for emit pipelines.** Emit pipelines that automate event_type selection (lifecycle hooks, extractor sub-agents, periodic watchers) SHOULD select event_type by structural rule, not by content keyword:

- A lifecycle hook with a chain-tail referent → `annotation`. The referent makes annotation correct.
- A watcher with no referent → `observation`. The absence of a referent makes observation correct.
- An extractor sub-agent reading the agent's transcript and emitting cognitive events SHOULD select per the decision tree above for each detected event: a hedge phrase contradicting a prior claim becomes `revision` if the prior record is identifiable, else `observation`; a discovery becomes `observation`; a summary about a specific prior chain becomes `annotation`.

This guidance addresses the gap [D063](DECISIONS.md#d063-canonical-event_type-examples-and-selection-tree) records: prior to the canonical examples here, implementations in the atrib ecosystem drifted between observation and annotation for records that had clear structural answers (records with referents went to observation as a fallback before the annotation pipeline shipped, records without referents had no automated path at all).

#### 1.2.5 informed_by

The `informed_by` field carries the agent's claimed reasoning context: an array of `"sha256:" + hex(record_hash)` strings identifying records the agent claims informed this action. The field is OPTIONAL (per [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)); records without it make no provenance claim.

**Format.** Each entry is a `"sha256:"` prefix followed by 64 lowercase hex characters, matching the `chain_root` format. The array MUST be sorted lexicographically by the hex string. Sorting is required for canonical serialization stability: an agent-side ordering choice would otherwise affect signatures.

**Semantics.** A record with `informed_by: ["sha256:abc...", "sha256:def..."]` claims the agent consulted those two referenced records before deciding to emit this record. The references MAY point at records in the same session, a different session of the same `creator_key`, or a session of a different `creator_key`. There is no requirement that the referenced records actually exist in any particular log; the verifier resolves what it can and surfaces dangling references ([§3.2.3](#323-edge-types) INFORMED_BY edge with `dangling: true`).

**Trust posture.** atrib certifies that the holder of the `creator_key` signed a record carrying these claims. atrib does NOT certify that the referenced records actually informed the agent's decision. Truthfulness verification (cross-checking referenced content against the action) is a downstream concern.

#### 1.2.7 annotates

The `annotates` field carries a single record_hash reference identifying the target record this annotation describes. The field is OPTIONAL on the record format but REQUIRED when `event_type = https://atrib.dev/v1/types/annotation` and FORBIDDEN on any other event_type. Validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records that violate this constraint.

**Format.** A `"sha256:"` prefix followed by 64 lowercase hex characters, matching the `chain_root` and `informed_by` entry formats.

**Semantics.** A record A with `event_type = annotation` and `annotates: "sha256:..."` claims to be a commentary on record T identified by the hash. Annotations carry caller-defined content per [§1.2.2](#122-content_id-derivation), common shapes include importance level, topic tags, summary text, and confidence, but the protocol does not normatively prescribe content fields beyond requiring `annotates` itself. The reference MAY point at a record in the same session, a different session of the same `creator_key`, or a session of a different `creator_key`. Multiple annotations of the same target are normal (and produce multiple ANNOTATES graph edges).

**Graph derivation.** The graph layer derives ANNOTATES edges per [§3.2.4](#324-edge-derivation-rules) step 8. Annotation records whose `annotates` target is not in the resolved record set produce dangling edges (target = synthetic dangling node, `dangling: true`) so the agent's claim stays visible. ANNOTATES is the dual of INFORMED*BY ([§1.2.5](#125-informed_by)): forward-pointing (a new record claims something \_about* an earlier record) rather than backward-pointing (a new record claims earlier records _informed_ it). Both are agent-declared; both produce graph edges that surface the agent's reasoning structure without inferring causation.

**Trust posture.** atrib certifies that the holder of the `creator_key` signed an annotation referencing the target. atrib does NOT certify that the annotation accurately characterizes the target. Truthfulness verification (does the importance/topics/summary match the target's actual content?) is a downstream concern. The substrate guarantees the annotation is signed; consumers decide how much to trust it.

**JCS canonical form.** `annotates` (a) sorts lexicographically before `chain_root` (c) and after `spec_version` (s comes after a, but spec_version is the conventional first field by JCS sort over all current fields except those starting with letters before s, verify the alphabetic ordering in implementations rather than assuming).

#### 1.2.9 revises

The `revises` field carries a single record_hash reference identifying the predecessor record this revision supersedes. The field is OPTIONAL on the record format but REQUIRED when `event_type = https://atrib.dev/v1/types/revision` and FORBIDDEN on any other event_type. Validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records that violate this constraint.

**Format.** A `"sha256:"` prefix followed by 64 lowercase hex characters, matching the `chain_root`, `informed_by`, and `annotates` formats.

**Semantics.** A record R with `event_type = revision` and `revises: "sha256:..."` claims to supersede record P identified by the hash. The current record asserts a position incompatible with P; not a content edit (records are immutable on the log) but a forward-pointing claim that future-self should weight this over the referenced predecessor. Revisions carry caller-defined content per [§1.2.2](#122-content_id-derivation), common shapes include the new position, prior position, and reason for revision, but the protocol does not normatively prescribe content fields beyond requiring `revises` itself. The reference MAY point at a record in the same session, a different session of the same `creator_key`, or a session of a different `creator_key`. Multiple revisions of the same target are allowed (a chain of mind-changes); the graph surfaces all of them.

**Distinction from `annotates`.** Annotation says "here is commentary on this prior record"; the agent's stance is unchanged. Revision says "I no longer hold the position I claimed in this prior record." Annotations weight, summarize, or tag for recall; revisions overturn. Both are forward-pointing claims about earlier records; the semantic strength differs.

**Distinction from `informed_by`.** informed_by acknowledges sources that informed the current claim; revises asserts the current claim contradicts a prior one. A revision MAY also carry informed_by (referencing the records that led the agent to change position), both fields coexist freely.

**Graph derivation.** The graph layer derives REVISES edges per [§3.2.4](#324-edge-derivation-rules) step 9. Revision records whose `revises` target is not in the resolved record set produce dangling edges (target = synthetic dangling node, `dangling: true`) so the agent's claim stays visible.

**Trust posture.** atrib certifies that the holder of the `creator_key` signed a revision referencing the predecessor. atrib does NOT certify that the revision is well-founded or that the predecessor was wrong. Truthfulness verification (does the new position actually supersede the old one for this question?) is a downstream concern.

**JCS canonical form.** `revises` (r) sorts lexicographically after `provenance_token` (p) and before `session_token` (s).

#### 1.2.6 provenance_token

The `provenance_token` field carries an opaque token used for cross-session causal anchoring. It is OPTIONAL; records without it make no ancestry claim.

**Format.** Base64url-encoded 16 bytes (RFC 4648 §5, no padding). 22 characters.

**Scope constraint.** `provenance_token` MUST appear ONLY on the genesis record of a session (the first record in a `context_id`). A session's ancestry is a session-level property; the genesis record is the natural place to declare it. Subsequent records in the session inherit ancestry implicitly via session membership. Both validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records carrying `provenance_token` when they are not the session's genesis record. Middleware ([§5.3](#53-atribmcp-mcp-server-middleware), [§5.4](#54-atribagent-agent-middleware)) SHOULD refuse to sign such records to prevent malformed submissions reaching the log.

**Derivation.** A session-genesis record claiming ancestry from upstream record U carries `provenance_token = base64url(SHA-256(JCS(U))[:16])` where U is the complete signed record (including its signature). The first 16 bytes of the SHA-256 record hash provide 2^128 collision resistance, sufficient for the cross-session anchor space.

**Upstream records carry no special field.** Any signed record in the log is implicitly anchorable. Downstream records reference it by truncated hash. The token is a downstream-side claim only; upstream records do not need to declare anchorability.

**Graph derivation.** The graph layer derives PROVENANCE_OF edges ([§3.2.3](#323-edge-types)) by searching for any record U whose first 16 bytes of `SHA-256(JCS(U))` match the token, with `U.context_id ≠ D.context_id`. Dangling references (token claimed but no matching upstream in the resolved set) are flagged with `dangling: true`.

**Distinction from session_token.** session*token ([§1.5.5](#155-cross-trace-session-continuity)) means \_same logical session across OTel trace boundaries* (continuation of one task). provenance*token means \_different session, causally anchored* (one session's first record descends from another's). They MAY coexist on the same genesis record (a session may both belong to a multi-trace logical session AND descend from a prior anchor).

**Relationship to `informed_by`.** provenance_token is a stricter, ergonomically-specialized subset of `informed_by` ([§1.2.5](#125-informed_by)):

| Property                     | `informed_by`                                      | `provenance_token`                                |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Cardinality                  | Multi-valued array                                 | Single value                                      |
| Scope                        | Per-record (any record may carry it)               | Per-session (genesis record only)                 |
| Hash form                    | Full record_hash with prefix (~71 chars per entry) | Truncated 16 bytes (22 chars base64url)           |
| Use case                     | Records this action consulted                      | This session's ancestry anchor                    |
| Cross-session API ergonomics | Not optimized for env-var / header passing         | Designed for env-var / header / URL-param passing |

A consumer wanting full-precision multi-anchor cross-session references uses `informed_by` (which can include record_hashes from any session). provenance_token is the ergonomic shorthand for declaring a single ancestral anchor that can be passed across session boundaries via short tokens.

#### 1.2.10 checkpoint

The `checkpoint` field carries a session checkpoint: a Merkle commitment to the ordered record-hash stream of the record's `context_id` so far. The field is OPTIONAL on the record format but REQUIRED when `event_type = https://atrib.dev/v1/types/session_checkpoint` and FORBIDDEN on any other event_type. Validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records that violate this constraint — the same presence discipline as `annotates` ([§1.2.7](#127-annotates)) and `revises` ([§1.2.9](#129-revises)).

A session checkpoint is an ordinary signed atrib record. It is signed like any record ([§1.4](#14-signing-and-verification)), chained like any record ([§1.2.3.1](#1231-multi-producer-chain-composition) precedence via `resolveChainRoot`, never reimplemented), submitted like any record ([§2.6.1](#261-submit-entry)), and non-blocking like any record ([§5.3.5](#535-log-submission), [§5.8](#58-degradation-contract)). What it adds is a completeness and selective-disclosure claim the per-record log entries ([§2.3.1](#231-entry-serialization)) cannot make: an inclusion proof of leaf `i` against `session_root` proves a record's position within the committed session stream while revealing only the record hash, its index, and ~log2(n) sibling hashes — never sibling record bodies — and the checkpoint as a whole asserts "this is the entire committed stream as of leaf `tree_size - 1`." Position becomes provable while args/result stay salted commitments per [§8.3](#83-salted-commitment-posture).

**Disambiguation.** Session checkpoints are unrelated to the log's checkpoints ([§2.4](#24-checkpoint-format)). A log checkpoint is the log operator's signed statement about the public log tree; a session checkpoint is a producer's signed record committing to its own session stream. They share the RFC 6962 tree algebra and nothing else.

**Event type and staged promotion.** The event_type URI is `https://atrib.dev/v1/types/session_checkpoint`. Pre-promotion, producers emit the URI and log operators encode the entry under the `0xFF` extension byte per [§2.3.1](#231-entry-serialization) — the staged pattern [D073](DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) established. At promotion per the [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar, the byte `0x08` is allocated (skipping `0x07`, which remains [D073](DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)'s design-level reservation for `handoff`). Because the event_type in the signed bytes is the URI, records emitted before and after promotion are byte-identical; only the 90-byte log entry's type byte changes for new submissions. The [conformance corpus](spec/conformance/session-checkpoint/) pins this duality (`byte-uri-duality`).

**Example** (a complete signed instance from the [conformance corpus](spec/conformance/session-checkpoint/); the second checkpoint of a five-record stream):

```json
{
  "spec_version": "atrib/1.0",
  "content_id": "sha256:89601eeb0b82436563c295c61359be112f8cabdfe00b52302f3af8bfa6827b3b",
  "creator_key": "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
  "chain_root": "sha256:0d12ff963483ddb41626549efddae406552ac9544f3a0602ab17d387eb4e7ee2",
  "checkpoint": {
    "first_index": 2,
    "prior_checkpoint": "sha256:100fb76914744a6eaaee131873c5ddd8b78af2add3c5b0270d879b0a74f48aea",
    "session_root": "sha256:e7eea58194aa467d27fcd627cf87181f898aa9ad8fba4bb6a8755618b8bd0a57",
    "tree_size": 5
  },
  "event_type": "https://atrib.dev/v1/types/session_checkpoint",
  "context_id": "abababababababababababababababab",
  "timestamp": 1782864030000,
  "args_hash": "sha256:1606e02f9257826a0e8a12b01ab4efbb8826e4a1a34600d7a2e436fca03d2f6a",
  "signature": "8gUC5zcTI-VoxWqcLrFfOujZhcWTAx7XmPM9K85DnIM5Pjjxsmas_xaVv5AaGfxtoHXyjYYBBC3jAV3MMDRoBg"
}
```

**Field semantics within `checkpoint`** (all REQUIRED unless marked):

| Field              | Type              | Rule                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_root`     | string            | `"sha256:"` + 64 lowercase hex. The RFC 6962 Merkle Tree Hash over leaves `0..tree_size-1` per [§1.2.10.1](#12101-session-tree-construction).                                                                                                                                             |
| `tree_size`        | integer           | ≥ 1. Number of leaves committed. The last covered leaf index is `tree_size - 1` (implicit; not a separate field). Empty checkpoints are prohibited; producers SHOULD skip an interval that added no new leaves.                                                                            |
| `first_index`      | integer           | `0 ≤ first_index < tree_size`. Index of the first leaf newly covered by this interval. MUST equal the prior checkpoint's `tree_size` when `prior_checkpoint` is present, and `0` when absent.                                                                                              |
| `prior_checkpoint` | string, OPTIONAL  | `"sha256:"` + 64 lowercase hex record hash ([§1.2.3](#123-chain_root-for-genesis-records) definition) of the immediately preceding `session_checkpoint` record on the same `context_id`. MUST be present iff `first_index > 0`. Omitted — not null — on a session's first checkpoint.      |
| `retroactive`      | boolean, OPTIONAL | When present, MUST be `true`; `retroactive: false` MUST NOT be emitted (absence-not-null; presence changes the JCS canonical form and therefore the signature). Semantics per [§1.2.10.3](#12103-retroactive-checkpoints-and-freshness).                                                   |

**Validator rules** ([§2.6.1](#261-submit-entry) conformance targets). Validators MUST reject: a `session_checkpoint` record missing `checkpoint`; `checkpoint` on any other event_type; `tree_size < 1`; `first_index ≥ tree_size` (or negative / non-integer); `prior_checkpoint` present with `first_index == 0`; `prior_checkpoint` absent with `first_index > 0`; `retroactive: false`. As with `annotates` and `revises`, the signature on a violating record may itself be valid; rejection is at the policy layer.

**content_id derivation.** `content_id` follows [§1.2.2](#122-content_id-derivation) with tool_name `"session_checkpoint"`. Producers with a service origin use their normalized origin as server_url, mirroring `directory_anchor`'s `"<origin>:directory_anchor"` input ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)). Origin-less cognitive producers SHOULD use the pseudo-origin `atrib`, giving the input `"atrib:session_checkpoint"`; the conformance corpus pins this constant.

**Local content commitment.** Per [D099](DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash), producers SHOULD set `args_hash = sha256(JCS({"leaves": [ ...ordered "sha256:<hex>" strings... ]}))`, committing the flat leaf list alongside the tree root while keeping the list itself in `_local.content.leaves` in the local mirror ([§5.9](#59-local-mirror-conventions)). The list never sits on the public submission path (unbounded record size, no selective disclosure), yet any party handed the list can replay both the `args_hash` commitment and the `session_root`.

##### 1.2.10.1 Session tree construction

- **Leaf value.** The raw 32-byte record hash of each covered record — hex-decoded from `"sha256:" + hex(SHA-256(JCS(complete signed record including signature)))`, exactly the record-hash definition in [§1.2.3](#123-chain_root-for-genesis-records)'s normative clarification. Leaves are the _bytes_, not the prefixed hex string; a tree computed over the UTF-8 display strings MUST NOT match (the corpus carries a trap vector).
- **Hash function and domain separation.** RFC 6962 §2.1 exactly as [§2.3.2](#232-leaf-hash-computation): `leaf_hash = SHA-256(0x00 || leaf_bytes)`, `node_hash = SHA-256(0x01 || left || right)`. No new personalization string. Cross-tree confusion with the public log is structurally impossible: log leaves have fixed 90-byte preimages ([§2.3.1](#231-entry-serialization)); session leaves have fixed 32-byte preimages. Keeping the algorithm verbatim means the [§2.7](#27-inclusion-proof-verification) inclusion-proof procedure, the RFC 6962 §2.1.4 consistency-proof check the [§2.9](#29-witnessing-and-cosignatures) witness protocol already relies on, and existing Merkle libraries are reused unchanged.
- **Leaf ordering.** Producer-declared session order, and it is a _signed claim_. Conforming producers MUST append leaves in the order they observed the records: signing order for records they signed, mirror append order for records read back from the [§5.9](#59-local-mirror-conventions) mirror. Verifiers do NOT recompute a canonical order; multi-producer sessions ([§1.2.3.1](#1231-multi-producer-chain-composition), [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)) have no trustworthy global time order (coarsened timestamps per [§8.4](#84-coarsened-timing-posture), clock skew).
- **Ordering-consistency checks** (verifier-side, categorical, signal not block, per [§3.3](#33-verification-state)). When the verifier can resolve the leaf records it MUST check: (a) if CHAIN_PRECEDES A → B and both are leaves, `index(A) < index(B)`; (b) leaf timestamps are non-decreasing beyond declared `timestamp_granularity`; (c) every resolved leaf's `context_id` equals the checkpoint's `context_id` — violation of (c) is a hard structural fault, not a soft flag; (d) every prior `session_checkpoint` record on the context appears as a leaf.
- **Self-exclusion.** A checkpoint MUST NOT include itself as a leaf (its hash depends on `session_root`). It becomes a leaf in the next checkpoint's tree — checkpoints are part of the stream they formalize.
- **Empty checkpoints prohibited.** `tree_size ≥ 1`. The RFC 6962 empty-tree root (`SHA-256("")`) MUST never appear as a `session_root`.

##### 1.2.10.2 Consistency and equivocation

For consecutive checkpoints K_i → K_{i+1} on one `context_id`: `K_{i+1}.checkpoint.prior_checkpoint` MUST be the record hash of K_i; `K_{i+1}.checkpoint.first_index` MUST equal `K_i.checkpoint.tree_size`; and the leaf sequence `0..K_i.tree_size-1` MUST be identical — append-only extension, provable by an RFC 6962 §2.1.4 consistency proof from `(K_i.session_root, K_i.tree_size)` to `(K_{i+1}.session_root, K_{i+1}.tree_size)`, the same append-only check the log's witness protocol applies between successive log checkpoints ([§2.9](#29-witnessing-and-cosignatures)).

Two signed checkpoints from the same `creator_key` claiming the same `prior_checkpoint` (or overlapping ranges) with inconsistent roots constitute equivocation evidence against that key — the session-scale analogue of log equivocation in [§2.11](#211-cross-log-replication) — reported as a categorical verifier fact.

**Honest scope** ([§8.7](#87-adversarial-threat-model)). The completeness claim is provable _relative to the creator's own committed stream_: a creator that maintains a never-checkpointed side chain is not detected by this mechanism. What changes is that any two committed views of the same session are now cryptographically comparable, so selective re-narration becomes attributable equivocation instead of deniable omission. One session root per interval is also the natural unit for anchor plurality per [§2.11](#211-cross-log-replication) / [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense): multi-anchoring one root per interval is cheap where per-record multi-anchoring is not.

##### 1.2.10.3 Retroactive checkpoints and freshness

A checkpoint signed now over an old chain proves the history existed and was tree-committed as of the checkpoint's log-inclusion time, not as of the original session. The covered records' own log entries remain the per-record contemporaneous anchors.

- **Producer rule.** `retroactive: true` MUST be set when any leaf in the newly covered interval `[first_index, tree_size-1]` was not observed live by the checkpointing producer (backfilled from a mirror, archive, or third-party history). The flag is present-only-when-true: `retroactive: false` MUST NOT be emitted, and absence — not `null`, not `false` — is the canonical non-retroactive form (the invariant-5 discipline of [§1.3](#13-canonical-serialization); presence changes the signature).
- **Verifier rule.** Verifiers assign one categorical freshness fact per checkpoint: `contemporaneous`, `declared-retroactive`, or `stale-undeclared` (checkpoint timestamp exceeds the max covered leaf timestamp by more than a verifier-configured bound; RECOMMENDED default 24 hours). This mirrors the `in_envelope: false` signal-not-block posture of [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) / [§6.7](#67-capability-declarations): a stale-undeclared checkpoint remains valid and admissible; the fact travels with the verification result.

##### 1.2.10.4 Graph participation

**No new edge types; the nine-edge set of [§3.2.4](#324-edge-derivation-rules) is unchanged.** The Merkle root does not structurally reveal its member hashes; deriving per-leaf edges would require external leaf-list material, which violates the observable-structure rule ([§3.1](#31-design-principles-and-rationale)). The one field that IS observable structure, `checkpoint.prior_checkpoint`, deliberately stays verifier-side: checkpoint ordering is already coherent through `chain_root`, and producers wanting a declared graph relationship MAY additionally list the prior checkpoint hash in `informed_by`, reusing existing INFORMED_BY machinery (dangling-safe per [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), omission-by-default per [D113](DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default)).

Node participation ([§3.2.1](#321-node-types)) is identical to `observation`: CHAIN_PRECEDES / SESSION_PRECEDES / SESSION_PARALLEL yes; CONVERGES_ON no; CROSS_SESSION no; INFORMED_BY and PROVENANCE_OF source/target yes; [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) attribution **skipped**. This is load-bearing: a session's attribution distribution MUST be bit-identical whether or not its producer adopted checkpointing ([§4.1](#41-purpose-and-position-in-the-protocol) no-thumb rule), so checkpoint records never enter contributing-node sets. Graph endpoints continue to return no weighted or interpreted data ([§3.6](#36-implementation-notes)); ordering-consistency, equivocation, and freshness results are verifier facts, not graph payloads.

##### 1.2.10.5 Conformance

Conformance fixtures live at [`spec/conformance/session-checkpoint/`](spec/conformance/session-checkpoint/): seventeen cases across five families — checkpoint object schema and presence rules, real RFC 6962 roots over ordered record-hash leaves (1 / 2 / 5 leaves, empty invalid, raw-32-byte-leaf trap), append-only consistency with a §2.1.4 proof plus an equivocating divergent-root pair, the present-only-when-true `retroactive` flag with categorical freshness facts, and the `0xFF`/`0x08` log-entry duality over byte-identical signed bytes. The generator is `packages/log-dev/scripts/generate-conformance-session-checkpoint.ts`; the reference test is `packages/verify/test/conformance-session-checkpoint.test.ts`. Implementations in any language MAY build their own tree and validation code but MUST pass the corpus.

**JCS canonical form.** `checkpoint` sorts after `chain_root` (`c-h-a` < `c-h-e`) and before `content_id` (`c-h` < `c-o`). It is a new OPTIONAL field, so it is absent from every existing record: no existing canonical form, signature, record hash, chain_root, or propagation token changes. Within the object, JCS orders the members `first_index` < `prior_checkpoint` < `retroactive` < `session_root` < `tree_size`.

---

1.2.10 checkpoint

The `checkpoint` field carries a session checkpoint: a Merkle commitment to the ordered record-hash stream of the record's `context_id` so far. The field is OPTIONAL on the record format but REQUIRED when `event_type = https://atrib.dev/v1/types/session_checkpoint` and FORBIDDEN on any other event_type. Validators ([§1.1.2](#112-roles-validator-vs-verifier), log-side admission) AND verifiers ([§1.1.2](#112-roles-validator-vs-verifier), consumer-side audit) MUST reject records that violate this constraint — the same presence discipline as `annotates` ([§1.2.7](#127-annotates)) and `revises` ([§1.2.9](#129-revises)).

A session checkpoint is an ordinary signed atrib record. It is signed like any record ([§1.4](#14-signing-and-verification)), chained like any record ([§1.2.3.1](#1231-multi-producer-chain-composition) precedence via `resolveChainRoot`, never reimplemented), submitted like any record ([§2.6.1](#261-submit-entry)), and non-blocking like any record ([§5.3.5](#535-log-submission), [§5.8](#58-degradation-contract)). What it adds is a completeness and selective-disclosure claim the per-record log entries ([§2.3.1](#231-entry-serialization)) cannot make: an inclusion proof of leaf `i` against `session_root` proves a record's position within the committed session stream while revealing only the record hash, its index, and ~log2(n) sibling hashes — never sibling record bodies — and the checkpoint as a whole asserts "this is the entire committed stream as of leaf `tree_size - 1`." Position becomes provable while args/result stay salted commitments per [§8.3](#83-salted-commitment-posture).

**Disambiguation.** Session checkpoints are unrelated to the log's checkpoints ([§2.4](#24-checkpoint-format)). A log checkpoint is the log operator's signed statement about the public log tree; a session checkpoint is a producer's signed record committing to its own session stream. They share the RFC 6962 tree algebra and nothing else.

**Event type and staged promotion.** The event_type URI is `https://atrib.dev/v1/types/session_checkpoint`. Pre-promotion, producers emit the URI and log operators encode the entry under the `0xFF` extension byte per [§2.3.1](#231-entry-serialization) — the staged pattern [D073](DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) established. At promotion per the [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar, the byte `0x08` is allocated (skipping `0x07`, which remains [D073](DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)'s design-level reservation for `handoff`). Because the event_type in the signed bytes is the URI, records emitted before and after promotion are byte-identical; only the 90-byte log entry's type byte changes for new submissions. The [conformance corpus](spec/conformance/session-checkpoint/) pins this duality (`byte-uri-duality`).

**Example** (a complete signed instance from the [conformance corpus](spec/conformance/session-checkpoint/); the second checkpoint of a five-record stream):

```json
{
  "spec_version": "atrib/1.0",
  "content_id": "sha256:89601eeb0b82436563c295c61359be112f8cabdfe00b52302f3af8bfa6827b3b",
  "creator_key": "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
  "chain_root": "sha256:0d12ff963483ddb41626549efddae406552ac9544f3a0602ab17d387eb4e7ee2",
  "checkpoint": {
    "first_index": 2,
    "prior_checkpoint": "sha256:100fb76914744a6eaaee131873c5ddd8b78af2add3c5b0270d879b0a74f48aea",
    "session_root": "sha256:e7eea58194aa467d27fcd627cf87181f898aa9ad8fba4bb6a8755618b8bd0a57",
    "tree_size": 5
  },
  "event_type": "https://atrib.dev/v1/types/session_checkpoint",
  "context_id": "abababababababababababababababab",
  "timestamp": 1782864030000,
  "args_hash": "sha256:1606e02f9257826a0e8a12b01ab4efbb8826e4a1a34600d7a2e436fca03d2f6a",
  "signature": "8gUC5zcTI-VoxWqcLrFfOujZhcWTAx7XmPM9K85DnIM5Pjjxsmas_xaVv5AaGfxtoHXyjYYBBC3jAV3MMDRoBg"
}
```

**Field semantics within `checkpoint`** (all REQUIRED unless marked):

| Field              | Type              | Rule                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_root`     | string            | `"sha256:"` + 64 lowercase hex. The RFC 6962 Merkle Tree Hash over leaves `0..tree_size-1` per [§1.2.10.1](#12101-session-tree-construction).                                                                                                                                             |
| `tree_size`        | integer           | ≥ 1. Number of leaves committed. The last covered leaf index is `tree_size - 1` (implicit; not a separate field). Empty checkpoints are prohibited; producers SHOULD skip an interval that added no new leaves.                                                                            |
| `first_index`      | integer           | `0 ≤ first_index < tree_size`. Index of the first leaf newly covered by this interval. MUST equal the prior checkpoint's `tree_size` when `prior_checkpoint` is present, and `0` when absent.                                                                                              |
| `prior_checkpoint` | string, OPTIONAL  | `"sha256:"` + 64 lowercase hex record hash ([§1.2.3](#123-chain_root-for-genesis-records) definition) of the immediately preceding `session_checkpoint` record on the same `context_id`. MUST be present iff `first_index > 0`. Omitted — not null — on a session's first checkpoint.      |
| `retroactive`      | boolean, OPTIONAL | When present, MUST be `true`; `retroactive: false` MUST NOT be emitted (absence-not-null; presence changes the JCS canonical form and therefore the signature). Semantics per [§1.2.10.3](#12103-retroactive-checkpoints-and-freshness).                                                   |

**Validator rules** ([§2.6.1](#261-submit-entry) conformance targets). Validators MUST reject: a `session_checkpoint` record missing `checkpoint`; `checkpoint` on any other event_type; `tree_size < 1`; `first_index ≥ tree_size` (or negative / non-integer); `prior_checkpoint` present with `first_index == 0`; `prior_checkpoint` absent with `first_index > 0`; `retroactive: false`. As with `annotates` and `revises`, the signature on a violating record may itself be valid; rejection is at the policy layer.

**content_id derivation.** `content_id` follows [§1.2.2](#122-content_id-derivation) with tool_name `"session_checkpoint"`. Producers with a service origin use their normalized origin as server_url, mirroring `directory_anchor`'s `"<origin>:directory_anchor"` input ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)). Origin-less cognitive producers SHOULD use the pseudo-origin `atrib`, giving the input `"atrib:session_checkpoint"`; the conformance corpus pins this constant.

**Local content commitment.** Per [D099](DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash), producers SHOULD set `args_hash = sha256(JCS({"leaves": [ ...ordered "sha256:<hex>" strings... ]}))`, committing the flat leaf list alongside the tree root while keeping the list itself in `_local.content.leaves` in the local mirror ([§5.9](#59-local-mirror-conventions)). The list never sits on the public submission path (unbounded record size, no selective disclosure), yet any party handed the list can replay both the `args_hash` commitment and the `session_root`.

##### 1.2.10.1 Session tree construction

- **Leaf value.** The raw 32-byte record hash of each covered record — hex-decoded from `"sha256:" + hex(SHA-256(JCS(complete signed record including signature)))`, exactly the record-hash definition in [§1.2.3](#123-chain_root-for-genesis-records)'s normative clarification. Leaves are the _bytes_, not the prefixed hex string; a tree computed over the UTF-8 display strings MUST NOT match (the corpus carries a trap vector).
- **Hash function and domain separation.** RFC 6962 §2.1 exactly as [§2.3.2](#232-leaf-hash-computation): `leaf_hash = SHA-256(0x00 || leaf_bytes)`, `node_hash = SHA-256(0x01 || left || right)`. No new personalization string. Cross-tree confusion with the public log is structurally impossible: log leaves have fixed 90-byte preimages ([§2.3.1](#231-entry-serialization)); session leaves have fixed 32-byte preimages. Keeping the algorithm verbatim means the [§2.7](#27-inclusion-proof-verification) inclusion-proof procedure, the RFC 6962 §2.1.4 consistency-proof check the [§2.9](#29-witnessing-and-cosignatures) witness protocol already relies on, and existing Merkle libraries are reused unchanged.
- **Leaf ordering.** Producer-declared session order, and it is a _signed claim_. Conforming producers MUST append leaves in the order they observed the records: signing order for records they signed, mirror append order for records read back from the [§5.9](#59-local-mirror-conventions) mirror. Verifiers do NOT recompute a canonical order; multi-producer sessions ([§1.2.3.1](#1231-multi-producer-chain-composition), [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)) have no trustworthy global time order (coarsened timestamps per [§8.4](#84-coarsened-timing-posture), clock skew).
- **Ordering-consistency checks** (verifier-side, categorical, signal not block, per [§3.3](#33-verification-state)). When the verifier can resolve the leaf records it MUST check: (a) if CHAIN_PRECEDES A → B and both are leaves, `index(A) < index(B)`; (b) leaf timestamps are non-decreasing beyond declared `timestamp_granularity`; (c) every resolved leaf's `context_id` equals the checkpoint's `context_id` — violation of (c) is a hard structural fault, not a soft flag; (d) every prior `session_checkpoint` record on the context appears as a leaf.
- **Self-exclusion.** A checkpoint MUST NOT include itself as a leaf (its hash depends on `session_root`). It becomes a leaf in the next checkpoint's tree — checkpoints are part of the stream they formalize.
- **Empty checkpoints prohibited.** `tree_size ≥ 1`. The RFC 6962 empty-tree root (`SHA-256("")`) MUST never appear as a `session_root`.

##### 1.2.10.2 Consistency and equivocation

For consecutive checkpoints K_i → K_{i+1} on one `context_id`: `K_{i+1}.checkpoint.prior_checkpoint` MUST be the record hash of K_i; `K_{i+1}.checkpoint.first_index` MUST equal `K_i.checkpoint.tree_size`; and the leaf sequence `0..K_i.tree_size-1` MUST be identical — append-only extension, provable by an RFC 6962 §2.1.4 consistency proof from `(K_i.session_root, K_i.tree_size)` to `(K_{i+1}.session_root, K_{i+1}.tree_size)`, the same append-only check the log's witness protocol applies between successive log checkpoints ([§2.9](#29-witnessing-and-cosignatures)).

Two signed checkpoints from the same `creator_key` claiming the same `prior_checkpoint` (or overlapping ranges) with inconsistent roots constitute equivocation evidence against that key — the session-scale analogue of log equivocation in [§2.11](#211-cross-log-replication) — reported as a categorical verifier fact.

**Honest scope** ([§8.7](#87-adversarial-threat-model)). The completeness claim is provable _relative to the creator's own committed stream_: a creator that maintains a never-checkpointed side chain is not detected by this mechanism. What changes is that any two committed views of the same session are now cryptographically comparable, so selective re-narration becomes attributable equivocation instead of deniable omission. One session root per interval is also the natural unit for anchor plurality per [§2.11](#211-cross-log-replication) / [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense): multi-anchoring one root per interval is cheap where per-record multi-anchoring is not.

##### 1.2.10.3 Retroactive checkpoints and freshness

A checkpoint signed now over an old chain proves the history existed and was tree-committed as of the checkpoint's log-inclusion time, not as of the original session. The covered records' own log entries remain the per-record contemporaneous anchors.

- **Producer rule.** `retroactive: true` MUST be set when any leaf in the newly covered interval `[first_index, tree_size-1]` was not observed live by the checkpointing producer (backfilled from a mirror, archive, or third-party history). The flag is present-only-when-true: `retroactive: false` MUST NOT be emitted, and absence — not `null`, not `false` — is the canonical non-retroactive form (the invariant-5 discipline of [§1.3](#13-canonical-serialization); presence changes the signature).
- **Verifier rule.** Verifiers assign one categorical freshness fact per checkpoint: `contemporaneous`, `declared-retroactive`, or `stale-undeclared` (checkpoint timestamp exceeds the max covered leaf timestamp by more than a verifier-configured bound; RECOMMENDED default 24 hours). This mirrors the `in_envelope: false` signal-not-block posture of [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) / [§6.7](#67-capability-declarations): a stale-undeclared checkpoint remains valid and admissible; the fact travels with the verification result.

##### 1.2.10.4 Graph participation

**No new edge types; the nine-edge set of [§3.2.4](#324-edge-derivation-rules) is unchanged.** The Merkle root does not structurally reveal its member hashes; deriving per-leaf edges would require external leaf-list material, which violates the observable-structure rule ([§3.1](#31-design-principles-and-rationale)). The one field that IS observable structure, `checkpoint.prior_checkpoint`, deliberately stays verifier-side: checkpoint ordering is already coherent through `chain_root`, and producers wanting a declared graph relationship MAY additionally list the prior checkpoint hash in `informed_by`, reusing existing INFORMED_BY machinery (dangling-safe per [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), omission-by-default per [D113](DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default)).

Node participation ([§3.2.1](#321-node-types)) is identical to `observation`: CHAIN_PRECEDES / SESSION_PRECEDES / SESSION_PARALLEL yes; CONVERGES_ON no; CROSS_SESSION no; INFORMED_BY and PROVENANCE_OF source/target yes; [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) attribution **skipped**. This is load-bearing: a session's attribution distribution MUST be bit-identical whether or not its producer adopted checkpointing ([§4.1](#41-purpose-and-position-in-the-protocol) no-thumb rule), so checkpoint records never enter contributing-node sets. Graph endpoints continue to return no weighted or interpreted data ([§3.6](#36-implementation-notes)); ordering-consistency, equivocation, and freshness results are verifier facts, not graph payloads.

##### 1.2.10.5 Conformance

Conformance fixtures live at [`spec/conformance/session-checkpoint/`](spec/conformance/session-checkpoint/): seventeen cases across five families — checkpoint object schema and presence rules, real RFC 6962 roots over ordered record-hash leaves (1 / 2 / 5 leaves, empty invalid, raw-32-byte-leaf trap), append-only consistency with a §2.1.4 proof plus an equivocating divergent-root pair, the present-only-when-true `retroactive` flag with categorical freshness facts, and the `0xFF`/`0x08` log-entry duality over byte-identical signed bytes. The generator is `packages/log-dev/scripts/generate-conformance-session-checkpoint.ts`; the reference test is `packages/verify/test/conformance-session-checkpoint.test.ts`. Implementations in any language MAY build their own tree and validation code but MUST pass the corpus.

**JCS canonical form.** `checkpoint` sorts after `chain_root` (`c-h-a` < `c-h-e`) and before `content_id` (`c-h` < `c-o`). It is a new OPTIONAL field, so it is absent from every existing record: no existing canonical form, signature, record hash, chain_root, or propagation token changes. Within the object, JCS orders the members `first_index` < `prior_checkpoint` < `retroactive` < `session_root` < `tree_size`.

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

**Implementation Warning:** timestamp precision\*\* The `timestamp` field MUST be a JSON integer (no decimal point, no exponent notation) representing milliseconds. A timestamp of `1743850000000` serializes as the integer `1743850000000` in JCS, not as `1.74385e12` or `"1743850000000"`. Incorrect serialization will produce a different signing input and cause signature verification to fail.

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

Implementations MUST also pass the offline adversarial signing corpus in [`spec/conformance/1.4/`](spec/conformance/1.4/) ([D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)). The offline corpus is the default CI floor for malformed atrib record shapes, bit-flipped signatures, wrong creator keys, and JCS optional-field ordering. The live Wycheproof check remains the upstream compatibility check.

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

1. Use a domain or `urn:` namespace they own, so the URI identifies a stable owner. atrib does not validate ownership.
2. Use a versioned path (e.g., `https://example.com/atrib/v1/types/observation`) so the URI's semantics can evolve under new versions without breaking earlier records.
3. Publish a human-readable schema document at the URI (or at a related URL) so verifiers that want to interpret the type's content can resolve it. atrib does not require resolution to succeed; resolution is opt-in.
4. Treat URIs as opaque identifiers. Two URIs that differ in any byte (including trailing slashes, case, or query parameters) are distinct types. atrib does not normalize URIs before comparison.

**Validation procedure.** Given a candidate URI string `U`:

1. Decode `U` as UTF-8. If decoding fails, reject.
2. Verify `U.length <= 256` octets. If not, reject.
3. Verify `U` contains a `:` separating a non-empty scheme from a non-empty hier-part. If not, reject.
4. Verify the scheme matches the production `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`. If not, reject.
5. If the scheme is `http` or `https`, verify the URI contains a non-empty host (between the `//` and the next `/`, `?`, or end of string). If not, reject.
6. Verify `U` does not contain `#`. If it does, reject.

A URI passing all six steps is syntactically valid for use as `event_type`. atrib normative URIs all pass these checks; conformance fixtures (§spec/conformance/1.4-extension/) include both passing and failing examples for verifier testing.

**Recognition versus validation.** Validation per this section determines whether a record is structurally well-formed and signature-verifiable. Recognition (whether the URI is in atrib's normative set, in a known extension namespace, or completely unknown) is a separate concern handled at the application layer. Verifiers MAY surface recognition as informational metadata in their output (`event_type_recognized`, `event_type_namespace`, etc.) but MUST NOT use recognition to gate verification.

#### 1.4.6 Signing Key Isolation for Sandboxed Execution

When a producer signs records for an agent running inside a sandboxed execution environment, the Ed25519 private key MUST NOT be reachable from that sandbox. The producer MUST hold the key in a host signer process, host service, HSM, secure enclave, or equivalent boundary outside the sandbox, and expose only a request-signature interface to sandboxed code.

The signer boundary MUST control `creator_key` and `signature` for standard records. For transaction records, it MUST control the local creator's `signers[]` entry per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records). A signer MUST reject or overwrite any sandbox-supplied values for signer-controlled fields before canonicalization. Rejecting is RECOMMENDED because it makes boundary violations visible during testing and audit.

The signer process MUST perform [§1.3](#13-canonical-serialization) canonicalization and [§1.4.2](#142-signing-procedure) signing itself. For transaction records, it MUST sign the [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) cross-attestation bytes. The sandbox MAY propose unsigned record fields and sidecar context, but it MUST NOT produce the signature or directly access key bytes.

The host signer SHOULD run host policy before signing. Policy can deny records based on tool name, sandbox identity, requested event type, capability envelope, operator approval state, or other host-local inputs. Policy denial is not an atrib verification failure; it means no atrib record was produced.

The host signer MAY also submit the signed record to the log and return the resulting proof bundle. At minimum, it MUST return the signed record or `record_hash` to the sandbox so the sandbox can propagate context per [§1.5](#15-context-propagation).

This requirement applies unconditionally to principal keys; certified run-key seeds MAY be provisioned into a sandbox per the narrowed rule in [§1.11.9](#1119-key-isolation-interaction). It otherwise applies only when a producer composes atrib with sandboxed execution. Existing non-sandboxed producers MAY continue to hold the key in process, subject to their own host threat model. Key isolation does not certify that the sandboxed agent's request was truthful; it prevents sandbox code from directly minting records under the agent's key without crossing the host signer boundary.

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

When a producer is asked to sign a record but receives no `context_id` from any source (no inbound atrib token, no `traceparent`, no caller-supplied value, no runtime-side session identifier), the producer MUST synthesize a fresh random `context_id` and emit a genesis record under it. The producer MUST NOT consult its local mirror's most-recent record to inherit a `context_id` from another session, that absorbs orphan records into whichever session was at the mirror tail and produces unrecoverable session conflation. The producer SHOULD surface the orphan provenance to operators so the upstream runtime miswire can be fixed; the reference implementation marks orphans `inheritedFrom = 'fresh-orphan'` for downstream filtering. See [D072](DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) for the rationale + alternatives.

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

This propagation format is now standardized by the MCP specification (SEP-414 documents the W3C Trace Context keys `traceparent`, `tracestate`, and `baggage` inside `_meta`). For the negotiated, vendor-prefixed extension carriage and the canonical inbound resolution ladders, see [§1.5.4.1](#1541-negotiated-extension-carriage-devatribattribution).

For MCP over stdio transport, `params._meta` is the only propagation channel. There are no HTTP headers. Implementations MUST NOT attempt to inject attribution context into any other field of the MCP message.

##### 1.5.4.1 Negotiated Extension Carriage: dev.atrib/attribution

The unprefixed `params._meta` convention above remains fully supported and is the normative fallback. Implementations MAY additionally negotiate the same carriage as a first-class MCP extension with identifier `dev.atrib/attribution` (an SEP-2133 unofficial extension under the self-sovereign `dev.atrib` vendor prefix). The complete extension specification — capability settings schemas for both sides, negotiation gating, receipt shape, degradation behavior, and versioning policy — is [`docs/extensions/dev.atrib-attribution/v0.1.md`](docs/extensions/dev.atrib-attribution/v0.1.md). The extension changes no signed byte of any record: it gates only discovery and carriage.

The extension reserves the `_meta` key `dev.atrib/attribution` on requests and results. The v0.1 request block carries exactly two fields; receivers MUST ignore unknown fields, and unknown fields MUST NOT set any field of any signed record:

```
"_meta": {
  "dev.atrib/attribution": {
    "token":      "<§1.5.2 propagation token, ≤87 chars>",
    "context_id": "<32 lowercase hex>"
  }
}
```

`token` is the unchanged [§1.5.2](#152-http-transport-tracestate) propagation token. `context_id` is the raw session anchor of [§1.5.1](#151-context_id-the-session-anchor), carried explicitly — the MCP-transport analog of the [§1.5.3.1](#1531-context-id-header-x-atrib-context) `X-atrib-Context` header, per the explicit-carriage posture of [D135](DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args). `session_token` continues to travel only in `baggage` per [§1.5.5](#155-cross-trace-session-continuity), and `provenance_token` remains genesis-record-only configuration per [§1.2.6](#126-provenance_token); neither is carried in the v0.1 block.

**Canonical inbound resolution.** This section is the single normative definition of MCP inbound-carrier resolution. Other sections, decisions, and derived documents MUST cite this section rather than restate rung lists. Two distinct values are resolved, so there are two ladders.

*Ladder 1 — propagation token.* Implementations MUST resolve the inbound propagation token in this order, taking the first carrier that yields a well-formed token:

```
_meta["dev.atrib/attribution"].token   (extension)
  > _meta.atrib                        (unprefixed convention)
  > _meta.tracestate atrib= entry      (§1.5.2 / D018)
  > _meta["X-Atrib-Chain"]             (§1.5.3 fallback)
```

When the extension key and a legacy carrier decode to different tokens, the extension key wins and the producer SHOULD log an `atrib:`-prefixed warning; a malformed extension token falls through to the next carrier (lenient parse, the [D018](DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow) posture). Malformation is never an error. This ladder refines only the "inbound propagation token" rung of the [§1.2.3.1](#1231-multi-producer-chain-composition) chain-root contract; the rest of that ladder ([D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)) is untouched, and `resolveChainRoot` remains the single chain-selection implementation.

*Ladder 2 — context identity.* Implementations MUST resolve `context_id` in this order:

```
explicit context_id tool argument
  > _meta["dev.atrib/attribution"].context_id
  > _meta.traceparent trace-id
  > D078/D083 harness env-file registry
  > undefined (producer synthesizes per §1.5.1)
```

An explicit tool argument always wins: the extension block is transport metadata, an argument is application intent; on mismatch the producer MUST use the argument and SHOULD log an `atrib:`-prefixed warning. An extension-block `context_id` that is not exactly 32 lowercase hex characters MUST be ignored (falls through), never an error. When the extension block and `traceparent` disagree, the extension block wins with a warning; the trace-id rung remains for callers carrying no extension block. The [D078](DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) env-and-file resolution applies only when no per-request carrier resolved; its internal ordering stays defined by those decisions.

**Receipts.** A server MUST emit the `dev.atrib/attribution` result block only when the requesting client declared the extension on that request (or, on legacy protocol versions, at `initialize`). The receipt names a record the server has already signed locally; its `log_submission` field is a queue status (`queued | submitted | disabled | failed`), never an awaited proof — log submission stays non-blocking per [§5.3.5](#535-log-submission). Signing itself is NOT gated on the client's declaration (per [D100](DECISIONS.md#d100-mcp-middleware-can-sign-without-log-submission), signing does not even require log submission), and the legacy unprefixed result keys continue to be written unconditionally. The optional full `record` body in a receipt is safe by construction: records carry commitments, not payloads, per [§8.3](#83-salted-commitment-posture). Every extension behavior — capability read, ladder resolution, receipt emission — is subject to the [§5.8](#58-degradation-contract) degradation contract: on any failure the tool result is returned byte-identical to passthrough, without the extension block and without error.

Conformance vectors for the settings schemas, gating rule, both ladders, receipt integrity, and degradation are pinned at [`spec/conformance/mcp-extension/`](spec/conformance/mcp-extension/); they compose with the [§1.2.3.1](#1231-multi-producer-chain-composition) corpus at `spec/conformance/1.2.3/multi-producer/`.

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

**Note (relationship to provenance_token):** session*token expresses \_same logical session across trace boundaries* (continuation of one task across multiple OTel context*ids). For \_cross-session causal anchoring* (a new session that descends from a different upstream session, e.g., agent handoff, workflow continuation, webhook reaction), see [§1.2.6](#126-provenance_token) `provenance_token`. The two fields have distinct semantics and MAY coexist on the same genesis record.

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

The transaction event closes the attribution loop: when tool calls converge on a purchase, a `transaction` record anchors the session's graph. This section retains the boundary pieces that stay core: the `transaction` event type itself ([§1.2.4](#124-event_type-values)) and the cross-attestation requirement ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records)).

The per-rail detection hooks, which define what byte pattern in a response constitutes a payment completion for ACP, UCP, x402, MPP, AP2, and a2a-x402, moved to the [atrib Payments Profile §2](docs/payments-profile.md#2-transaction-detection-hooks) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). The profile also carries the linking mechanism (embedding the `context_id` in transaction metadata at checkout initiation) and the SDK detection contract. Rail churn lands in the profile's version history, not this specification's.

#### 1.7.1 ACP (Agentic Commerce Protocol)

_Moved to the [atrib Payments Profile §2.1](docs/payments-profile.md#21-acp-agentic-commerce-protocol) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 1.7.2 UCP (Universal Commerce Protocol)

_Moved to the [atrib Payments Profile §2.2](docs/payments-profile.md#22-ucp-universal-commerce-protocol) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 1.7.3 x402

_Moved to the [atrib Payments Profile §2.3](docs/payments-profile.md#23-x402) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 1.7.4 MPP (Machine Payments Protocol)

_Moved to the [atrib Payments Profile §2.4](docs/payments-profile.md#24-mpp-machine-payments-protocol) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 1.7.5 AP2 and a2a-x402

_Moved to the [atrib Payments Profile §2.5](docs/payments-profile.md#25-ap2-and-a2a-x402) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 1.7.6 Cross-attestation requirement for transaction records

_This subsection is normative._

Transaction records (`event_type = https://atrib.dev/v1/types/transaction`) are the highest-stakes record type in this specification. The [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation is normatively gated on this URI; settlement decisions follow from the records' content. To prevent a single compromised key from fabricating arbitrary transactions, transaction records MUST carry signatures from at least two independent parties.

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

**Record creator signature.** When a transaction record uses `signers[]`, the record's base signature check MUST require at least one valid signer entry whose `creator_key` equals the record's top-level `creator_key`. Other valid signer entries count toward cross-attestation, but they do not validate the record on behalf of its creator.

**Minimum required signers.** atrib's normative minimum is 2 distinct verified signer keys: typically the agent that initiated the transaction and the counterparty (the merchant or settlement party). Duplicate signer entries from the same `creator_key` MUST NOT inflate the verified signer count. Records with fewer than 2 distinct verified signer keys MUST be flagged by verifiers with `cross_attestation_missing: true`.

**Trusted signer composition.** A verified signer key is not necessarily a trusted signer key. The verified signer count above establishes that at least two distinct keys signed the same canonical bytes; it does NOT establish that those keys belong to independent parties the verifier trusts. Two keys an attacker controls satisfy the 2-distinct-verified-key minimum without adding independent authority (a corroboration, or Sybil, posture). A verifier whose threat model requires non-malleable transaction authority MUST require at least 2 distinct verified signer keys that are also members of the verifier's trust set, and MUST NOT treat the verified signer count alone as sufficient. When a verifier is supplied a trust set, it SHOULD surface how many of the distinct verified signer keys are trusted and flag records that meet the verified-key minimum but not the trusted-key minimum. When a verifier is NOT supplied a trust set, it SHOULD surface that trust was not evaluated, so that a consumer gating a consequential action cannot silently read the verified signer count as trusted authority. Like `cross_attestation_missing`, this trust signal MUST NOT by itself invalidate the record; it is consumer-side policy layered on the verified count. The trust-set mechanism is the same `trusted_creator_keys` used by handoff claim verification ([§5.5.5](#555-handoff-claim-verification)). Verified-but-untrusted signer keys are the Sybil channel that a verified count alone does not rule out ([§8.7.2](#872-layered-trust-assessment) Layer 5).

**Counterparty key discovery.** Counterparty keys are discovered out-of-band: via the [§6](#6-key-directory) directory lookup of the merchant's published identity, via payment-protocol-specific channels (x402 facilitator metadata, ACP order envelope, AP2 receipt issuer or verifier key material, and so on), or via consumer-arranged key exchange. atrib does not specify the discovery mechanism; the spec only requires the keys be present in the record.

**Other event types unaffected.** This requirement applies only to `transaction`. tool_call, observation, and extension records continue to use single-signer signatures via the top-level `signature` field.

See [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) for the design rationale and the alternatives considered.

---

### 1.8 Scope Boundaries

_This section is informative._

The following topics are outside the scope of this specification. They are acknowledged here because they affect real-world deployments and inform architectural decisions.

**Cross-session attribution.** When a user receives a recommendation from an agent and subsequently completes a purchase in a browser session (minutes, hours, or days later), the transaction carries no attribution chain. The agent session and browser session are structurally disconnected. A partial mitigation is available via recommendation tokens: opaque identifiers the agent embeds in recommendation URLs, which a merchant can capture on conversion. A first-class solution requires persistent agent identity across sessions.

**Log federation.** All attribution records for a session should be submitted to the same log operator to enable complete graph queries. If contributing tools submit to different log operators, a query against one log will return an incomplete graph. A federation protocol (cross-log inclusion proof pointers) is a natural extension but is not defined here.

**Key rotation.** Key rotation and revocation are normatively specified in [§1.9](#19-key-rotation-and-revocation). Creators rotate keys by submitting a `key_revocation` record with `revocation_reason: 'rotation'` and a `successor_key`; verifiers update accordingly. The directory ([§6](#6-key-directory)) tracks the active key per identity claim.

**Policy and settlement boundaries.** Policy versioning, the dispute mechanism, the settlement webhook format, multi-transaction sessions, and agent-published policies are payments-layer topics. Their scope statements moved to the [atrib Payments Profile §13](docs/payments-profile.md#13-scope-boundaries).

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

| Field                 | Type   | Required                                                                   | Description                                                                                                        |
| --------------------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `revoked_key`         | string | Yes                                                                        | Base64url-encoded 32-byte Ed25519 public key being retired.                                                        |
| `revocation_reason`   | enum   | Yes                                                                        | One of `'rotation'`, `'retirement'`, `'compromise'`.                                                               |
| `successor_key`       | string | When `revocation_reason='rotation'`                                        | Base64url-encoded 32-byte Ed25519 public key of the rotation target.                                               |
| `emergency_signed_by` | string | When `revocation_reason='compromise'` AND signature is by an emergency key | Base64url-encoded 32-byte public key of the emergency key (registered in the directory at the time of compromise). |

Canonical serialization (JCS, [§1.3](#13-canonical-serialization)) places `emergency_signed_by` after `creator_key` and before `revoked_key` in lexicographic order; when the OPTIONAL `delegation_cert_hash` field ([§1.11.5](#1115-run-key-revocation)) is present, the order is `creator_key` < `delegation_cert_hash` < `emergency_signed_by` < `revoked_key`. `revoked_key`, `revocation_reason`, and `successor_key` follow alphabetically.

#### 1.9.2 Signing Rules

A `key_revocation` record MUST be signed by one of:

1. **The key being retired.** The `creator_key` field equals `revoked_key`. This is the standard path for `rotation` and `retirement`. The signing proves the legitimate owner authorized the retirement.

2. **A pre-registered emergency key.** Permitted ONLY when `revocation_reason='compromise'`. The `creator_key` field is the emergency key's public key; `emergency_signed_by` MUST equal `creator_key`. The emergency key MUST have been registered in the directory ([§6](#6-key-directory)) under the same identity claim as `revoked_key` BEFORE the revocation timestamp. This is the only path that survives the case where the legitimate owner has lost access to `revoked_key`.

3. **The principal key of a delegation certificate covering `revoked_key`.** Permitted per [§1.11.5](#1115-run-key-revocation); the record MUST carry `delegation_cert_hash` referencing the certificate, which verifiers MUST resolve before accepting the revoker.

A revocation signed by any other key is invalid and MUST be rejected by verifiers as `'unsigned'`.

#### 1.9.3 Verifier Semantics

When a verifier sees a valid `key_revocation` record at log index `R` retiring `revoked_key`:

- Records with `creator_key === revoked_key` AND `log_index >= R` are flagged `verification_state: 'revoked_after_revocation'`. They MUST NOT contribute to attribution calculations ([payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm)).
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

### 1.10 Per-Conversation Key Derivation (Reserved)

_Reserved for the deferred [D038](DECISIONS.md#d038-per-conversation-key-derivation) HKDF per-conversation key derivation text. No normative content ships in this section; see the V2 deferral list. Derivation and certification ([§1.11](#111-delegation-certificates)) address different problems (cross-session unlinkability vs. scoped ephemeral authority) and are compatible: a derived key could later be certified._

---

### 1.11 Delegation Certificates

_This section is normative; issuing a certificate is OPTIONAL. Per [D140](DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys)._

A **delegation certificate** is a standalone JCS-canonical object in which a *principal* Ed25519 key certifies an ephemeral *run* key with an explicit scope, expiry, and optional session binding. Records signed by the run key occupy the existing `creator_key` slot in both the record ([§1.2.1](#121-field-definitions)) and the 90-byte log entry ([§2.3.1](#231-entry-serialization)) — no format change anywhere. The certificate is verifiable offline from the certificate alone; there is no deterministic linkage from a parent secret and no PKI ([§1.4.1](#141-key-format) posture).

A record signed directly by a principal is **delegation depth 0**: no certificate exists or is needed, and verification is byte-for-byte the [§1.4.3](#143-verification-procedure) procedure. Every record ever signed is therefore already valid under this model, by definition. A record signed by a certified run key is **delegation depth 1**. Delegation never alters signature validity, graph derivation ([§3.2.4](#324-edge-derivation-rules)), or the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation; it is attribution resolution and trust signal, exactly like [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) capability checks.

#### 1.11.1 Certificate Format

A delegation certificate is a JSON object, canonicalized with JCS (RFC 8785, same rules as records per [§1.3](#13-canonical-serialization)):

```jsonc
{
  "cert_type":     "atrib/delegation-cert/v1",           // MUST; literal version discriminator
  "context_id":    "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",   // OPTIONAL; 32 lowercase hex; binds the cert to one session
  "not_after":     1767229200000,                        // MUST; Unix ms; records after this are out-of-window
  "not_before":    1767225600000,                        // OPTIONAL; Unix ms; default 0 when absent
  "principal_key": "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w", // MUST; base64url 32-byte Ed25519 principal public key
  "run_pubkey":    "gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q", // MUST; base64url 32-byte Ed25519 run public key
  "scope":         { "tool_names": ["search", "read_email"], "max_amount": { "currency": "USD", "value": 100 }, "cost_policy": { "model_tiers": ["standard"], "max_tokens": 500000 } }, // OPTIONAL; §6.7.1 capability envelope schema, verbatim
  "signature":     "iMouU-GLdyyISG2S6fRZEEYE5brlP1x6ycuidxY4dIhneSCEKMD_irR3hrHMDg9QfK_2LNct6xPuqm0yQj2pDA" // MUST; Ed25519 by principal_key
}
```

JCS lexicographic field order is exactly as listed: `cert_type` < `context_id` < `not_after` < `not_before` < `principal_key` < `run_pubkey` < `scope` < `signature`. Optional fields MUST be omitted, not null, when absent — presence/absence changes the canonical form and therefore the signature, mirroring the `session_token` rule ([§1.3](#13-canonical-serialization)). The `scope` object reuses the [§6.7.1](#671-identity-claim-extension) capability envelope schema **verbatim** (`tool_names`, `max_amount`, `counterparties`, `event_types`, `cost_policy`, `expires_at`); one schema, two carriers — directory-published (per-key, identity-claim cadence) and certificate-carried (per-run, issuance cadence). When `scope.expires_at` is present, the effective expiry is `min(not_after, scope.expires_at)`.

#### 1.11.2 Signing, Certificate Hash, and Depth

**Signature rule (mirrors [§1.4.2](#142-signing-procedure)):**

```
signature = base64url(Ed25519-sign(principal_seed, UTF-8(JCS(cert with signature field omitted))))
```

**Certificate hash (stable identifier):**

```
cert_hash = "sha256:" + hex(SHA-256(UTF-8(JCS(full signed cert))))
```

The hash is over the *signed* bytes, analogous to `record_hash` ([§1.2.3](#123-chain_root-for-genesis-records)). It is the key used by the [§1.11.3](#1113-the-delegation_cert_hash-field) record field, run-key revocation ([§1.11.5](#1115-run-key-revocation)), sidecars, and archive evidence keys.

A certificate is **valid as delegation evidence** iff: both keys are well-formed per [§1.4.1](#141-key-format); `run_pubkey !== principal_key` (a self-certificate MUST be rejected with error `self_certificate` even when its signature verifies); and the signature verifies under `principal_key` (otherwise error `principal_signature_invalid`). An invalid certificate never invalidates any record; the record falls back to plain attribution to its signing key (depth 0).

**Depth limit.** This version permits depth ≤ 1. `principal_key` MUST NOT itself be a run key under another certificate known to the verifier; a chained certificate is rejected *as delegation evidence* (`delegation_depth_exceeded`) and the record falls back to depth 0. Chains are future work behind their own decision record.

#### 1.11.3 The delegation_cert_hash Field

`delegation_cert_hash` (string, `"sha256:" + 64 lowercase hex`) is a new OPTIONAL field permitted in exactly two positions:

1. **Session genesis records** (same genesis-only discipline as `provenance_token`, [§1.2.6](#126-provenance_token)). It commits the genesis signer's session start to the certificate covering **its own run key**. Non-genesis records MUST NOT carry it in this role; validators ([§2.6.1](#261-submit-entry)) and verifiers ([§5.5](#55-atribverify-merchant-verification-library)) treat a non-genesis occurrence the way they treat a non-genesis `provenance_token`.
2. **`key_revocation` records** ([§1.11.5](#1115-run-key-revocation)), referencing the certificate that proves the principal–run relationship.

In both positions the JCS-canonical form slots the field between `creator_key` (`c-r`) and `event_type` (`e`), consistent with [§1.3](#13-canonical-serialization). Presence/absence changes the canonical bytes: two otherwise-identical records with and without the field carry distinct signatures and distinct record hashes. Existing records never carried the field, so no existing signature is affected; new records that omit it are byte-identical to pre-delegation output.

**Binding scope, single-producer sessions:** for subsequent records signed by the same run key in the same context, the verifier associates them with the genesis commitment through `creator_key` + `context_id` equality and CHAIN_PRECEDES linkage back to the genesis record; `cert_bound` is then evaluable for the whole run.

#### 1.11.4 Verifier Walk

Given record `R` and available certificate set `C`, the walk is offline and deterministic:

1. Verify `R.signature` under `R.creator_key` per [§1.4.3](#143-verification-procedure). **Unchanged; delegation never alters signature validity.**
2. Select certificates `c ∈ C` with `c.run_pubkey === R.creator_key`. No covering certificate → **depth 0**: attribute to `R.creator_key` as today. If `R`'s context genesis (signed by `R.creator_key`) carries `delegation_cert_hash` but no valid covering certificate resolved, surface `delegation_unresolved: true` — signal, not invalidation, the [D113](DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default) posture. A covering certificate that is invalid per [§1.11.2](#1112-signing-certificate-hash-and-depth) is rejected as evidence: the walk reports its `cert_hash`, `cert_valid: false`, and the rejection error, and falls back to depth 0.
3. For a valid matching `c`, evaluate: `(c.not_before ?? 0) <= R.timestamp <= c.not_after` → `in_window`; `c.context_id` absent → `context_bound: null`, else `c.context_id === R.context_id` → `context_bound`; when the context genesis was signed by `R.creator_key` AND carries `delegation_cert_hash`, `genesis.delegation_cert_hash === cert_hash(c)` → `cert_bound`, otherwise `cert_bound: null` (the standing state for run keys that joined a multi-producer context, [§1.11.6](#1116-multi-producer-contexts)).
4. Consult the directory ([§6.3](#63-verifier-consultation-algorithm)) for `c.principal_key`, not the run key. Run keys never enter the directory; the expected lookup result for a run key is a non-membership proof, and a directory claim found *for the run key itself* is surfaced as the structural anomaly `run_key_in_directory: true`.
5. Scope check per [§6.7.2](#672-verifier-semantics) semantics against `c.scope`: `in_scope` with a `mismatches[]` list naming the failed constraints (`tool_names`, `event_types`, `max_amount`, `counterparties`, `cost_policy.model_tiers`, `cost_policy.max_tokens`). `cost_policy` constraints are evaluable only against caller-supplied usage facts per [§6.7.2](#672-verifier-semantics); the record-only walk produces no `cost_policy` mismatch. When the principal's directory envelope is available, `attenuation_ok` reports whether `c.scope` is a subset of it (a certificate granting what the principal's own envelope excludes sets `attenuation_ok: false`); when no directory envelope is supplied, `attenuation_ok` is `null`. All scope outputs are signals, never invalidation, per [§6.7.3](#673-out-of-envelope-is-a-signal-not-invalidation).
6. Revocation: scan for [§1.9](#19-key-rotation-and-revocation) `key_revocation` records retiring either the run key ([§1.11.5](#1115-run-key-revocation)) or the principal. A revoked principal cascades: its certificates are invalid as delegation evidence for records at `log_index >= R` per [§1.9.3](#193-verifier-semantics) semantics.

The verifier output is an optional `delegation` block:

```jsonc
"delegation": {
  "depth": 1,                       // 0 | 1
  "principal_key": "...",           // string | null (null at depth 0)
  "cert_hash": "sha256:...",        // string | null
  "cert_valid": true,               // boolean | null
  "in_window": true,                // boolean | null
  "context_bound": true,            // boolean | null; null when the cert has no context_id
  "cert_bound": true,               // boolean | null; null when no genesis delegation_cert_hash applies to this run key
  "scope_check": { "in_scope": true, "attenuation_ok": null, "mismatches": [] }, // object | null; null when the cert has no scope
  "revoked": false,                 // boolean | null
  "errors": []                      // e.g. "self_certificate", "principal_signature_invalid", "delegation_depth_exceeded"
}
```

At depth 0 every certificate-derived field is `null` and `errors` is empty (unless a covering-but-invalid certificate was rejected, per step 2). No field in this block affects record validity.

**Ambiguity rule.** If two valid certificates from *different* principals cover the same run key in overlapping windows, the verifier MUST surface both and set `delegation_ambiguous: true` rather than choosing. Choosing would be interpretation; surfacing is fact.

**Transaction interaction ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records)).** The ≥2-distinct-verified-keys rule counts raw keys and is unchanged ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)). A new signal, `signers_share_principal: true`, fires when two signer keys resolve to the same principal through certificates; whether policy requires distinct principals is consumer policy, not protocol.

#### 1.11.5 Run-Key Revocation

Run-key retirement reuses [§1.9](#19-key-rotation-and-revocation) rather than minting a parallel mechanism. This section adds **signing rule 3** to [§1.9.2](#192-signing-rules):

3. **The principal key of a delegation certificate covering `revoked_key`.** A `key_revocation` record retiring a run key MAY be signed by the principal: `creator_key` is the principal's public key, and the record MUST carry `delegation_cert_hash` ([§1.11.3](#1113-the-delegation_cert_hash-field)) referencing the certificate that proves the principal–run relationship. Verifiers MUST resolve that certificate — it must be valid per [§1.11.2](#1112-signing-certificate-hash-and-depth), its `run_pubkey` must equal `revoked_key`, and its `principal_key` must equal the record's `creator_key` — before accepting the principal as an authorized revoker. A revocation failing any of these checks is invalid and MUST be rejected per the existing [§1.9.2](#192-signing-rules) rule ("rejected by verifiers as `'unsigned'`"); records signed by `revoked_key` then keep their verification state.

The [§1.9.1](#191-revocation-record-format) canonical-order note extends accordingly: when the field is present the order is `creator_key` < `delegation_cert_hash` < `emergency_signed_by` < `revoked_key`. [§1.9.3](#193-verifier-semantics) applies unchanged to the revoked run key: records at `log_index >= R` flag `revoked_after_revocation`; earlier records keep their state. `revocation_reason` is `'compromise'` for a burned sandbox, `'retirement'` for clean early wind-down; `not_after` expiry remains the primary bound and revocation is the early-kill path. No directory tombstone exists for run keys because run keys are not in the directory; the log is the sole source of revocation truth, as [§1.9.3](#193-verifier-semantics) already states.

#### 1.11.6 Multi-Producer Contexts

Under [§1.2.3.1](#1231-multi-producer-chain-composition) / [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) chain composition, a certified run key routinely joins a context whose genesis record was signed by a *different* producer key. That run key then owns no record permitted to carry `delegation_cert_hash`. For such records the certificate is supplied out-of-band through the [§1.11.8](#1118-carriage) carriers and `cert_bound` remains `null` permanently, while `cert_valid`, `in_window`, `context_bound`, scope checks, and revocation checks are all unaffected. `delegation_cert_hash` is a strengthening bind available exactly to the producer that signs a context's genesis record; it is never a prerequisite for delegation resolution. Producers whose run key joins an existing chain SHOULD set the certificate's `context_id` (giving `context_bound: true`) as the substitute session binding.

#### 1.11.7 Directory Posture

The directory ([§6](#6-key-directory)) maps **principals only**. Run keys MUST NOT be published as identity claims: the directory is bounded by operators, not runs; AKD insertion cost and audit surface do not scale with run cadence; and run-key absence proofs are the expected lookup result. [§6.7.4](#674-envelope-rotation) is unchanged for principals; run scopes never rotate — issue a new certificate instead.

#### 1.11.8 Carriage

Three carriers; any subset is sufficient for a verifier that obtains the certificate somehow, and verifiers additionally accept caller-supplied certificates out-of-band:

1. **Local sidecar:** producers write the full certificate to `_local.delegation_cert` in the mirror envelope ([§5.9.3](#593-the-_local-sidecar-shape)). Signed bytes unchanged; sidecar-only, like `_local.producer`.
2. **Archive evidence:** producers configured for archive submission attach the certificate as an evidence object keyed by `cert_hash` through the [§2.12](#212-record-body-archive-layer) evidence API ([D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)). Certificates contain only public keys, a scope, and timestamps — no salted-commitment exposure concern.
3. **Evidence envelope profile:** the verifier-facing carrier is the **`delegation-certificate`** profile of the [§5.5.7](#557-universal-evidence-envelope) universal evidence envelope (`https://atrib.dev/v1/evidence/delegation-certificate`, the URI that section reserves for this decision). The profile payload is the certificate object (JCS hash rule; `ref.record_hash` never applies — a certificate is not a record) or its `cert_hash` as a payload reference; the profile's verifier facts are the [§1.11.4](#1114-verifier-walk) walk outputs. No legacy [§5.5.6](#556-generic-authorization-evidence-blocks) protocol string exists or may be introduced for delegation; the legacy string set is frozen.

#### 1.11.9 Key Isolation Interaction

[§1.4.6](#146-signing-key-isolation-for-sandboxed-execution) is narrowed as follows: **principal keys MUST NOT be reachable from sandboxed execution, unconditionally. Run-key seeds MAY be provisioned into a sandbox when covered by a delegation certificate whose `not_after`, `scope`, and (RECOMMENDED) `context_id` binding the host accepts for that run.** The in-sandbox key is then worth one scoped, expiring, individually revocable run rather than the operator's durable identity. The signer proxy ([§9.7](#97-pattern-sandboxed-execution-signer-proxy)) remains RECOMMENDED hardening — it uniquely provides a pre-signing host policy gate and prevents mid-window misuse — but is no longer the only conforming topology. This is a deliberate relaxation of the [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) MUST, recorded as a v2 note on that decision.

#### 1.11.10 Producer Requirements

Producers that opt in stamp `delegation_cert_hash` on the genesis record *only when they sign the context genesis* (per [§1.11.6](#1116-multi-producer-contexts), a producer joining an existing chain writes no genesis and stamps nothing), write `_local.delegation_cert`, and include the certificate in archive submission when the archive path is configured. **Degradation ([§5.8](#58-degradation-contract)):** every failure — unreadable certificate, malformed JSON, expired certificate at startup, principal-signature mismatch — is caught, logged with the `atrib:` prefix, and signing proceeds *without* the genesis field. Records remain valid; the verifier simply sees an uncertified run key (`delegation_unresolved` at worst). Delegation failures never block the primary tool call.

#### 1.11.11 Conformance

Implementations MUST pass all vectors in [`spec/conformance/delegation-certificates/`](spec/conformance/delegation-certificates/). The corpus covers six case families: certificate canonical form and signing (full/minimal optional-field forms, self-certificate, wrong-signer), the [§1.11.4](#1114-verifier-walk) verifier walk (valid, expired, scope mismatch as signal, cost-policy scope with pinned usage vectors, wrong principal signature, run-key mismatch with `delegation_unresolved`), depth-0 byte-identity against [`spec/conformance/1.4/signing-vectors.json`](spec/conformance/1.4/signing-vectors.json), `delegation_cert_hash` lex-slotting with distinct signatures for presence vs. absence, run-key revocation extending [`spec/conformance/1.9/`](spec/conformance/1.9/) (authorized rule-3 revocation and the not-covering rejection), and the [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) `cert_bound: null` posture. The generator is `packages/log-dev/scripts/generate-conformance-delegation-certificates.ts`; the reference implementation is `packages/verify/test/conformance-delegation-certificates.test.ts`. Two implementations given the same record and certificate set MUST produce identical `delegation` blocks.

#### 1.11.12 What This DOES NOT Cover

Delegation depth > 1 (chains are rejected with `delegation_depth_exceeded`; future decision record). Principal-level aggregation in the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation (unchanged; a future policy wanting it must take the certificate set as an *explicit input*, preserving the pure-function invariant, behind its own decision record). Graph changes of any kind (no new edge types; nodes remain keyed by `creator_key`; aggregation-by-principal is verifier output and product presentation). Truthfulness: a certificate certifies that a principal authorized a run key, not that the run key's records are honest — the [§8.7](#87-adversarial-threat-model) limit applies in full.

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
  - [2.5.4 Point-lookup endpoint (OPTIONAL)](#254-point-lookup-endpoint-optional)
  - [2.5.5 Recent-records endpoint (OPTIONAL)](#255-recent-records-endpoint-optional)
  - [2.5.6 Log subscription surfaces (OPTIONAL)](#256-log-subscription-surfaces-optional)
- [2.6 Submission API (Write Interface)](#26-submission-api-write-interface)
  - [2.6.1 Submit entry](#261-submit-entry)
  - [2.6.2 Inclusion proof response](#262-inclusion-proof-response)
- [2.7 Inclusion Proof Verification](#27-inclusion-proof-verification)
- [2.8 Proof Bundle Format](#28-proof-bundle-format)
- [2.9 Witnessing and Cosignatures](#29-witnessing-and-cosignatures)
- [2.10 What the Log Stores and What It Does Not](#210-what-the-log-stores-and-what-it-does-not)
- [2.11 Cross-log Replication](#211-cross-log-replication)
- [2.12 Record Body Archive Layer](#212-record-body-archive-layer)

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
| -------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
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

| Byte          | URI                                           | Notes                                                                                                                                                    |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x01`        | `https://atrib.dev/v1/types/tool_call`        | atrib normative                                                                                                                                          |
| `0x02`        | `https://atrib.dev/v1/types/transaction`      | atrib normative                                                                                                                                          |
| `0x03`        | `https://atrib.dev/v1/types/observation`      | atrib normative                                                                                                                                          |
| `0x04`        | `https://atrib.dev/v1/types/directory_anchor` | atrib normative; promoted by [D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)                                  |
| `0x05`        | `https://atrib.dev/v1/types/annotation`       | atrib normative; promoted by [D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)                                        |
| `0x06`        | `https://atrib.dev/v1/types/revision`         | atrib normative; promoted by [D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)                                          |
| `0x07`–`0xFE` | reserved                                      | reserved for future atrib normative additions per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) |
| `0xFF`        | extension URI                                 | URI is in a non-`atrib.dev` namespace; read content                                                                                                      |
| `0x00`        | reserved                                      | MUST NOT be emitted                                                                                                                                      |

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
     "origin": "log.atrib.dev/v1",
     "public_key": "<base64url 32B>",
     "key_id": "<hex 4B>",
     "algorithm": "Ed25519"
   }
   ```

Both endpoints MUST be served from the same signing key, MUST agree on `origin` and `key_id`, and MUST decode to the same 32-byte Ed25519 public key. A verifier MAY use either endpoint. The `key_id` published at either endpoint MUST equal the 4 leading bytes of the base64-decoded signature token on every signature line of `/v1/checkpoint` ([§2.4.3](#243-signed-note-format)).

#### 2.4.3 Signed Note Format

The complete checkpoint (body plus signatures) is a signed note per the C2SP signed-note specification (c2sp.org/signed-note). The note has the checkpoint body as its text, followed by one or more signature lines:

```
log.atrib.dev/v1
4821937
CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=

— log.atrib.dev/v1 base64(keyHash[4B] || Ed25519-signature[64B])
— witness.example.com base64(witness-keyHash[4B] || cosignature[64B])
```

Each signature line begins with `— ` (U+2014 em-dash followed by a space in the canonical format), followed by the key name, a single space, and one base64-encoded token. The token decodes to exactly 68 bytes: the 4-byte key hash defined in [§2.4.2](#242-log-signing-key-and-key-id) (matches the `key_id`) concatenated with the 64-byte Ed25519 signature over the note text (the body including its trailing newline). This is the canonical C2SP signed-note encoding; verifiers using `golang.org/x/mod/sumdb/note.NewVerifier` or compatible tooling parse it directly without an adapter.

Clients MUST verify at least the log's own signature on any checkpoint before trusting it. Cosignatures from witnesses are additional trust anchors; their verification procedure is described in [§2.9](#29-witnessing-and-cosignatures).

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

#### 2.5.4 Point-Lookup Endpoint (OPTIONAL)

Log implementations MAY expose a point-lookup endpoint that returns a single decoded log entry by its `record_hash`. The endpoint is OPTIONAL, verifiers achieve the same result by walking the entry-bundle endpoint ([§2.5.3](#253-entry-bundle-endpoint)), but explorers, identity views, and ad-hoc record-verification flows benefit from a single-record fetch when the implementation provides one. When provided, the endpoint MUST follow the shape below so consumers can rely on a uniform contract across log implementations.

```
GET https://log.atrib.dev/v1/lookup/<record_hash_hex>

// record_hash_hex: 64 lowercase hex characters

Response 200 OK:
Content-Type: application/json

{
  "log_index":      482193,                                  // 0-indexed position in the log
  "record_hash":    "sha256:4797...",                         // canonical sha256 of the signed record
  "creator_key":    "haoZK4...",                             // base64url Ed25519 pubkey
  "context_id":     "b5a2ebf81d43...",                        // 32-hex
  "timestamp_ms":   1778112565186,
  "event_type":     "https://atrib.dev/v1/types/observation", // URI form for full fidelity
  "event_type_byte": 3                                        // numeric byte per §2.3.1
}

Error responses:
- 404 Not Found: no record with the given record_hash exists in the log
- 400 Bad Request: malformed record_hash (not 64 hex characters)
```

The response carries the **decoded 90-byte log entry only** ([§2.3.1](#231-entry-serialization)). It does NOT carry the full canonical record body. The log commits to a hash; the body lives elsewhere by design (see [§2.10](#210-what-the-log-stores-and-what-it-does-not) and [D062](DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)). Consumers needing the body to re-canonicalize and re-verify the signature MUST retrieve it via one of:

1. The producer-local mirror per [§5.9](#59-local-mirror-conventions), if the producer's mirror is reachable.
2. A Record Body Archive Layer per [§2.12](#212-record-body-archive-layer), if one is available for the record's `creator_key` namespace.
3. Any consumer-side index that retained the body during ingest (e.g. graph indexers may cache bodies; this is implementation-specific and not a normative protocol surface).

A log MAY decline to provide this endpoint and respond 404 to all `/v1/lookup/...` requests. Consumers who require single-record fetches against such logs MUST fall back to entry-bundle traversal per [§2.5.3](#253-entry-bundle-endpoint).

#### 2.5.5 Recent-Records Endpoint (OPTIONAL)

Log implementations MAY expose a recent-records endpoint returning the newest N decoded entries in the tree. The endpoint is OPTIONAL, explorers and live-activity feeds benefit from a paginated newest-first feed, but verification does not depend on it. When provided, the endpoint MUST follow the shape below so dashboards can render activity feeds across log implementations uniformly.

```
GET https://log.atrib.dev/v1/recent

// Optional query parameters:
// limit=<n>                         (default: 20, max: 100)
// offset=<n>                        (default: 0; skip the N most-recent)

Response 200 OK:
Content-Type: application/json

{
  "tree_size":  1882,                  // total entries in the log at query time
  "limit":      20,
  "offset":     0,
  "entries": [
    {
      "log_index":     1881,           // newest first
      "record_hash":   "sha256:4797...",
      "creator_key":   "haoZK4...",
      "context_id":    "b5a2ebf81d43...",
      "timestamp_ms":  1778112565186,
      "event_type":    "https://atrib.dev/v1/types/observation"
    }
    // ...
  ]
}

Error responses:
- 400 Bad Request: invalid limit or offset (negative, non-numeric)
```

The response carries a compact per-entry shape (no full `record` object) so a feed of 20 entries stays small. Like [§2.5.4](#254-point-lookup-endpoint-optional), the body is NOT returned, the log only stores the 90-byte commitment. Consumers needing the full record body for any entry retrieve it via the producer-local mirror ([§5.9](#59-local-mirror-conventions)) or a Record Body Archive Layer ([§2.12](#212-record-body-archive-layer)).

A log MAY decline to provide this endpoint and respond 404 to all `/v1/recent` requests. Consumers who require activity feeds against such logs MUST fall back to walking the entry-bundle endpoint and decoding entries client-side.

#### 2.5.6 Log Subscription Surfaces (OPTIONAL)

Log implementations MAY expose subscription surfaces for consumers that need live or periodically refreshed views of new log entries. These surfaces are OPTIONAL. Verification never depends on them; consumers can always fall back to the checkpoint, tile, entry-bundle, lookup, and recent-records endpoints.

When provided, the subscription surfaces operate over the compact decoded log-entry shape from [§2.5.5](#255-recent-records-endpoint-optional). They MUST NOT imply that the log stores signed record bodies. Filters are limited to fields visible in the 90-byte log entry unless the implementation explicitly declares an archive or body-index dependency.

The common filters are:

- `creator_key=<base64url>`: exact Ed25519 public key match.
- `context_id=<32-hex>`: exact session anchor match.
- `event_type=<label-or-uri>`: decoded event-type label or atrib normative event_type URI.
- `since=<timestamp>`: inclusive millisecond timestamp or ISO timestamp.

Filters such as `topic` and `importance` require record-body or annotation-body indexing. A commitment-only log implementation SHOULD reject those filters with `400 Bad Request` rather than silently ignoring them.

##### Server-Sent Events

```
GET https://log.atrib.dev/v1/stream?creator_key=<base64url>&event_type=annotation&since=1778112565186

Response 200 OK:
Content-Type: text/event-stream

event: ready
data: {"tree_size":1882,"filters":{"creator_key":"haoZK4...","event_type":"annotation","since":1778112565186}}

id: 1883
event: log_entry
data: {"tree_size":1884,"entry":{"index":1883,"record_hash":"sha256:4797...","creator_key":"haoZK4...","context_id":"b5a2ebf81d43...","timestamp_ms":1778112567000,"event_type":"annotation","event_type_byte":5}}
```

`id` is the log index of the entry. A client MAY use it as its local checkpoint, but timestamp resume uses the `since` filter. Implementations MAY send comment heartbeats to keep intermediaries from closing idle connections.

##### JSON Feed Companion

```
GET https://log.atrib.dev/v1/feed.json?event_type=transaction&limit=20

Response 200 OK:
Content-Type: application/feed+json

{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "atrib log entries",
  "home_page_url": "https://log.atrib.dev/",
  "feed_url": "https://log.atrib.dev/v1/feed.json?event_type=transaction&limit=20",
  "items": [
    {
      "id": "sha256:4797...",
      "url": "https://log.atrib.dev/v1/lookup/4797...",
      "title": "transaction at log index 1883",
      "content_text": "atrib transaction entry 1883 from haoZK4...",
      "date_published": "2026-05-28T23:58:00.000Z",
      "_atrib": { /* decoded log entry */ }
    }
  ],
  "_atrib": {
    "tree_size": 1884,
    "limit": 20,
    "offset": 0,
    "filters": { "event_type": "transaction" }
  }
}
```

The JSON Feed companion is a pull surface for cron jobs, desktop readers, and hosted consumers that cannot hold a long-lived SSE connection. It follows the same filtering rules as `/v1/stream`.

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

The request body MUST be the bare JCS-canonical signed record exactly as defined in [§1.2](#12-the-attribution-record); there is no enclosing wrapper object, and no field may be added or removed by the client during transport. The body bytes MUST be the same bytes that were signed (modulo whitespace, since `Content-Type: application/json` does not require canonical re-serialization on the wire; it is the receiver's responsibility to re-canonicalize before signature verification per [§1.4.3](#143-verification-procedure)).

`X-atrib-Priority` is an OPTIONAL HTTP-level extension to the wire format. When present, its value MUST be one of `"high"` or `"normal"`. The semantics are:

- `"high"`: the submitting client believes this record is on the critical path of an attribution chain that needs to be queryable promptly (per [§5.3.5](#535-log-submission), transaction records are sent with `priority: "high"` so they are admitted before any pending `tool_call` records when the log's admission queue is congested).
- `"normal"`: best-effort submission. This is the default when the header is absent.

Logs MAY use this header to order admission when their ingestion capacity is finite, but MUST NOT use it to reject entries (a log that consistently rejects "normal" priority submissions is misbehaving). Logs MAY ignore the header entirely. The header is non-normative for log correctness; it is purely an admission-control hint that lets a congested log preserve transaction-record latency under load.

The log MUST perform the following validation before accepting an entry:

Step 1: Verify the attribution record's Ed25519 signature per [§1.4.3](#143-verification-procedure). Reject if verification fails with `400 Bad Request`.

Step 2: Verify that `spec_version` is `"atrib/1.0"`. Reject with `400` if not.

Step 3: Verify that `event_type` is a syntactically-valid absolute URI per [§1.4.5](#145-event_type-uri-validation); the URI need not be in atrib's normative set. Reject with `400` if not.

Step 4: Verify that `timestamp` is not more than 10 minutes in the future (a more permissive window than client-side verification to account for clock skew). Reject with `400` if so.

Step 5: Verify that `context_id` is exactly 32 lowercase hex characters. Reject with `400` if not.

Step 6: Check for a duplicate: if an entry with the same `record_hash` already exists in the log, return the existing inclusion proof with `200 OK` rather than `409 Conflict`. Idempotent submission is required to handle retries safely.

Error responses from the submission API use `Content-Type: application/json` with a JSON object containing an `error` field (string). Example: `{"error": "spec_version must be 'atrib/1.0'"}`. The format is not RFC 9457 Problem Details (that format is reserved for the graph query API, [§3.5.4](#354-error-responses)).

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

Clients MUST verify the inclusion proof before treating the record as committed. The verification procedure is specified in [§2.7](#27-inclusion-proof-verification).

**Security (Do not trust without verification):** A response from the submission API proves only that the log accepted the entry. It does not prove that the log is behaving correctly. Clients MUST verify the checkpoint signature and compute the inclusion proof independently using the tile data to establish that the log has not served a fabricated proof. Trusting unverified inclusion proofs defeats the tamper-evidence property.

---

### 2.7 Inclusion Proof Verification

An inclusion proof demonstrates that a specific entry is at a specific position in the tree described by a checkpoint. Verification is performed locally using only the entry data and the hashes in the proof; no trust in the log server is required beyond the checkpoint signature.

To verify an inclusion proof, an implementation MUST:

Step 1: Verify the checkpoint's Ed25519 signature using the log's published public key ([§2.4.2](#242-log-signing-key-and-key-id)). Reject if verification fails.

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

A checkpoint signed only by the log operator ([§2.4](#24-checkpoint-format)) commits the operator to one (size, root) pair, but proves nothing about the operator's behavior over time. Four threats remain:

1. **Split-view.** A dishonest operator presents one checkpoint to verifier A and a different one to verifier B at the same tree size, then later reconciles which version is "real."
2. **Operator compromise.** An attacker who steals the operator's signing key can produce valid-looking checkpoints that fork the log; verifiers using only the operator's signature have no way to detect the fork.
3. **Infrastructure compromise.** An attacker controlling the operator's hosting provider, DNS, TLS termination, or network path can serve forged checkpoints to specific verifiers without ever touching the operator's signing key. Witnessing addresses this _only when the witnesses run on infrastructure independent from the operator's_; witnesses colocated with the log inherit the same compromise. Witness diversity across hosting providers, network paths, and TLS authorities is what makes this threat expensive to exploit.
4. **Compelled removal.** Legal pressure on a single operator can force removal or rewriting of historical records, with no record of the prior state outside the operator's control. Witnesses in different jurisdictions retain proof of the prior state even if the operator is compelled to drop it.

A **witness** is an independent party that periodically reads the log's checkpoints, verifies that each new checkpoint consistency-extends the previous one (RFC 6962 §2.1.4), and publishes a cosignature attesting to that fact. A verifier requiring N witness cosignatures forces an attacker to compromise the operator AND N witnesses simultaneously to produce a coherent forged history. The strength of the guarantee scales with witness diversity along three axes: distinct _signers_ (defends against threats 1 and 2), distinct _infrastructure_ (defends against threat 3), and distinct _jurisdictions_ (defends against threat 4). A verifier configuring witnesses that share any of these dimensions with each other or with the operator gets weaker guarantees than the cosignature count alone suggests.

#### 2.9.2 Cosignature Format (normative)

A cosignature reuses the C2SP signed-note line shape ([§2.4.3](#243-signed-note-format)) but encodes a 76-byte payload instead of 68. Per c2sp.org/tlog-cosignature:

```
— <witness_name> <base64(keyHash[4B] || timestamp[8B] || sig[64B])>
```

Where:

- `keyHash[4B]` is the witness's 4-byte key hash, computed identically to [§2.4.2](#242-log-signing-key-and-key-id) using the witness's name and public key.
- `timestamp[8B]` is a big-endian uint64 of POSIX seconds at which the witness performed verification.
- `sig[64B]` is the Ed25519 signature over the _cosignature signing input_ (below).

The cosignature signing input is the checkpoint body with a timestamp preamble:

```
cosignature/v1
<decimal seconds, no leading zeros>

<exact bytes of the [§2.4.1](#241-body-structure) checkpoint body, including its trailing newline>
```

Note the second line is the same `<seconds>` value encoded into the timestamp field, in decimal text form. The blank line is mandatory. A verifier reconstructs this input bytewise from the timestamp it extracted from the cosignature line and the checkpoint body it is verifying.

A signature line whose base64 token decodes to 68 bytes is an operator signature ([§2.4.3](#243-signed-note-format)); 76 bytes is a witness cosignature. Verifiers MUST distinguish on decoded length.

#### 2.9.3 Witness Behavior (normative)

A witness MUST:

1. Periodically fetch the log's `/v1/checkpoint` ([§2.5.1](#251-checkpoint-endpoint)) and verify the operator's signature per [§2.4.3](#243-signed-note-format).
2. For each new checkpoint whose tree size exceeds the most recent checkpoint the witness has cosigned, fetch enough tile data ([§2.5.2](#252-tile-endpoints)) to verify a consistency proof from the witness's prior view to the new checkpoint. If the consistency proof fails, the witness MUST NOT cosign and SHOULD log the inconsistency for operator and downstream consumers.
3. Sign the cosignature input ([§2.9.2](#292-cosignature-format-normative)) with its Ed25519 signing key, producing a 76-byte payload.
4. Publish the resulting cosignature line at the URL defined in [§2.9.4](#294-cosignature-delivery-normative).
5. Publish its public key in both C2SP vkey form and JSON form, mirroring the log's `/v1/log-pubkey` and `/v1/pubkey` endpoints ([§2.4.2](#242-log-signing-key-and-key-id)). Verifiers configure trusted witness vkeys the same way they configure the trusted log vkey.

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
3. Verify each fetched cosignature line per [§2.9.2](#292-cosignature-format-normative) with the corresponding witness public key.
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

The operator's line decodes to 68 bytes; each cosignature line decodes to 76 bytes. The verifier independently verifies each line per the appropriate format ([§2.4.3](#243-signed-note-format) for the operator, [§2.9.2](#292-cosignature-format-normative) for cosigs), then applies its threshold to the count and identity of valid cosignatures.

---

### 2.10 What the Log Stores and What It Does Not

_This section is informative._

This section states the privacy properties of the log precisely, because they are the foundation of atrib's claim to be "observability without surveillance."

**The log stores:** the record hash, the creator's public key, the context_id (as raw bytes), the timestamp, and the event type. These are committed in the AtribLogEntry ([§2.3.1](#231-entry-serialization)) and are visible to any party that fetches entry bundles.

**The log does not store:** the content of tool calls, the content of agent responses, the user's identity, the merchant's product data, the amounts of transactions, or any payload that is not listed in the AtribLogEntry structure above.

**What this means in practice:** A party who fetches all entries from the log learns which creator keys were active, in which sessions (context_ids), at what times, and what type of events they recorded. They do not learn what those tools did, what was returned, who the user was, or what was purchased. The attribution graph connects records to transactions only when the merchant writes their own transaction record, and only the merchant knows the transaction details.

The `context_id` is visible in the log and is the same value used in OTel traces. Implementers who wish to prevent correlation between log entries and OTel traces MAY generate a separate log context_id derived from but not equal to the OTel trace-id, at the cost of making independent audit harder. The default is to use the OTel trace-id directly.

**Note (Creator key pseudonymity):** Creator public keys are stable identifiers visible in the log. A party who observes a creator's public key across multiple entries can infer that the same creator was active across those sessions. Creators who require stronger unlinkability across sessions may generate per-session keypairs, but doing so forfeits the ability to accumulate attribution weight under a single identity. This tradeoff is a design choice for each creator, not a protocol decision.

---

### 2.11 Cross-log Replication

_This section is normative; the replication itself is OPTIONAL._

[§2.9](#29-witnessing-and-cosignatures) (witnessing) defends against single-log-operator equivocation at the checkpoint level by requiring multiple operator-independent witnesses to cosign each checkpoint. Witnessing secures the root, not the records the root commits to. A log operator can still selectively censor records (refuse to commit them while returning success), equivocate at the record level when colluding with witnesses, or lose data after commitment.

The strongest defense against operator-level threats is independent replication: the same record committed to multiple operator-independent logs, with verifiers consulting more than one. This is how Certificate Transparency works in practice. atrib has the same threat model and benefits from the same defense.

#### 2.11.1 Replication is optional

Records MAY be replicated to multiple atrib-conformant logs. There is no protocol-level mandate. Single-log deployments remain valid and produce conforming records. Cross-log replication is a robustness enhancement consumers adopt as their threat model requires.

#### 2.11.2 Submission produces independent inclusion proofs

Logs do not coordinate. Each log treats a replicated submission as a fresh entry and returns its own checkpoint and inclusion proof. The submitter collects the proofs from all logs they replicated to.

#### 2.11.3 Proof bundle format extension

The proof bundle ([§2.8](#28-proof-bundle-format)) MAY carry a list of `(log_id, checkpoint, inclusion_proof)` tuples instead of a single tuple. Format:

```jsonc
{
  "record_hash": "sha256:...",
  "log_proofs": [
    {
      "log_id": "log.atrib.dev", // [§2.4](#24-checkpoint-format) origin string
      "checkpoint": "...", // C2SP-canonical signed note
      "inclusion_proof": ["sha256:...", "..."], // RFC 6962 inclusion proof
    },
    {
      "log_id": "log.example.com",
      "checkpoint": "...",
      "inclusion_proof": ["sha256:...", "..."],
    },
  ],
}
```

A bundle with a single `log_proofs` entry is equivalent to the legacy single-log bundle format; the array form is the canonical form when multiple logs are involved. Elements MAY carry an OPTIONAL `anchor_type` discriminator identifying non-atrib-log anchors; see [§2.11.9](#2119-log_proofs-element-discriminator).

#### 2.11.4 Verifier-side threshold and equivocation detection

A verifier configured with a list of trusted log operators (the "trusted set") and a threshold M (the minimum number of trusted-set proofs required) MUST:

1. Validate each `(log_id, checkpoint, inclusion_proof)` tuple in the bundle independently against [§2.7](#27-inclusion-proof-verification). For each tuple: confirm the `log_id` matches the issuing log's published origin, verify the checkpoint signature, and verify the inclusion proof against the checkpoint root for the bundle's `record_hash`.
2. Count the number of tuples whose `log_id` appears in the trusted set AND whose proof verifies. Call this V.
3. If V < M, reject the record with `cross_log_threshold_not_met: true`.
4. **Equivocation detection.** For each pair of distinct logs (A, B) in the trusted set that returned proofs in this bundle: compare the leaf bytes the inclusion proof was computed against. The leaf bytes are deterministic from the record_hash per [§2.3](#23-log-entry-format) (90-byte AtribLogEntry containing record_hash, creator_key, context_id, timestamp_ms, event_type byte). If logs A and B return different leaf bytes for the same `record_hash`, the verifier MUST reject the record with `cross_log_equivocation_detected: true` and surface `(log_id_A, leaf_bytes_A, log_id_B, leaf_bytes_B)` for each disagreeing pair. Equivocation can ALSO be detected when one log returns a valid proof and another returns a "record not found" response within the bundle's epoch window: this is censorship-shaped equivocation and MUST be flagged as `cross_log_censorship_suspected: true` with the silent log identified.

The default M=1 preserves single-log behavior. Consumers wanting cross-log confidence configure M ≥ 2 and a trusted set of independently-operated logs.

#### 2.11.5 Log identity

Each log publishes a stable `log_id` derived from its origin string per [§2.4](#24-checkpoint-format). Verifiers cross-reference the identifier against their trust configuration. Adding a log to the trusted set is an out-of-band consumer policy decision; atrib does not maintain a central registry of trusted logs.

#### 2.11.6 What replication does and does not defend against

**Defends against:** single-log-operator censorship, single-log-operator equivocation (when at least one cooperative log retains the record), single-log data loss, single-log compromise.

**Does NOT defend against:** collusion across all logs in the trusted set (consumer is responsible for picking logs operated by independent parties with different incentives); submission-time censorship by some logs (threshold M handles this gracefully); record-level retroactive removal across all logs (no defense if all logs comply).

See [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) for the design rationale and the alternatives considered.

#### 2.11.7 Anchors: generalizing the replication target

_This section is normative; anchoring beyond a single log remains OPTIONAL at the protocol level._

The thing a verifier needs from a second log ([§2.11.1](#2111-replication-is-optional)) is not another atrib log. It is any independently operated service that can prove a hash existed no later than a stated time. This section generalizes the replication target from "atrib-conformant log" to **anchor**.

An **anchor** is a service that:

- (a) accepts a 32-byte SHA-256 hash,
- (b) later yields a proof that the hash existed no later than an attested time, and
- (c) whose proof is verifiable offline by a pure function `(proof, record_hash, trust_material) → { valid, anchored_at_ms | null, pending }` — no network calls, no wall clock, no randomness, the same determinism discipline as [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm). Two verifier runs on an identical bundle and trust configuration MUST produce identical output.

atrib log-nodes are the richest conforming anchor: they provide inclusion, in-log ordering, and the read surfaces of [§2.5](#25-tile-api-read-interface). Sigstore Rekor, RFC 3161 timestamping authorities, and OpenTimestamps conform with existence-by-time semantics only. That weaker guarantee is sufficient for the plurality property: a verifier holding one atrib-log proof plus one independent existence-by-time proof no longer terminates its trust claim at a single operator.

**No signed byte changes.** Attribution records ([§1.3](#13-canonical-serialization)), the 90-byte log entry ([§2.3.1](#231-entry-serialization)), and checkpoints ([§2.4](#24-checkpoint-format)) are untouched by anchoring. Proof bundles are post-signing artifacts stored alongside records ([§2.8](#28-proof-bundle-format)). Anchoring is also permissionless and post-hoc: any party — producer, host, or third party — MAY anchor an existing `record_hash` to an additional anchor at any time and append the proof to the bundle, without access to the record's signing key ([§2.11.10](#21110-the-anchoring-signature-claim-artifact)).

Anchor plurality is a producer-side configuration posture ([§2.11.12](#21112-producer-side-anchor-posture)) and a verifier-side tier ([§2.11.11](#21111-anchor-independence-and-the-anchor_plurality-annotation)). It is never a protocol mandate, never a gate on the primary tool call or response ([§5.8](#58-degradation-contract)), and never a synchronous wait before returning a response ([§5.3.5](#535-log-submission)). Single-anchor bundles — including every bundle issued before this section existed — remain valid without re-issuance, ever.

#### 2.11.8 Anchor type registry

An anchor type registration defines four things:

| Field | Meaning |
| --- | --- |
| `anchor_type` | Stable string identifier (registry below) |
| Anchored message | Exactly which bytes the proof commits to, derived deterministically from `record_hash` |
| Proof payload schema | The fields inside the bundle element's `proof` object ([§2.11.9](#2119-log_proofs-element-discriminator)) |
| Verification function | The pure function of [§2.11.7](#2117-anchors-generalizing-the-replication-target)(c) |

Initial registry (v1):

| `anchor_type` | Anchored message | Proof payload | Trust material | Time semantics |
| --- | --- | --- | --- | --- |
| `atrib-log` (default when absent) | 90-byte AtribLogEntry ([§2.3.1](#231-entry-serialization)) embedding `record_hash` | existing `checkpoint` + `inclusion_proof` per [§2.11.3](#2113-proof-bundle-format-extension), verified per [§2.7](#27-inclusion-proof-verification) | log public key ([§2.4.2](#242-log-signing-key-and-key-id)) | checkpoint time + in-log ordering |
| `sigstore-rekor` | `rekord`-type entry over the anchor-claim artifact ([§2.11.10](#21110-the-anchoring-signature-claim-artifact)), carrying a fresh anchoring signature | `entry_uuid`, `log_index`, `entry_body_b64`, `inclusion_proof`, `checkpoint`, `integrated_time_ms`, `signed_entry_timestamp_b64` | Rekor instance public key | `integrated_time` |
| `rfc3161-tsa` | `messageImprint.hashedMessage` = the raw 32 `record_hash` bytes, `hashAlgorithm` = SHA-256 | `timestamp_token_b64` (DER TimeStampToken), `hashed_message_hex`, `gen_time_ms` | TSA certificate chain / root | `genTime` |
| `opentimestamps` | the raw 32 `record_hash` bytes as the OTS commitment input | `ots_b64` (serialized `.ots` proof), `commitment_hex`, `status: "complete" \| "pending"`, `attested_time_ms` when complete | Bitcoin block headers (via any header source the verifier trusts) | attested block time |

Unknown `anchor_type` values MUST be surfaced by verifiers (in `unknown_types`, [§2.11.11](#21111-anchor-independence-and-the-anchor_plurality-annotation)) but MUST NOT count toward plurality and MUST NOT be treated as invalidating the bundle or the record — the same forward-compatibility rule as unknown event types ([§1.2.4](#124-event_type-values)).

A `pending` proof (an OpenTimestamps attestation awaiting Bitcoin confirmation) is carried in the bundle and upgraded in place later. Proof bundle caching stays keyed by `record_hash` per [§5.3.5](#535-log-submission); that keying is what makes in-place upgrade safe.

#### 2.11.9 log_proofs element discriminator

The `log_proofs` array of [§2.11.3](#2113-proof-bundle-format-extension) is the wire shape for all anchors. Elements gain an OPTIONAL `anchor_type` discriminator:

```jsonc
{
  "record_hash": "sha256:...",
  "log_proofs": [
    // legacy element, no discriminator ⇒ anchor_type "atrib-log"; parses exactly as today
    {
      "log_id": "log.atrib.dev", // [§2.4](#24-checkpoint-format) origin string
      "checkpoint": "...", // C2SP-canonical signed note
      "inclusion_proof": ["...", "..."], // RFC 6962 inclusion proof, base64 per [§2.6.2](#262-inclusion-proof-response)
    },
    // non-tlog anchor element
    {
      "anchor_type": "rfc3161-tsa",
      "anchor_id": "freetsa.org", // stable anchor identity, the role log_id plays for logs
      "proof": {
        "timestamp_token_b64": "MIIC...",
        "hashed_message_hex": "c09397f4...",
        "gen_time_ms": 1782864031000,
      },
    },
    {
      "anchor_type": "opentimestamps",
      "anchor_id": "opentimestamps-calendars",
      "proof": { "ots_b64": "AE9w...", "commitment_hex": "c09397f4...", "status": "pending" },
    },
  ],
}
```

Rules:

- (a) `anchor_type` absent ⇒ the element is an `atrib-log` proof; the legacy `(log_id, checkpoint, inclusion_proof)` triple is REQUIRED and a `proof` object is forbidden. Every existing bundle parses unchanged, byte-for-byte.
- (b) `anchor_type` present and ≠ `"atrib-log"` ⇒ `anchor_id` and `proof` are REQUIRED.
- (c) The array key stays `log_proofs`. Renaming it would break every existing bundle parser for zero semantic gain; the name is a historical artifact and is documented as such.
- (d) Elements are unordered.
- (e) An element violating rule (a) or (b) is **malformed**: verifiers MUST exclude it from every count except `proof_count` / `malformed_count` and MUST NOT treat its presence as invalidating the bundle or the record.

#### 2.11.10 The anchoring-signature claim artifact

Anchor types whose upstream service requires a signed artifact (Sigstore Rekor's `rekord` type) MUST anchor a fresh **anchor-claim artifact**, never the record's own `signature`. The artifact is the UTF-8 bytes of:

```
"atrib-anchor/v1:" + record_hash
```

where `record_hash` is in its canonical `"sha256:" + 64-lowercase-hex` form ([§1.2.3](#123-chain_root-for-genesis-records)). The artifact is deterministically reconstructible from `record_hash` alone and reveals nothing beyond the commitment itself, preserving the [§8.3](#83-salted-commitment-posture) posture. The `atrib-anchor/v1:` prefix domain-separates the anchoring signature from any canonical record (JCS records begin with `{`; the prefix makes the separation explicit rather than structural).

The anchoring party signs the artifact bytes with its own Ed25519 key — a **fresh anchoring signature**. The anchoring key MAY be the record's `creator_key` or any third party's key, since anchoring is permissionless ([§2.11.7](#2117-anchors-generalizing-the-replication-target)).

**The record's own `signature` MUST NOT be reused as the anchoring signature.** The digest path (a Rekor `hashedrekord` entry with `data.hash` = `record_hash` and the record's signature) is cryptographically unimplementable, twice over:

1. `record_hash` is computed over the JCS canonicalization of the COMPLETE record INCLUDING the `signature` field ([§1.2.3](#123-chain_root-for-genesis-records) normative clarification), while the signature verifies over the signature-less canonical form ([§1.4.2](#142-signing-procedure)). The two byte strings differ, so an upload-time check that the signature verifies over the artifact behind `data.hash` fails by construction.
2. atrib signatures are Pure EdDSA (RFC 8032 §5.1.6, no prehashing), which cannot be verified from a digest alone regardless.

Verification of a `sigstore-rekor` element: reconstruct the anchor-claim artifact from the bundle's `record_hash`; confirm the entry body's artifact content matches the reconstruction and carries the prefix; verify the embedded Ed25519 anchoring signature over the artifact bytes; verify the inclusion proof against the checkpoint and the signed entry timestamp against the Rekor instance key. An entry whose artifact does not reconstruct from the bundle's `record_hash` is an **invalid proof** — not counted, not equivocation — even when its embedded signature is genuinely valid over its own (mismatched) artifact.

The conformance corpus ([§2.11.13](#21113-conformance)) pins both directions: a fully verifying anchor-claim vector and a vector demonstrating that the record's signature verifies over the signing input but NOT over the bytes behind `record_hash`.

#### 2.11.11 Anchor independence and the anchor_plurality annotation

Two verified anchors are **independent** iff they fall in different operator groups. The verifier's trust configuration maps `(anchor_type, anchor_id)` → operator group; the default grouping is one group per distinct `(anchor_type, anchor_id)` pair. Two atrib log-nodes run by the same operator MUST be declared as one group by that operator's consumers; atrib maintains no central registry (same posture as [§2.11.5](#2115-log-identity)). `independent_count` counts distinct groups among verified, non-pending proofs — mirroring [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)'s distinct-verified-keys counting rule.

When a proof bundle is supplied, verifiers populate an `anchor_plurality` annotation:

```jsonc
"anchor_plurality": {
  "proof_count": 3,               // elements in log_proofs
  "verified_count": 2,            // proofs whose pure-function verification passed
  "pending_count": 1,             // e.g. OTS status "pending"; not counted as verified
  "malformed_count": 0,           // rule (a)/(b) violations per [§2.11.9](#2119-log_proofs-element-discriminator)
  "unknown_types": [],            // surfaced, not counted, not invalidating
  "independent_count": 2,         // distinct operator groups among verified
  "plurality_met": true,          // independent_count >= requiredAnchors (verifier option, default 2)
  "single_anchor": false,         // tier flag: independent_count == 1
  "equivocation_detected": false,
  "anchored_at_range_ms": [1782864001000, 1782864031000]  // min/max attested times among verified anchors; null when none carry a time
}
```

**Anchor count 1 is a tier, not a failure.** A record whose bundle yields `independent_count: 1` verifies as valid with `single_anchor: true` and `plurality_met: false` — signal not block, exactly like `cross_attestation_missing` ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) and `in_envelope: false` ([D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)). No bundle at all ⇒ `anchor_plurality: null`; unanchored records are already a legitimate state.

Hard rejection remains reserved for the [§2.11.4](#2114-verifier-side-threshold-and-equivocation-detection) conditions, unchanged: consumer-configured threshold M not met (`cross_log_threshold_not_met`, M still defaults to 1) and equivocation detection (`cross_log_equivocation_detected`; censorship-shaped disagreement is flagged as `cross_log_censorship_suspected` with the silent log identified). Threshold and tiering are orthogonal: a bundle can satisfy `plurality_met: true` and still be rejected by a consumer's M, and vice versa. Equivocation checks apply per pair: two `atrib-log` proofs compare committed leaf bytes exactly as [§2.11.4](#2114-verifier-side-threshold-and-equivocation-detection) step 4 specifies; any anchor whose proof does not bind the bundle's `record_hash` (a TSA token whose `hashedMessage` differs, a Rekor entry whose artifact does not reconstruct) is simply an invalid proof, not counted and not equivocation. Time-window disagreement across anchors is informational (`anchored_at_range_ms`), never a rejection — anchors legitimately attest at different times.

Fact/policy separation holds ([§3.6](#36-implementation-notes)): anchors and their verification live entirely in proof bundles and verifier annotations. Nothing enters the graph layer ([§3](#3-graph-query-interface)); no graph endpoint returns anchor-weighted or anchor-interpreted data. What a consumer does with `single_anchor: true` is consumer policy.

#### 2.11.12 Producer-side anchor posture

Producers accept an anchor configuration:

```jsonc
{
  "anchors": [
    { "anchor_type": "atrib-log", "url": "https://log.atrib.dev/v1" },
    { "anchor_type": "opentimestamps", "calendars": ["https://a.pool.opentimestamps.org"] }
  ],
  "allow_single_anchor": false   // default
}
```

Resolution precedence, exact:

1. No anchor config at all ⇒ the SDK's built-in default set (two independent anchors) applies. Zero-config producers get plurality without opting in.
2. Explicit config with ≥ 2 entries ⇒ used as given.
3. Explicit config with 1 entry and `allow_single_anchor: true` ⇒ used as given, no warning — the deliberate-single-anchor analog of a deliberate dangling `informed_by` claim per [D113](DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default).
4. Explicit config with fewer than 2 entries and no flag ⇒ an `atrib:`-prefixed warning naming the missing plurality, plus a sidecar degradation marker `_local.anchor_config = { configured: <n>, allow_single_anchor: false }` ([§5.9.3](#593-the-_local-sidecar-shape)). The operation continues. This path MUST NOT throw into the primary path and MUST NOT disable signing ([§5.8](#58-degradation-contract)).

Submission fan-out is per-anchor fire-and-forget with independent retry queues. Anchoring MUST NOT be awaited before returning a response ([§5.3.5](#535-log-submission)). A fully failed anchor degrades the bundle to whatever proofs arrived; the record itself — signed, mirrored, returned to the caller — is unaffected. The `atrib-log` anchor keeps today's exact submission path ([§2.6.1](#261-submit-entry)); non-tlog adapters are additive clients. Anchor plurality can only ever add proofs; it can never block a tool call, a response, or a signature.

#### 2.11.13 Conformance

The anchor-interface conformance corpus lives at [`spec/conformance/2.11/anchors/`](spec/conformance/2.11/anchors/) (fixtures + manifest), generated deterministically by `packages/log-dev/scripts/generate-conformance-anchors.ts` with a reference implementation at `packages/verify/test/conformance-anchors.test.ts`. The thirteen cases pin: legacy absent-discriminator parsing, the [§2.11.9](#2119-log_proofs-element-discriminator) malformation rules, unknown-type forward compatibility, plurality tiering (including pending-proof exclusion and in-place upgrade), operator-group independence, the [§2.11.10](#21110-the-anchoring-signature-claim-artifact) anchor-claim artifact with real Ed25519 anchoring signatures and the digest-path impossibility vector, the unchanged [§2.11.4](#2114-verifier-side-threshold-and-equivocation-detection) hard conditions, and the [§2.11.12](#21112-producer-side-anchor-posture) resolution rules. All record signatures, anchoring-claim signatures, signed-note checkpoints, and RFC 6962 inclusion proofs in the corpus are real; the RFC 3161 and OpenTimestamps payload interiors are structural in the initial corpus revision (the commitment-binding fields are real record hashes), with full per-type cryptographic vectors as a planned extension. Implementations MUST reproduce the expected `anchor_plurality` annotation for every case and MUST produce identical output across repeated runs on identical input.

---

### 2.12 Record Body Archive Layer

The atrib log commits to a record's hash. The signed canonical record body lives separately by design ([§2.10](#210-what-the-log-stores-and-what-it-does-not), [§2.3](#23-log-entry-format)). This separation preserves the salted-commitment privacy posture ([§8.3](#83-salted-commitment-posture)) and bounds the log's storage cost. It also creates a verifiability question: a verifier holding the public commitment cannot re-canonicalize the record and re-check its signature without obtaining the body from somewhere.

This section specifies the OPTIONAL **Record Body Archive Layer**: a content-addressed durability layer for canonical record bodies, separate from the log. The archive is what closes the verifiability loop for records whose privacy posture admits public-body retrieval. Records using the salted-commitment posture ([§8.3](#83-salted-commitment-posture)) deliberately do NOT submit bodies to any archive; their verifiability story is producer-local.

The archive ADR is [D070](DECISIONS.md#d070-record-body-archive-layer); this section establishes the spec-level surface and contract.

#### 2.12.1 Architectural position

The archive is a **separate service** from the public log. It MUST NOT be collapsed into the log operator's surface, preserving this separation is what keeps [§2.3.1](#231-entry-serialization)'s commitment-only guarantee intact and lets [§8.3](#83-salted-commitment-posture) producers participate without leaking bodies. An archive operator MAY also run a log; they are distinct services with distinct trust models.

The protocol does not mandate a single archive. Multiple archives MAY mirror the same record set; consumers MAY query any archive that purports to hold a given record. Bodies are content-addressed (each body's canonical hash matches the public log's `record_hash`), so any archive serving a record body is verifiable against the log without trusting the archive operator beyond the question "do you have this record."

#### 2.12.2 Submission model

Producers MAY submit a record body to one or more archives at the same time as committing the record's hash to the log. Submission to the archive is OPTIONAL at the protocol level. A producer's archive policy is per-record: producers MAY submit some records' bodies and not others (e.g., submit `tool_call` bodies but withhold `observation` bodies that contain sensitive content; in the latter case the producer typically also uses the salted-commitment posture per [§8.3](#83-salted-commitment-posture)).

Submission is content-addressed and idempotent: re-submitting an already-archived body MUST be a 200 success, not a 4xx duplicate. The archive validates submissions by canonicalizing the body, computing its `record_hash`, and confirming the same hash is present in at least one log the archive trusts (preventing archives from being used as garbage stores for bodies whose hashes have never been committed anywhere).

Reference producers SHOULD submit to archives after the log accepts the record and returns an inclusion proof when that proof is available. This keeps archive submission optional and best-effort while letting the archive validate the submitted body against a committed log entry immediately. Producers that stage archive submission before proof availability MUST still tolerate archive rejection and retry later with proof or other trusted log evidence.

The V1 submission API is:

```
POST https://archive.atrib.dev/v1/records
Content-Type: application/json

{
  "record_hash": "sha256:...",              // optional, checked if present
  "record": { /* full AtribRecord per §1.2, including signature */ },
  "proof": { /* optional §2.8 proof bundle from a trusted log */ },
  "log_proofs": [ /* optional §2.8 proof bundles */ ],
  "authorizationEvidence": [ /* optional §5.5.6 verifier inputs */ ],
  "evidence": [ /* optional precomputed §5.5.6 result blocks */ ],
  "resolvedFacts": { /* optional §6.7 local facts */ }
}

Response 201 Created:
{
  "record_hash": "sha256:...",
  "record": { /* full AtribRecord */ },
  "log_proofs": [],
  "evidence": [],
  "resolved_facts": {},
  "archived_at_ms": 1700000000000,
  "retention_window_ms": 31536000000
}
```

`authorizationEvidence` is a submission-time convenience for producers that already have local sidecar evidence. The archive MAY verify it into public `evidence[]` result blocks on retrieval. Raw bearer tokens MUST NOT be required for this path and SHOULD NOT be submitted.

When the evidence source is a producer-local sidecar ([§5.9.3](#593-the-_local-sidecar-shape)), producers SHOULD project only verifier evidence and resolved facts into archive submissions. Local-only raw `args`, `result`, or private reasoning payloads SHOULD remain in the producer mirror unless the record's privacy posture explicitly permits public body disclosure.

#### 2.12.3 Retrieval API

```
GET https://archive.atrib.dev/v1/record/<record_hash_hex>

// record_hash_hex: 64 lowercase hex characters

Response 200 OK:
Content-Type: application/json

{
  "record": { /* full AtribRecord per §1.2, including signature */ },
  "log_proofs": [ /* optional: §2.8 proof bundle entries from logs the archive trusts */ ],
  "evidence": [ /* optional §5.5.6 result blocks */ ],
  "resolved_facts": { /* optional §6.7 local facts */ },
  "archived_at_ms": 1700000000000,
  "retention_window_ms": 31536000000
}

Response 404 Not Found:
{ "error": "not archived", "record_hash": "sha256:..." }

Response 410 Gone:
{
  "error": "retention expired",
  "record_hash": "sha256:...",
  "retention_window_ms": 31536000000,
  "archived_at_ms": 1700000000000,
  "expired_at_ms":  1731536000000
}
```

`410 Gone` is distinct from `404 Not Found`: `410` means "the body was archived and has been deleted per retention policy"; `404` means "this body was never archived here." Verifiers that see `410` from one archive MAY query other archives; verifiers that see `404` across all known archives know the body is producer-local-only.

The returned `record` is verified the same way regardless of source: re-canonicalize via [§1.3](#13-canonical-serialization), re-hash, compare against the log commitment, then re-verify the signature per [§1.4](#14-signing-and-verification). The archive cannot fabricate bodies; it can only suppress them.

Explorers and lightweight clients that only need verifier evidence MAY call:

```
GET https://archive.atrib.dev/v1/evidence/<record_hash_hex>

Response 200 OK:
{
  "record_hash": "sha256:...",
  "record_summary": {
    "creator_key": "...",
    "context_id": "...",
    "event_type": "...",
    "timestamp": 1700000000000,
    "content_id": "sha256:..."
  },
  "evidence": [ /* §5.5.6 result blocks */ ],
  "resolved_facts": {},
  "archived_at_ms": 1700000000000,
  "retention_window_ms": 31536000000
}
```

This endpoint is a projection of the archived body and sidecar evidence. It does not change the public log lookup contract.

#### 2.12.4 Retention manifest

Each archive operator MUST publish a retention manifest stating its commitment:

```
GET https://archive.atrib.dev/v1/retention

{
  "operator":          "archive.atrib.dev",
  "minimum_window_ms": 31536000000,                  // 1 year, MUST hold every body at least this long
  "best_effort":       "forever",                    // OR a numeric window, OR null
  "archived_after_ms": 1735689600000,                // bodies submitted before this time MAY be 410'd
  "policy_url":        "https://archive.atrib.dev/policy"
}
```

The manifest is a public commitment by the operator. Operators MAY publish a stronger commitment than `minimum_window_ms`; operators MUST NOT publish a weaker one without a transition window during which both old and new manifests are honored for already-archived bodies.

#### 2.12.5 Federation

Multiple archives MAY mirror the same body set. The protocol contract that makes this work is content-addressing: a record body retrieved from archive A has the same bytes as the same body from archive B (any difference is a hash mismatch, which is trivially detectable and rejects the differing body). Federation requires:

1. **Submission to multiple archives is allowed.** Producers MAY submit the same body to multiple archives, each independently. There is no protocol-level archive registry.
2. **Cross-archive sync is implementation-defined.** Archives MAY pull from each other or share a common backing store; the protocol does not mandate a sync mechanism.
3. **Verifier queries multiple archives.** Consumers MAY treat an archive set the same way [§2.11](#211-cross-log-replication) treats a trusted log set: query M archives, accept any body whose hash matches the log commitment, treat consistent `404` from all M as "body unavailable."

A V1 deployment MAY ship with a single archive (`archive.atrib.dev`); the API contract is shaped so federation is additive when consumer demand for it appears.

#### 2.12.6 Trust model

What an archive can do:

- **Suppress bodies** (return 404 or 410 for records it should hold). Mitigation: federation; verifier policy that requires M archives.
- **Lie about retention** (claim a window in the manifest, then delete earlier). Mitigation: signed retention checkpoints (a future ADR may specify [§2.4](#24-checkpoint-format)-shaped checkpoints for archive retention, mirroring the log's tree-state checkpoints).

What an archive cannot do:

- **Fabricate bodies.** Bodies are content-addressed; any returned body's hash must match a log commitment, or a verifier rejects it on hash mismatch.
- **Replace bodies retroactively.** Same: content-addressed, hash mismatch.
- **Forge submissions.** Each archive validates that submitted bodies have a corresponding committed log entry before accepting (enforced at submission time per [§2.12.2](#2122-submission-model)).

#### 2.12.7 Tiered verifiability

The archive layer enables a three-tier verifiability story for any committed record:

| Tier                             | What it proves                                   | What it requires                                                                                             | Privacy posture                                                                              |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **1: Commitment**                | The record hash existed at time T                | Public log + checkpoint signature ([§2.4](#24-checkpoint-format))                                            | Compatible with all postures, including [§8.3](#83-salted-commitment-posture)                |
| **2: Body retrieval**            | The actual canonical bytes the hash commits to   | Body from producer mirror ([§5.9](#59-local-mirror-conventions)) OR archive ([§2.12.3](#2123-retrieval-api)) | Producer-local body works for all postures; archive body requires producer to have submitted |
| **3: Signature re-verification** | The body was signed by the claimed `creator_key` | Body (Tier 2) + Ed25519 verification ([§1.4](#14-signing-and-verification))                                  | Same as Tier 2                                                                               |

A verifier presented with only Tier 1 can prove "a record existed"; Tiers 2 + 3 prove "this is the record." Tools that depend on full verification (e.g., the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation algorithm) require all three tiers. Tools that only need existence proof (e.g., audit-log replay, anomaly detection over event-type byte distributions) can operate at Tier 1 alone.

#### 2.12.8 Conformance

Archive operators implementing this section:

- MUST expose `/v1/record/<record_hash_hex>` with the response shape in [§2.12.3](#2123-retrieval-api).
- MUST expose `/v1/evidence/<record_hash_hex>` with the projection shape in [§2.12.3](#2123-retrieval-api).
- MUST expose `/v1/retention` with the manifest shape in [§2.12.4](#2124-retention-manifest).
- MUST expose `POST /v1/records` with the submission shape in [§2.12.2](#2122-submission-model).
- MUST validate submitted bodies against at least one log's commitment before accepting.
- MUST honor the `minimum_window_ms` retention they publish.
- MAY decline to archive any specific submission with a documented error response.

The retrieval, evidence-projection, retention, and uncommitted-record cases are covered by `spec/conformance/2.12/`.

---

## §3 Graph Query Interface

_Nine edge types. Deterministic derivation. Fact layer only._

The data model and query API for turning attribution records into a structured provenance graph, the input to policy evaluation and settlement calculation.

### What atrib chains, what it does not

atrib's graph certifies five structural axes of agent activity:

1. **Identity-of-record** (signature): the holder of a `creator_key` signed this record.
2. **Per-session ordering** (chain_root pointing at the parent record's hash): this record came after that one in the same session, and no records were inserted or removed between them.
3. **Cross-session sameness** (session_token via CROSS_SESSION): these records belong to the same logical session across OTel trace boundaries.
4. **Cross-session causal anchoring** (provenance_token via PROVENANCE_OF): this record's action descends from that upstream anchor ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)).
5. **Agent-claimed reasoning composition** (informed_by via INFORMED_BY): the agent claims these specific prior records informed this action ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)).

atrib does NOT certify:

- That a referenced record's _content_ actually influenced the agent's decision. The chain proves precedence; the agent could have ignored the referenced record entirely.
- That the agent's reasoning is truthful. A signed `informed_by` claim proves the agent committed to the claim; it does not prove the agent reasoned this way.
- That a tool's response was real, absent tool-side attestation. `result_hash` is the agent's claim about what the tool returned; tool-side response signing closes this gap when needed ([§7.6](#76-outcome-verification-patterns)).

These limits define the substrate's value. atrib stays useful because it is honest about what it certifies and what it does not. Reasoning chains and outcome verification are layered on top using the existing primitives (extension URIs + `informed_by` per [D047](DECISIONS.md#d047-harness-side-reasoning-chains-as-informative-7-pattern), tool-side attestation + observation witnessing per [§7.6](#76-outcome-verification-patterns), signed third-party evaluation per [D087](DECISIONS.md#d087-signed-diagnostic-outcome--trace-replay-as-canonical-repair-pattern)). Each pattern adds a signer outside the agent. It can corroborate the action, but it cannot turn the agent's account of its own reasoning into a verifiable fact.

The useful mental model is: **one graph, two planes**. The chronology plane preserves faithful event history: chain and session edges show what happened before what inside a context, and cross-session edges show explicit continuity across contexts. The declared-relationship plane preserves signed claims about how records relate: `informed_by`, `provenance_token`, `annotates`, and `revises` state that the signer treats one record as an input, anchor, comment target, or superseded position. Both planes make up the atrib graph. `/v1/graph` exposes the derived graph for a scope, while `/v1/chain` and `/v1/trace` are projections over that graph: chain isolates chronological continuity, trace isolates declared relationships. The graph is semantic only in this signed-declaration sense; it never infers semantic relationships by reading tool names, responses, or natural-language content.

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
  - [3.4.5 GET /v1/trace/{record_hash}](#345-get-v1tracerecord_hash)
  - [3.4.6 GET /v1/chain/{record_hash}](#346-get-v1chainrecord_hash)
  - [3.4.7 GET /v1/creators/{creator_key}/graph](#347-get-v1creatorscreator_keygraph)
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

By encoding verification status as a categorical enumeration (`unsigned`, `signature_valid`, `log_committed`, `witnessed`), the protocol reports a fact: what has been verified. The policy layer in [§4](#4-attribution-policy-format) decides what each state is worth in the context of a specific attribution calculation. The protocol makes no claim about the relative value of the states beyond their strict ordering.

The same reasoning applies to gap nodes. Their `unsigned` state is a fact: no signature was present. Whether an unsigned contribution deserves zero weight, nominal weight, or some other treatment is a policy question. The protocol records the absence of a signature. It does not mandate what that absence means for settlement.

#### Why the graph is a strict fact layer

The fact/policy separation is not an architectural nicety; it is the mechanism that makes independent verification possible. For attribution to be trusted by both creators and merchants, each party must be able to independently verify two things: that the graph accurately reflects what happened (verifiable from the log data and the deterministic derivation rules), and that the settlement recommendation was correctly derived from that graph under the stated policy (verifiable by running the policy algorithm locally against the graph). If fact and policy were mixed into a single layer, this independent verification would require reimplementing both layers together, which is practically impossible for most parties.

The strict separation also makes the system auditable over time. If a settlement dispute arises, the question can be cleanly decomposed: "does the graph correctly represent the records?" and "was the policy correctly applied to this graph?" These are separable questions with separable answers. A merged layer produces a single opaque output where the source of any error is difficult to isolate.

#### The three principles restated as constraints

**The graph records structure, not causality.** Edges are derived from observable structure only. No edge type encodes a causal claim. Causal interpretation is performed by the policy layer.

**Verification state is categorical.** The four states (`unsigned`, `signature_valid`, `log_committed`, `witnessed`) describe what has been verified. Their relative weight for attribution purposes is not encoded in the protocol.

**The graph is a fact layer.** The graph query interface reports what the records show. It does not compute attribution weight, recommend distributions, or apply policy. The same graph can be evaluated under different policies by different parties, and any party can independently verify the result.

**Edge derivation is deterministic and normative.** Given the same set of attribution records, two independent implementations MUST produce identical graphs. The derivation rules in [§3.2.4](#324-edge-derivation-rules) are the normative definition. Any deviation is a nonconformance.

**Adversarial trust posture.** The fact/policy separation is one part of the substrate's trust posture. A complementary part covers what the protocol does and does not certify under adversarial conditions: signatures prove who said what, never whether what was said is true. [§8.7](#87-adversarial-threat-model) enumerates the adversarial threat model, the layered trust assessment stack atrib provides (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, anchor plurality, structural anomaly detection), and the asymmetric properties the substrate produces despite the fundamental limit. The graph's deterministic derivation is one input to that assessment, not a substitute for it.

---

### 3.2 Graph Data Model

The atrib attribution graph is a directed property multigraph. Nodes represent events. Edges represent relationships derived from observable record structure. The graph for a primary session is bounded by its `context_id`, extended by cross-session links when records share the same `session_token` field ([§1.2.1](#121-field-definitions)).

#### 3.2.1 Node Types

| Type        | Source                                                | Description                                                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool_call   | event_type = `https://atrib.dev/v1/types/tool_call`   | A creator's contribution to the session. Carries creator identity, tool identity, chain position, and timestamp. The primary subject of attribution.                                                                                                      |
| transaction | event_type = `https://atrib.dev/v1/types/transaction` | The commerce event that closes the attribution loop. The creator_key is the merchant's key. A session without a transaction node is attributable but not yet economically closed.                                                                         |
| observation | event_type = `https://atrib.dev/v1/types/observation` | A passive perception captured by the agent. Witness, not action. Participates in chain ordering but not in [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) attribution calculation. See [D042](DECISIONS.md#d042-lift-observation-graph-participation-restriction). |
| gap_node    | OTel span without a signed record                     | An unsigned hop. Present in the graph so that invisible contributions are visible. Carries no creator_key, chain_root, or signature. See [§3.2.5](#325-gap-nodes).                                                                                        |
| extension   | event_type = any URI outside atrib's normative set    | A consumer-namespace record. event_type URI preserved verbatim. Participates in chain ordering ([D043](DECISIONS.md#d043-extension-uri-participation-in-graph-derivation)) but not in CONVERGES_ON or [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation.  |

**Per-event-type graph participation matrix:**

| Node type   | CHAIN_PRECEDES | SESSION_PRECEDES | SESSION_PARALLEL | CONVERGES_ON | CROSS_SESSION | INFORMED_BY ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)) | PROVENANCE_OF ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)) | [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) attribution |
| ----------- | -------------- | ---------------- | ---------------- | ------------ | ------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| tool_call   | ✅             | ✅               | ✅               | ✅           | ✅            | ✅ source/target                                                                                | ✅ source/target                                                                                    | ✅ contributing                                   |
| transaction | ✅             | ✅               | ✅               | ✅ (target)  | ✅ (target)   | ✅ source/target                                                                                | ✅ source/target                                                                                    | ✅ receiver                                       |
| observation | ✅             | ✅               | ✅               | ❌           | ❌            | ✅ source/target                                                                                | ✅ source/target                                                                                    | ❌ skipped                                        |
| extension   | ✅             | ✅               | ✅               | ❌           | ❌            | ✅ source/target                                                                                | ✅ source/target                                                                                    | ❌ skipped                                        |
| gap_node    | ❌             | ✅               | ✅               | ✅           | ❌            | ❌                                                                                              | ❌                                                                                                  | ✅ contributing                                   |

Observations and extension records DO participate in temporal chain edges (CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL) so the graph spine is complete. They DO NOT participate in CONVERGES_ON (which is the structural prerequisite for [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) attribution; observations are witnesses, not contributors; extension URIs are consumer-namespace and atrib does not bless their attribution claims by default). Promotion of an extension URI to atrib's normative contributing set requires [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)'s bar.

#### 3.2.2 Interaction Patterns and Their Structural Signatures

Agent interactions produce five distinct structural patterns, each producing a distinct edge signature. Naming these patterns makes the edge taxonomy unambiguous.

**Sequential.** Agent calls tool A, then calls tool B whose creator sets `chain_root` to the hash of A's record. B is structurally downstream of A. Signature: CHAIN_PRECEDES A → B.

**Parallel.** Agent calls tool A and tool B in the same session with no chain dependency between them: either both are genesis records, or both descend from a common ancestor but not from each other. Signature: SESSION_PARALLEL A ↔ B (or SESSION_PRECEDES A → B if timestamps establish ordering).

**Temporal.** Tool A completed before tool B in the same session, but no chain linkage connects them. Ordering is observable but not structural. Signature: SESSION_PRECEDES A → B.

**Delegated.** Agent A dispatches sub-agent B via A2A. B's tools execute under the same `context_id` as A's session, because context_id propagates through A2A boundaries ([§1.5.1](#151-context_id-the-session-anchor)). A's records and B's records are distinguishable by `creator_key`; different agent operators produce different keys. The delegation boundary is identified in the graph by creator_key diversity within a single session. No separate edge type is needed: standard within-session edges apply, and the policy layer reads creator_key to identify which contributions came from the primary agent versus delegated sub-agents.

**Convergent.** Multiple tool calls, potentially from different sessions, all contribute to the same transaction. Within a session: CONVERGES_ON edges from all non-transaction nodes to the transaction node. Across sessions: CROSS_SESSION edges when explicit linking tokens connect the records.

// Sequential: B.chain_root = hash(A) \[ A: tool_call \] ──CHAIN_PRECEDES──▶ \[ B: tool_call \] // Temporal: same session, no chain link, A.timestamp \< B.timestamp \[ A: tool_call \] ──SESSION_PRECEDES──▶ \[ B: tool_call \] // Parallel: same session, no chain link, no temporal ordering \[ A: tool_call \] ──SESSION_PARALLEL── \[ B: tool_call \] // Convergent within session: all nodes point to the transaction \[ A: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] \[ B: tool_call \] ──CONVERGES_ON──▶ \[ T: transaction \] // Cross-session: A (ctx=X) contributed to T (ctx=Y) via session_token \[ A: tool_call (ctx=X) \] ──CROSS_SESSION──▶ \[ T: transaction (ctx=Y) \] // Delegated: same session, different creator_keys (A=primary agent, B=sub-agent) \[ A: tool_call (key=K1) \] ──SESSION_PRECEDES──▶ \[ B: tool_call (key=K2) \] // policy layer reads creator_key to identify the delegation boundary

#### 3.2.3 Edge Types

Nine edge types are defined. All are derived deterministically from observable record structure. None encode inferred causal claims; INFORMED*BY, PROVENANCE_OF, ANNOTATES, and REVISES encode explicit \_agent-claimed* causation, which is structurally derived from declared fields rather than inferred from content.

| Edge type        | Dir   | Derivation basis                                                                                                                                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CHAIN_PRECEDES   | A → B | B.chain_root = SHA-256(JCS(A))                                                                                                                   | B is structurally downstream of A in the attribution chain. B's creator explicitly set their chain_root by hashing A's complete signed record. This is the primary structural link.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| SESSION_PRECEDES | A → B | Same context_id; no CHAIN_PRECEDES between A and B; A.timestamp \< B.timestamp                                                                   | A occurred before B in the same session with no chain structure connecting them. Temporal ordering only, no structural claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SESSION_PARALLEL | A ↔ B | Same context_id; no CHAIN_PRECEDES between A and B; no temporal ordering                                                                         | A and B are co-contributors to the same session with neither chain structure nor observable temporal ordering between them. Undirected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CONVERGES_ON     | N → T | N is a tool_call or gap_node; T is a transaction node; both share context_id                                                                     | Node N contributed to the session that produced transaction T. Every contributing node in a session with a transaction node receives a CONVERGES_ON edge to that transaction. This is the edge that makes settlement calculation structurally possible. observation and extension nodes do NOT receive CONVERGES_ON edges ([D042](DECISIONS.md#d042-lift-observation-graph-participation-restriction), [D043](DECISIONS.md#d043-extension-uri-participation-in-graph-derivation)).                                                                                                                                                   |
| CROSS_SESSION    | A → T | A is a tool_call node; T is a transaction node; different context_ids; A.session_token = T.session_token (both fields must be present and equal) | A contributed to a transaction that occurred in a different session of the _same logical session_. This edge is only created when both records carry the same explicit `session_token` field value. It is never inferred from timestamps, creator keys, or any other heuristic.                                                                                                                                                                                                                                                                                                                                                      |
| INFORMED_BY      | A → B | A's `informed_by` array contains `"sha256:" + hex(record_hash(B))`                                                                               | A's creator claims B was a record that informed A's action. Structural derivation from a declared field; atrib certifies the claim was signed, not its truthfulness. May be intra-session or cross-session (B may be in any context_id). When B is not in the resolved record set, the edge is created against a synthetic dangling node with `dangling: true`. See [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type).                                                                                                                                                                               |
| PROVENANCE_OF    | D → U | D and U both carry `provenance_token` with the same value; D.context_id ≠ U.context_id; U's record_hash matches the token's source               | D's action is causally anchored on U's upstream record. This is _cross-session causal anchoring_ distinct from CROSS_SESSION's "same logical session" semantics. The token derivation (`base64url(record_hash[:16])`) makes U identifiable as the anchor source. See [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring).                                                                                                                                                                                                                                                                            |
| ANNOTATES        | A → T | A.event_type = annotation; A.annotates = `"sha256:" + hex(record_hash(T))`                                                                       | A is an annotation describing record T. Forward-pointing claim about an earlier record (the dual of INFORMED_BY's backward-pointing claim about prior records). Source must be an annotation record; target may be of any node type, intra-session or cross-session. When T is not in the resolved record set, the edge is created against a synthetic dangling node with `dangling: true`. Multiple annotations of the same target are normal. See [D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05).                                                                                            |
| REVISES          | R → P | R.event_type = revision; R.revises = `"sha256:" + hex(record_hash(P))`                                                                           | R supersedes record P. Distinct from ANNOTATES (which comments without overturning) and INFORMED_BY (which acknowledges sources): revision asserts the agent now holds a position incompatible with P. The prior record stays immutable on the log; the revision is a new record future readers should weight as the current position. Source must be a revision record; target may be of any node type. When P is not in the resolved set, the edge is dangling. Multiple revisions of the same target are allowed (chain of mind-changes). See [D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06). |

**Note (Mutual exclusivity):** CHAIN_PRECEDES and SESSION_PRECEDES are mutually exclusive between any given ordered pair of nodes: if a CHAIN_PRECEDES edge exists from A to B, no SESSION_PRECEDES edge is created between A and B in either direction. SESSION_PARALLEL and SESSION_PRECEDES are mutually exclusive between any given pair of nodes. CONVERGES_ON coexists with all within-session edge types. CROSS_SESSION only applies when context_ids differ and a session_token match is present. INFORMED_BY and PROVENANCE_OF coexist with all other edge types; they are agent-declared causal anchors and may overlap with the structural edges.

#### 3.2.4 Edge Derivation Rules

These rules are normative. Implementations MUST apply them in the order given. Two implementations applying these rules to identical input records MUST produce identical edge sets.

The full edge-derivation conformance corpus lives at [`spec/conformance/3.2.4/`](spec/conformance/3.2.4/) ([D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)). It pins exact edge sets for all nine edge types, full pairwise SESSION_PRECEDES and SESSION_PARALLEL derivation, and dangling producer-declared references. The compact per-session graph corpus remains separate at [`spec/conformance/3.4.1/`](spec/conformance/3.4.1/).

**Step 1:** CHAIN_PRECEDES edges\*\*

For each non-genesis record R: compute `expected = R.chain_root.removePrefix("sha256:")`. For each other record P: if `sha256_hex(jcs(P)) == expected`, create CHAIN_PRECEDES P → R. Each record has at most one CHAIN_PRECEDES parent (chain_root is a single value).

```
for each record R:
  if is_genesis(R): continue
  expected = R.chain_root.removePrefix("sha256:")
  for each other record P:
    if sha256_hex(jcs(P)) == expected:
      add_edge(CHAIN_PRECEDES, source=P, target=R); break
```

**Step 2:** SESSION_PRECEDES edges\*\*

For each ordered pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction: if `A.timestamp < B.timestamp`, create SESSION_PRECEDES A → B. When timestamps are equal, use ascending log_index as the tiebreaker. Gap nodes with `log_index: null` are sorted after all nodes with the same timestamp that have a numeric `log_index`. Among multiple gap nodes with the same timestamp, order is arbitrary (SESSION_PARALLEL is assigned). If log_index is also equal (nodes in the same batch), skip; they are SESSION_PARALLEL candidates.

**Step 3:** SESSION_PARALLEL edges\*\*

For each pair (A, B) of nodes sharing a context_id where no CHAIN_PRECEDES edge exists between them in either direction and no SESSION_PRECEDES edge exists between them in either direction: create SESSION_PARALLEL A ↔ B (undirected).

**Step 4:** CONVERGES_ON edges\*\*

For each transaction node T: for each other node N sharing T's context_id (tool_call or gap_node), create CONVERGES_ON N → T.

If a session contains multiple transaction nodes, each non-transaction node receives CONVERGES_ON edges to all of them. The calculation algorithm ([payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm)) uses the first transaction node (by log_index) for modifier computations such as temporal_decay.

**Step 5:** CROSS_SESSION edges\*\*

For each transaction node T: search the record set for tool_call nodes A where `A.context_id ≠ T.context_id` and A's `session_token` field ([§1.2.1](#121-field-definitions)) matches T's `session_token` field. For each such A, create CROSS_SESSION A → T.

CROSS_SESSION edges MUST NOT be inferred from any heuristic. Only explicit `session_token` field matches in signed records qualify. Records without a `session_token` field cannot participate in CROSS_SESSION edges.

**Step 6:** INFORMED_BY edges\*\*

For each record A carrying a non-empty `informed_by` array: for each entry `e` in the array (where `e` matches `"sha256:" + hex(record_hash)`): search the resolved record set for a record B with `sha256_hex(jcs(B)) == e[7:]`. If B is found, create INFORMED_BY A → B. If B is not found, create INFORMED_BY A → synthetic_dangling_node(e) and mark the edge `dangling: true`.

INFORMED_BY edges MAY be intra-session or cross-session. Source and target may be of any node type (tool_call, transaction, observation, extension). The agent's claim is authoritative for the edge derivation; atrib does not validate that the referenced records actually informed the action.

**Step 7:** PROVENANCE_OF edges\*\*

For each session-genesis record D carrying a non-empty `provenance_token` field of value T: search the record set for any record U where `base64url(SHA-256(JCS(U))[:16]) == T` and `U.context_id ≠ D.context_id`. If found, create PROVENANCE_OF D → U. The direction reads as "D's session descends from U's anchor."

If no record U in the resolved set satisfies the derivation predicate, create PROVENANCE_OF D → synthetic_dangling_node(T) with `dangling: true` and `reason: "no_token_source_in_record_set"`. This makes the dangling case visible rather than silently dropping the edge.

Validators MUST reject any non-genesis record carrying `provenance_token` (per [§1.2.6](#126-provenance_token) scope constraint); such records do not participate in PROVENANCE_OF derivation because they are malformed.

PROVENANCE*OF expresses cross-session \_causal anchoring*, distinct from CROSS*SESSION's \_same logical session* semantics. The two edge types may coexist when a session both belongs to a multi-trace logical session (session_token) AND descends from a prior session's anchor (provenance_token).

**Step 8:** ANNOTATES edges\*\*

For each annotation record A (where `event_type = https://atrib.dev/v1/types/annotation`) carrying a non-empty `annotates` field of value `e` (where `e` matches `"sha256:" + hex(record_hash)`): search the resolved record set for a record T with `sha256_hex(jcs(T)) == e[7:]`. If T is found, create ANNOTATES A → T. If T is not found, create ANNOTATES A → synthetic_dangling_node(e) and mark the edge `dangling: true`. The direction reads as "A is an annotation of T."

ANNOTATES edges are derived ONLY from annotation records. Records of any other event_type carrying `annotates` are malformed per [§1.2.7](#127-annotates) and MUST be rejected by validators and verifiers; they do not participate in ANNOTATES derivation. Multiple annotations of the same target are normal and produce multiple ANNOTATES edges. ANNOTATES MAY be intra-session or cross-session; the target may be of any node type (tool_call, transaction, observation, extension, even another annotation).

ANNOTATES is the structural dual of INFORMED*BY: forward-pointing (A is \_about* T) rather than backward-pointing (A was _informed by_ B). Both encode agent-declared causal links via declared fields rather than inferred from content. The two edge types coexist freely; an annotation may itself carry `informed_by` references to records it consulted in the act of annotating.

**Step 9:** REVISES edges\*\*

For each revision record R (where `event_type = https://atrib.dev/v1/types/revision`) carrying a non-empty `revises` field of value `e` (where `e` matches `"sha256:" + hex(record_hash)`): search the resolved record set for a record P with `sha256_hex(jcs(P)) == e[7:]`. If P is found, create REVISES R → P. If P is not found, create REVISES R → synthetic_dangling_node(e) and mark the edge `dangling: true`. The direction reads as "R supersedes P."

REVISES edges are derived ONLY from revision records. Records of any other event_type carrying `revises` are malformed per [§1.2.9](#129-revises) and MUST be rejected by validators and verifiers; they do not participate in REVISES derivation. Multiple revisions of the same target are allowed and produce multiple REVISES edges (a chain of mind-changes). REVISES MAY be intra-session or cross-session; the target may be of any node type.

REVISES is structurally similar to ANNOTATES (both are forward-pointing single-target references gated by event_type) but carries stronger semantics: ANNOTATES comments without overturning, REVISES asserts the prior is no longer held. The two edge types may both apply to the same target from different sources (one record annotates, another revises); they coexist freely with all structural edges and with INFORMED_BY / PROVENANCE_OF.

#### 3.2.5 Gap Nodes

A gap node represents an unsigned hop: a tool call evidenced by an OTel span with no corresponding signed attribution record in the log. Its presence in the graph makes the gap visible rather than hiding it.

Gap nodes participate in SESSION_PRECEDES, SESSION_PARALLEL, and CONVERGES_ON edges. They MUST NOT participate in CHAIN_PRECEDES edges (no chain_root) or CROSS_SESSION edges (no linking tokens).

Gap node IDs are deterministic: `"gap:" + hex(SHA-256(UTF-8(tool_url + ":" + tool_name + ":" + context_id)))`. This ensures stable, reproducible IDs across independent implementations processing the same OTel data.

---

### 3.3 Verification State

Every node carries a `verification_state`: a categorical description of the current verification status of its underlying record. This is a fact about the record, not a judgment of its value. Policy evaluation uses verification state as input; this section defines only the states themselves.

| State           | Condition                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unsigned        | Gap node. No signature exists. The event is known only from OTel span data.                                                                                                               |
| signature_valid | The record's Ed25519 signature ([§1.4.3](#143-verification-procedure)) verifies. The record has not yet been confirmed in the Merkle log.                                                 |
| log_committed   | Signature verifies and an inclusion proof ([§2.7](#27-inclusion-proof-verification)) has been verified against a current signed checkpoint. The record is durably in the append-only log. |
| witnessed       | Signature verifies, inclusion proof verifies, and the checkpoint carries at least one valid witness cosignature ([§2.9](#29-witnessing-and-cosignatures)).                                |

Verification states are strictly ordered: `unsigned < signature_valid < log_committed < witnessed`. A node's state can only advance, never regress, as new evidence arrives. Implementations MUST update states as evidence is gathered. Verification states are computed by the graph query service from evidence in the log. They are never asserted by attribution records.

---

### 3.4 Query API

All endpoints are served at `https://graph.atrib.dev/v1/`. All responses use `Content-Type: application/json`. All errors use RFC 9457 Problem Details (`Content-Type: application/problem+json`). The API is read-only.

#### 3.4.1 GET /v1/graph/{context_id}

Returns the complete attribution graph for a session: all nodes and edges, computed per [§3.2.4](#324-edge-derivation-rules).

```
GET /v1/graph/4bf92f3577b34da6a3ce929d0e0e4736

// Optional query parameters:
// include_gap_nodes=true|false      (default: true)
// include_cross_session=true|false  (default: true)
// include_proof=true|false          (default: false; proof bundles are large)
// compact=true|false                (default: true; intra-session edge compaction per §3.4.1.1)

// 200 OK  -> GraphResponse ([§3.5.1](#351-graph-response-object))
// 404     -> no records with this context_id
// 400     -> malformed context_id (not 32 hex chars)
```

##### 3.4.1.1 Intra-session edge compaction

Implementations MAY emit a reduced SESSION_PRECEDES / SESSION_PARALLEL edge set when the response would otherwise carry information-redundant edges. The reduction is structural, it preserves all causal information already present in CHAIN_PRECEDES, and is enabled by default for `/v1/graph/{context_id}`. Callers who require the full pairwise derivation per [§3.2.4](#324-edge-derivation-rules) steps 2–3 (e.g. conformance harnesses) MUST pass `?compact=false`.

The compaction rule:

1. **Chain-component skip.** Treat the records sharing this `context_id` as a graph whose edges are CHAIN_PRECEDES. Compute connected components. For every pair of records `(a, b)` sitting in the same component, omit any SESSION_PRECEDES or SESSION_PARALLEL edge that would otherwise connect them, the chain already encodes their relationship and the additional edge carries no information.
2. **Adjacent-only emission.** For pairs that ARE in different chain components, sort by `timestamp` ascending and emit one SESSION_PRECEDES edge per consecutive pair (rather than every cross-component pair). The transitive ordering "X happens-before Z" is implied by the emitted "X→Y" + "Y→Z" without materializing a third edge.
3. SESSION_PARALLEL between equal-`timestamp` pairs is emitted only when both records belong to different chain components (rule 1 still applies).

Compaction is information-preserving with respect to the partial order over the resolved record set: any "happens-before" relation derivable from the full pairwise edge set is still derivable from the compacted edge set plus CHAIN_PRECEDES transitivity. This is distinct from [§3.4.7](#347-get-v1creatorscreator_keygraph)'s identity-view filter, which drops intra-session edges entirely (lossy by design, that view shows cross-session activity, not within-session topology).

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

// Optional: since=<ISO8601 | unix_ms>, until=<ISO8601 | unix_ms>, has_transaction=true|false
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
  "next_cursor": "eyJzaW5jZSI..."  // null if no further results
}
```

#### 3.4.5 GET /v1/trace/{record_hash}

Returns the **provenance trace** of a record: the ancestor subgraph reachable by walking producer-claimed ancestry edges backward from the starting record. Provenance trace walks INFORMED_BY, ANNOTATES, and REVISES edges, all derived from explicit producer-set fields per [§1.2.5](#125-informed_by), [§1.2.7](#127-annotates), and [§1.2.9](#129-revises). PROVENANCE_OF is conceptually walked but truncated `provenance_token` references that cannot be resolved against the response set are surfaced unresolved rather than recursed.

Provenance trace is the producer's claim layer: every edge walked is a record where the producer explicitly named a prior record as informing, annotating, or revising the current one. Provenance trace MUST NOT walk CHAIN_PRECEDES, chain ordering is substrate-derived structure, not a producer claim, and conflating the two layers violates the structure-vs-claims separation that justifies the optional INFORMED_BY field's signed-claim semantics.

```
GET /v1/trace/4797633fc95a...

// Optional query parameters:
// depth=<n>                         (default: 5, max: 20)
// include_annotations=true|false    (default: true; ANNOTATES walk)
// include_revisions=true|false      (default: true; REVISES walk)

// 200 OK  -> GraphResponse ([§3.5.1](#351-graph-response-object)) restricted to
//            the ancestor set + the starting record
// 404     -> no record with this hash
// 400     -> malformed record_hash (not 64 hex chars)
```

The response carries the same `nodes` and `edges` shape as [§3.4.1](#341-get-v1graphcontext_id) so consumers can render trace responses with the same rendering pipeline. Truncation flags (`truncated_by_depth`, `truncated_by_count`) signal when the walk exceeded the configured limits; consumers can re-request with a deeper depth to extend the walk.

#### 3.4.6 GET /v1/chain/{record_hash}

Returns the **chronology chain** of a record: the ancestor subgraph reachable by walking CHAIN_PRECEDES edges backward from the starting record. Chronology chain walks substrate-derived ordering, the chain_root linkage every record carries per [§1.2.3](#123-chain_root-for-genesis-records). The walk terminates at the session's genesis record (where chain_root = SHA-256(context_id) per [§1.2.3](#123-chain_root-for-genesis-records)).

Chronology chain is the substrate's structural layer: every edge walked is a record whose chain_root identifies its immediate predecessor in the same context_id. Producers do not declare these edges; the substrate derives them per [§3.2.4](#324-edge-derivation-rules). Chronology chain MUST NOT walk INFORMED_BY, ANNOTATES, or REVISES, those are producer claims, not substrate structure, and walking them would conflate the two layers.

```
GET /v1/chain/4797633fc95a...

// Optional query parameters:
// depth=<n>                         (default: 5, max: 20)

// 200 OK  -> GraphResponse ([§3.5.1](#351-graph-response-object)) restricted to
//            the chain_precedes ancestor set + the starting record
// 404     -> no record with this hash
// 400     -> malformed record_hash (not 64 hex chars)
```

The response carries the same `nodes` and `edges` shape as [§3.4.1](#341-get-v1graphcontext_id). The walk produces a linear chain (each non-genesis record has exactly one chain_precedes ancestor), so `truncated_by_count` is unreachable in practice; `truncated_by_depth` is the only truncation mode.

The two operations are complementary, not redundant. [§3.4.5](#345-get-v1tracerecord_hash) answers "what did the producer claim informed this record?" and [§3.4.6](#346-get-v1chainrecord_hash) answers "what did the substrate observe came before this record in the same context_id?" Consumers needing both views compose the responses client-side; the API does not provide a combined endpoint to keep the structure-vs-claims boundary visible at the protocol layer.

#### 3.4.7 GET /v1/creators/{creator_key}/graph

Returns a creator activity-map graph: every record signed by the creator across all `context_id` boundaries within an optional time window, composed into a single graph response. Cross-session edges are derived per [§3.2.4](#324-edge-derivation-rules) (CROSS_SESSION when records share a `session_token`, INFORMED_BY across context_ids, PROVENANCE_OF anchoring sessions to upstream genesis records).

This endpoint differs from [§3.4.4](#344-get-v1creatorscreator_keysessions): the sessions endpoint returns a paginated list of sessions per creator, while this endpoint composes the underlying records into a connected graph that visualizes how a creator's activity flows across sessions.

```
GET /v1/creators/ABC.../graph

// Optional query parameters:
// since=<ISO8601 | unix_ms>            (default: unbounded; oldest in window)
// until=<ISO8601 | unix_ms>            (default: now; newest in window)
// limit=<n>                            (default: 500, max: 2000; max records)
// direction=newest|oldest              (default: newest; truncation slice direction, see "Truncation" below)
// event_type=<short_label | uri>       (filter by node event_type)
// include_intra_session=true|false     (default: false; see "Edge scope" below)

// 200 OK  -> CreatorGraphResponse:
//            {
//              "creator_key":                    "ABC...",
//              "window":                         { "since": ..., "until": ..., "limit": 500, "direction": "newest" },
//              "record_count":                   47,         // records actually returned (after truncation)
//              "total_in_window":                47,         // records in the requested window before truncation
//              "truncated":                      false,      // true when total_in_window > limit
//              "effective_window":               { "since": ..., "until": ... },  // first/last timestamp of returned records; null both when record_count = 0
//              "intra_session_edges_filtered":   true,       // false if include_intra_session=true
//              "graph":                          GraphResponse  // [§3.5.1](#351-graph-response-object)
//            }
// 404     -> creator has no records in store
// 400     -> invalid time window or malformed creator_key
```

The response carries the same `nodes` and `edges` shape as [§3.4.1](#341-get-v1graphcontext_id) inside the `graph` field, so consumers can render creator activity-maps with the same rendering pipeline used for session graphs. The outer envelope (`creator_key`, `window`, `record_count`, `total_in_window`, `truncated`, `effective_window`, `intra_session_edges_filtered`) provides the metadata callers need to parameterize follow-up queries (paginate by adjusting `since`/`until`, refine by `event_type`, restore intra-session edges via `include_intra_session=true`, switch slice direction).

**Truncation.** When the requested window contains more records than `limit`, the implementation MUST return a contiguous slice of the records (not a sample) so that derived edges remain consistent with the spec [§3.2.4](#324-edge-derivation-rules) rules. Stratified sampling within the window is forbidden because it breaks intra-session chain edges (a `CHAIN_PRECEDES` edge between two records requires both records to be present in the response). The `direction` query parameter selects which contiguous slice to return:

- `direction=newest` (default): the most-recent `limit` records in the window. Right for windows anchored to the present (e.g., "last 24h"). Truncation drops the oldest tail.
- `direction=oldest`: the oldest `limit` records in the window. Right for explicit `[since, until]` ranges where the user has anchored a start time and wants to see what happened from there forward. Truncation drops the newest tail.

Implementations MUST set `effective_window: { since, until }` to the timestamps of the first and last records actually returned (after truncation), so callers can render "you asked for X to Y, got X to Z" feedback without computing it client-side. When `record_count` is 0, both fields of `effective_window` MUST be `null`.

**Edge scope.** The activity-map exists to surface CROSS-SESSION relationships: how a creator's records connect across `context_id` boundaries. By default the response excludes the two intra-session-only edge types, `SESSION_PRECEDES` ([§3.2.4](#324-edge-derivation-rules) step 2) and `SESSION_PARALLEL` ([§3.2.4](#324-edge-derivation-rules) step 3), because those are what the per-session graph at [§3.4.1](#341-get-v1graphcontext_id) renders. Including intra-session edges here also produces O(N²) edge counts when records in a session don't chain (a single session of 500 records can produce ~125k `SESSION_PRECEDES` pairs), swamping the cross-session signal the activity-map exists for. Implementations MUST set `intra_session_edges_filtered: true` in the response envelope when this default applies.

Callers that need every applicable edge type (e.g., a single-creator analytics tool that wants per-session sequencing AND cross-session relationships in one response) opt in via `include_intra_session=true`; the response then carries every edge `buildGraph` derived and reports `intra_session_edges_filtered: false`. Cross-session edge types (`CROSS_SESSION`, `INFORMED_BY` across context_ids, `PROVENANCE_OF`, `ANNOTATES`, `REVISES`) are always included regardless of the flag, and `CHAIN_PRECEDES` is always included because it is intra-session linkage that nonetheless reflects the producer's chain integrity rather than O(N²) fallback ordering.

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

**Technology independence.** This section specifies the graph model and API shape. It does not specify storage technology. Any queryable store capable of producing conforming responses is acceptable. The derivation rules in [§3.2.4](#324-edge-derivation-rules) are the normative definition of graph structure and must be applied identically regardless of underlying storage.

**On delegated sub-agents.** When agent A delegates to sub-agent B via A2A, B's tool calls share A's `context_id` because context_id propagates through A2A delegation boundaries ([§1.5.1](#151-context_id-the-session-anchor)). The graph represents this naturally: A's and B's records appear as nodes in the same session, distinguishable by `creator_key`. No special edge type is needed. Policy engines read creator_key diversity within a session to identify delegation structure and can weight contributions by originating agent accordingly.

**Graph construction from log data.** Implementations indexing the graph must monitor the log for new checkpoints ([§2.5.1](#251-checkpoint-endpoint)), fetch new entry bundles ([§2.5.3](#253-entry-bundle-endpoint)), retrieve full attribution records from creator servers or a record cache, verify signatures, and apply the derivation rules incrementally. Records whose chain_root references a not-yet-seen parent should be stored and the CHAIN_PRECEDES edge created when the parent record arrives.

**The fact / policy boundary.** The graph query interface MUST NOT return weighted or policy-adjusted data. All attribution weights, distribution recommendations, and settlement calculations belong to [§4](#4-attribution-policy-format). This separation is not a preference; it is the mechanism that makes independent settlement verification tractable. Any party must be able to run the graph construction algorithm on the log data and the policy algorithm on the graph, and arrive at the same settlement recommendation as the service produced, without trusting either layer.

---

## §4 Attribution Policy Format

_Position of the policy layer. The policy format, negotiation, calculation algorithm, and settlement document live in the [atrib Payments Profile](docs/payments-profile.md)._

Contents

- [4.1 Purpose and Position in the Protocol](#41-purpose-and-position-in-the-protocol)
- [4.2](#42-policy-document-format)–[4.7](#47-settlement-recommendation-document): tombstoned anchors pointing at the [payments profile](docs/payments-profile.md)
- [4.8 Scope Boundaries](#48-scope-boundaries)

### 4.1 Purpose and Position in the Protocol

_This section is informative._

The three preceding sections define what happened. The policy layer defines how to evaluate what happened for the purpose of distributing value. Per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core), that layer lives in the [atrib Payments Profile](docs/payments-profile.md), which versions independently of this specification. Rail and settlement churn lands in the profile's version history, not here.

The position of policy relative to the protocol is unchanged by the relocation:

- **Policies are first-class primitives of the payments layer, not configuration files.** They are machine-readable documents that agents fetch, parse, apply, and reason about autonomously. The profile defines the policy schema; creators and merchants define their own policies within that schema.
- **The protocol has no thumb on the scale.** atrib does not decide what contributions are worth. The profile provides the schema and the deterministic calculation; the parties provide the values.
- **The calculation is a pure function.** Graph + policy = distribution. No network calls, no clock beyond record timestamps, no randomness. Any party with the same inputs must get the same result ([payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm)).
- **Fact/policy separation is absolute.** The [§3](#3-graph-query-interface) graph is a pure fact layer and never returns weighted data ([§3.6](#36-implementation-notes)). The policy layer consumes the graph; it never feeds it. This separation is what made the relocation a documentation move with no signed-byte, record, or service change.

Two moments in the session lifecycle remain relevant. **Negotiation** happens at session initialization, before any tool calls are made ([payments profile §7](docs/payments-profile.md#7-session-negotiation)). **Calculation** happens after the transaction closes ([payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm)). The policy negotiated at session start is the policy applied at calculation time, regardless of whether policies have changed in between.

Core retains the payments-accommodation surface: the `transaction` event type ([§1.2.4](#124-event_type-values)), the cross-attestation requirement ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records)), and the universal evidence envelope ([§5.5.7](#557-universal-evidence-envelope)). Everything rail- or settlement-specific attaches through those three elements.

---

### 4.2 Policy Document Format

_Moved to the [atrib Payments Profile §4](docs/payments-profile.md#4-policy-document-format) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.2.1 Top-Level Fields

_Moved to the [atrib Payments Profile §4.1](docs/payments-profile.md#41-top-level-fields) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.2.2 Edge Weights

_Moved to the [atrib Payments Profile §4.2](docs/payments-profile.md#42-edge-weights) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.2.3 Modifiers

_Moved to the [atrib Payments Profile §4.3](docs/payments-profile.md#43-modifiers) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.2.4 Distribution Method

_Moved to the [atrib Payments Profile §4.4](docs/payments-profile.md#44-distribution-method) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.2.5 Constraints

_Moved to the [atrib Payments Profile §4.5](docs/payments-profile.md#45-constraints) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

### 4.3 The Default Policy

_Moved to the [atrib Payments Profile §5](docs/payments-profile.md#5-the-default-policy) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

### 4.4 Publication and Discovery

_Moved to the [atrib Payments Profile §6](docs/payments-profile.md#6-publication-and-discovery) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

### 4.5 Session Negotiation

_Moved to the [atrib Payments Profile §7](docs/payments-profile.md#7-session-negotiation) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.5.1 Negotiation Protocol

_Moved to the [atrib Payments Profile §7.1](docs/payments-profile.md#71-negotiation-protocol) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.5.2 Conflict Resolution

_Moved to the [atrib Payments Profile §7.2](docs/payments-profile.md#72-conflict-resolution) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.5.3 Session Policy Record

_Moved to the [atrib Payments Profile §7.3](docs/payments-profile.md#73-session-policy-record) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

### 4.6 The Calculation Algorithm

_Moved to the [atrib Payments Profile §8](docs/payments-profile.md#8-the-calculation-algorithm) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.1 Inputs and Preconditions

_Moved to the [atrib Payments Profile §8.1](docs/payments-profile.md#81-inputs-and-preconditions) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.2 Step 1: Identify Contributing Nodes

_Moved to the [atrib Payments Profile §8.2](docs/payments-profile.md#82-step-1-identify-contributing-nodes) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.3 Step 2: Compute Raw Scores

_Moved to the [atrib Payments Profile §8.3](docs/payments-profile.md#83-step-2-compute-raw-scores) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.4 Step 3: Apply Constraints

_Moved to the [atrib Payments Profile §8.4](docs/payments-profile.md#84-step-3-apply-constraints) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.5 Step 4: Normalize to a Distribution

_Moved to the [atrib Payments Profile §8.5](docs/payments-profile.md#85-step-4-normalize-to-a-distribution) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.6 Step 5: Aggregate by Creator

_Moved to the [atrib Payments Profile §8.6](docs/payments-profile.md#86-step-5-aggregate-by-creator) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.6.7 Step 6: Apply Creator Floors

_Moved to the [atrib Payments Profile §8.7](docs/payments-profile.md#87-step-6-apply-creator-floors) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

### 4.7 Settlement Recommendation Document

_Moved to the [atrib Payments Profile §9](docs/payments-profile.md#9-settlement-recommendation-document) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.7.1 Document Format

_Moved to the [atrib Payments Profile §9.1](docs/payments-profile.md#91-document-format) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.7.2 Signing the Recommendation

_Moved to the [atrib Payments Profile §9.2](docs/payments-profile.md#92-signing-the-recommendation) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 4.7.3 Independent Verification

_Moved to the [atrib Payments Profile §9.3](docs/payments-profile.md#93-independent-verification) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

---

### 4.8 Scope Boundaries

_See [§1.8](#18-scope-boundaries) for protocol-wide scope boundaries. Policy- and settlement-specific boundaries (policy versioning, dispute mechanism, settlement webhook format, multi-transaction sessions, agent-published policies) live in the [atrib Payments Profile §13](docs/payments-profile.md#13-scope-boundaries)._

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
  - [5.5.4 AP2 / Verifiable Intent evidence checks](#554-ap2--verifiable-intent-evidence-checks)
  - [5.5.5 Handoff claim verification](#555-handoff-claim-verification)
  - [5.5.6 Generic authorization evidence blocks](#556-generic-authorization-evidence-blocks)
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

A conforming SDK implementation MUST satisfy all the automation triggers defined in [§5.7](#57-automation-triggers-normative). A conforming implementation MUST NEVER require the developer to call any attribution method explicitly after initialization. A conforming implementation MUST NEVER fail or throw an exception in a way that affects the primary tool call or agent response.

---

### 5.2 Package Overview

_This section is informative._

Three packages are defined in this specification. All are TypeScript/JavaScript packages distributed via npm. Implementations in other languages SHOULD follow the same interface contracts using idiomatic patterns for their language.

| Package       | Used by                         | Purpose                                                                                                                                                                                         |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @atrib/mcp    | MCP server operators (creators) | Wraps an MCP server to automatically emit signed attribution records on every successful tool call and expose the creator's policy at `/.well-known/atrib-policy.json`.                         |
| @atrib/agent  | Agent developers                | Wraps an agent to automatically read and forward attribution context on every tool call, run policy negotiation at session start, create session policy records, and detect transaction events. |
| @atrib/verify | Merchants                       | Verifies settlement recommendations and runs post-hoc attribution calculations for sessions where no agent SDK was present.                                                                     |

All three packages are open source under the Apache 2.0 license. The npm package names are reserved.

Transaction detection, policy negotiation, session policy records, and settlement verification are payments-layer contracts defined by the [atrib Payments Profile](docs/payments-profile.md). The packages implement those contracts when a deployment uses the profile; a core-only deployment signs `tool_call` records and never classifies transactions, per the degradation contract ([§5.8](#58-degradation-contract)).

Beyond the three spec-defined middleware packages, the reference distribution also ships consolidated client SDKs (informative): `@atrib/sdk` for TypeScript and the `atrib` distribution for Python expose `attest()` (write) and `recall()` (read) verbs over the same record layer, adding no new signing implementation. The Python distribution is the first non-TypeScript implementation of the [§1](#1-attribution-record-format) and [§5](#5-sdk-specification) contracts; both are held byte-identical through the shared conformance corpora. They are clients over this specification, not additional conformance surfaces. The reference implementations are maintained at `github.com/atrib-io`. Third-party implementations are permitted and encouraged, provided they satisfy the conformance requirements in this section.

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

| Option           | Type       | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey       | string     | Required | Base64url-encoded 32-byte Ed25519 seed. Used to sign all attribution records emitted by this server. See [§5.6](#56-key-management) for generation and storage requirements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| logEndpoint      | string     | Optional | URL of the Merkle log submission endpoint. Default: `https://log.atrib.dev/v1/entries`. Override for private log deployments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| logSubmission    | string     | Optional | `enabled` or `disabled`. Default: `enabled`. Set to `disabled` for offline tests and local-mirror-only hosts that should sign records and run `onRecord` without POSTing to a log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| policy           | object     | Optional | Inline attribution policy document ([payments profile §4](docs/payments-profile.md#4-policy-document-format)). If provided, served at `/.well-known/atrib-policy.json`. If absent, a 404 is served at that path (default policy applies for callers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| serverUrl        | string     | Optional | Canonical URL of this MCP server, used to compute `content_id` values ([§1.2.2](#122-content_id-derivation)). Default: derived from the server's HTTP host header. MUST be set explicitly for stdio transport where no host header is available.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| transactionTools | string\[\] | Optional | Array of tool names that complete commerce transactions. When a successful call to one of these tools is detected, `@atrib/mcp` emits a record with `event_type: "https://atrib.dev/v1/types/transaction"` rather than `"https://atrib.dev/v1/types/tool_call"`. This is how Path 1 merchant-side transaction emission ([payments profile §3](docs/payments-profile.md#3-sdk-transaction-detection)) is implemented. The merchant's checkout tool name(s) should be listed here. If not set, `@atrib/mcp` emits only `tool_call` records and Path 2 agent-side detection applies.                                                                                                                                                                                                                           |
| onRecord         | function   | Optional | `(record: AtribRecord) => void \| Promise<void>`. Observer invoked once per signed record AFTER signing and BEFORE log submission. Lets a host persist or audit the record locally; without this hook the original signed JSON is unrecoverable because the log stores only commitments ([§2.10](#210-what-the-log-stores-and-what-it-does-not)). Errors thrown or promises rejected by the observer are caught and warned via `console.warn`; they MUST NOT block submission, MUST NOT affect the attribution token in `_meta`, and MUST NOT affect the tool response, preserving the [§5.8](#58-degradation-contract) degradation contract. Typical uses: dogfood verification (replay `verifyRecord` against `creator_key`), local audit trail, replay debugging. |

#### 5.3.2 Inbound Context Reading

On every `tools/call` request, the middleware MUST read the inbound attribution context before passing the request to the tool handler. The context is read in priority order:

1\. `params._meta.atrib`: present for MCP stdio and Streamable HTTP transport. Value is a base64url-encoded token as defined in [§1.5.2](#152-http-transport-tracestate). Read first.

2\. `tracestate: atrib=`: present for HTTP transport. Parsed per [§1.5.2](#152-http-transport-tracestate). Read if `params._meta.atrib` is absent.

3\. `X-atrib-Chain` header: fallback when tracestate was stripped by a proxy ([§1.5.3](#153-http-fallback-x-atrib-chain)). Read if neither of the above is present.

If all three are absent, this is a genesis call; no upstream attribution context exists for this request. The middleware generates a genesis record ([§5.3.3](#533-record-construction-and-signing)).

In addition, the middleware MUST read the session_token if present:

4\. `params._meta.baggage`: for MCP transports. Parse for key `atrib-session`.

5\. W3C `Baggage` header: for HTTP transport. Parse for key `atrib-session`.

The extracted context yields: `record_hash` (the SHA-256 of the sending record, which becomes the `chain_root` of the next record in the chain), `creator_key` (identifies the sender), `context_id` (the OTel trace ID from the `traceparent` header or span context), and optionally `session_token` (for cross-trace attribution linking). All extracted values are passed to record construction ([§5.3.3](#533-record-construction-and-signing)).

#### 5.3.3 Record Construction and Signing

After the tool handler completes successfully (i.e., `isError` is false in the response), the middleware MUST construct and sign an attribution record per [§1.2](#12-the-attribution-record)–[§1.4](#14-signing-and-verification).

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

Record construction and signing MUST complete before the response is returned to the caller. Log submission ([§5.3.5](#535-log-submission)) MUST happen after the response is sent and is always non-blocking, including for transaction records. See [§5.3.5](#535-log-submission) for submission behavior, retry logic, and the priority distinction between transaction and tool_call records.

**Optional observer hook.** If an `onRecord` callback was provided at init ([§5.3.1](#531-init-interface)), the middleware MUST invoke it with the signed record after signing completes and before log submission begins. This is the only point at which the original signed JSON is observable to the host, because the log itself stores only commitments ([§2.10](#210-what-the-log-stores-and-what-it-does-not)). The observer is invoked synchronously from the middleware's perspective: a returned Promise is not awaited, but rejections are captured and logged. Errors thrown or promises rejected by the observer MUST NOT propagate to the tool response, MUST NOT prevent log submission, and MUST NOT affect the attribution token written in [§5.3.4](#534-outbound-context-writing). This preserves the [§5.8](#58-degradation-contract) degradation contract.

**Note (Tool call failures):** Attribution records are only emitted for successful tool calls (`isError: false`). A tool call that returns an error does not generate an attribution record and does not extend the chain. The OTel span for the failed call will create a gap node in the graph ([§3.2.5](#325-gap-nodes)), visible as an unsigned hop.

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

Log submission is always non-blocking. The tool response is returned to the caller before any submission begins. Submission failures MUST NEVER propagate to the tool response or the caller. This applies to both `tool_call` and `transaction` records without exception; the degradation contract ([§5.8](#58-degradation-contract)) takes precedence over any desire to confirm log commitment before responding.

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

The proof bundle returned from a successful submission ([§2.6.2](#262-inclusion-proof-response)) SHOULD be cached in memory keyed by `record_hash` for the duration of the server process, and persisted to a local store if the operator has configured one. Cached proof bundles are served at `GET /.well-known/atrib-proof/{record_hash}` so agents and merchants can retrieve inclusion proofs without querying the log directly.

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

| Option         | Type     | Required | Description                                                                                                                                                                                                                           |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creatorKey     | string   | Required | Base64url Ed25519 private key. Used to sign agent-level attribution records when the agent itself is a contributor (e.g., it produces content that influences a transaction). Also used to sign the session policy record.            |
| merchantDomain | string   | Optional | Base URL of the merchant whose policies should be fetched at session initialization. If not provided, policy negotiation is skipped and the default policy applies.                                                                   |
| logEndpoint    | string   | Optional | Merkle log submission endpoint. Default: `https://log.atrib.dev/v1/entries`.                                                                                                                                                          |
| sessionToken   | string   | Optional | If provided, used as the session_token for cross-trace attribution linking ([§1.5.5](#155-cross-trace-session-continuity)). If absent, the middleware generates one automatically at session start and propagates it via W3C Baggage. |
| serverUrls     | string[] | Required | URLs of all MCP servers the agent connects to. Used for context propagation and transaction detection scope.                                                                                                                          |

#### 5.4.2 Session Initialization

Session initialization fires once when the first tool call of a session is about to be made. It MUST complete before the first outbound tool call is sent.

During initialization the middleware:

1\. Establishes the `context_id` from the current OTel trace ID. If no OTel trace is active, generates a random 16-byte hex string and injects it as the trace ID.

2\. Generates or uses the provided `sessionToken` and injects it into W3C Baggage as `atrib-session=`.

3\. Fetches the merchant policy from `merchantDomain/.well-known/atrib-policy.json` if `merchantDomain` is set. Uses a 1-second per-fetch timeout. No retry during init; falls back to default on any error or timeout.

4\. For each tool server in the agent's tool list, fetches creator policies **concurrently** (all in parallel, not sequentially). Uses a 1-second per-fetch timeout with no retry. Reads from `/.well-known/atrib-policy.json` for HTTP servers, or from `serverInfo["io.atrib/policy"]` for stdio servers. Collects all policies that responded within the timeout window; treats non-responding servers as having no policy.

5\. Runs policy negotiation per [payments profile §7](docs/payments-profile.md#7-session-negotiation) and creates the session policy record per [payments profile §7.3](docs/payments-profile.md#73-session-policy-record).

The entire initialization sequence MUST complete within 3 seconds. If it does not, the middleware proceeds under the default policy and records a timeout warning in the session policy record. The 1-second per-fetch timeout, with all creator fetches running concurrently, means total init time is bounded by: merchant fetch (≤1s) + max single creator fetch (≤1s) + negotiation logic (negligible) = well within 3 seconds even with many tools.

**Note (Init timeouts differ from runtime policy fetch timeouts):** The [payments profile §6](docs/payments-profile.md#6-publication-and-discovery) retry-once-with-2-second-delay behavior applies to _runtime_ policy document requests from policy evaluation tools, not to SDK init. During init, the SDK must fail fast; a slow policy server should not delay the first tool call by 4+ seconds. The tradeoff is that a transiently slow server during init is treated as having no policy; if the server recovers, it will serve its policy correctly on the next tool call's context propagation path.

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

_Moved to the [atrib Payments Profile §3](docs/payments-profile.md#3-sdk-transaction-detection) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 5.4.6 Session Policy Record Creation

_Moved to the [atrib Payments Profile §7.4](docs/payments-profile.md#74-session-policy-record-creation-sdk) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

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

_Moved to the [atrib Payments Profile §10.1](docs/payments-profile.md#101-verifying-a-settlement-recommendation) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 5.5.3 Post-Hoc Calculation (No Agent SDK)

_Moved to the [atrib Payments Profile §10.2](docs/payments-profile.md#102-post-hoc-calculation-no-agent-sdk) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 5.5.4 AP2 / Verifiable Intent Evidence Checks

_Moved to the [atrib Payments Profile §11](docs/payments-profile.md#11-ap2--verifiable-intent-evidence-checks) per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This anchor is stable; the section number is not reused._

#### 5.5.5 Handoff Claim Verification

`@atrib/verify` exposes `verifyHandoffClaims()` for Pattern 3 multi-agent receiving flows. A receiving agent uses it before linking its next action to another agent's claimed `record_hash`. `@atrib/verify-mcp` exposes the same operation as the read-only `atrib-verify` cognitive primitive.

```
import {
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
} from '@atrib/verify'

const claims = handoffClaimsFromEvidencePacket({
  required_record_hashes: ['sha256:...'],
  records: [
    {
      record_hash: 'sha256:...',
      record,
      proof,
      _local: { content: privateBodyMaterial },
    },
  ],
})

const handoff = await verifyHandoffClaims(
  claims,
  {
    trusted_creator_keys: [agentAPublicKey],
    allowed_context_ids: [expectedContextId],
    require_body: true,
    require_body_commitment: true,
    require_log_inclusion: true,
    log_public_key: logPublicKey,
    max_age_ms: 60_000,
  },
)

const nextRecord = await signRecord({
  ...unsigned,
  informed_by: handoff.accepted_record_hashes,
}, privateKey)
```

The helper verifies each supplied claim independently:

1. The supplied record's canonical hash equals the claimed `record_hash`.
2. `verifyRecord()` accepts the record signature and canonical record shape.
3. The record signer is in `trusted_creator_keys` when the caller supplies a trust set.
4. The record context is in `allowed_context_ids` when the caller supplies a context allow-list.
5. The timestamp is within `max_age_ms` when the caller supplies a freshness bound.
6. Supplied `body`, `args`, or `result` material matches `args_hash` / `result_hash` when body commitments are required.
7. A supplied proof bundle verifies against the serialized log entry for that exact record. If `log_public_key` is present, the C2SP signed-note checkpoint signature is also verified.

The result separates `accepted` and `rejected` claims and includes `accepted_record_hashes` for direct `informed_by` use. Rejected claims carry named reasons such as `record_missing`, `record_hash_mismatch`, `signature_invalid`, `wrong_signer`, `wrong_context`, `stale`, `body_hash_mismatch`, `proof_missing`, and `proof_invalid`.

`handoffClaimsFromEvidencePacket()` is a pure adapter for supplied evidence. It accepts parsed local mirror envelopes, private continuation packets, or arrays of evidence entries. It does not read files, fetch log entries, or fetch archive bodies.

The helper and primitive do not add a graph edge type or event type. A successful follow-up still uses the existing [§1.2.5](#125-informed_by) field and the existing INFORMED_BY graph edge. See [D105](DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) and [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7).

#### 5.5.6 Generic Authorization Evidence Blocks

`@atrib/verify` exposes a generic tiered evidence block shape for external authorization and delegation systems. These blocks are verifier-side signals. They do not alter record signature verification, graph derivation, settlement calculation, or `verifyRecord().valid`. This generic block shape is the legacy pre-envelope form: [§5.5.7](#557-universal-evidence-envelope) defines the universal evidence envelope that supersedes it for new evidence types and freezes this section's `protocol` string set at five values.

The generic result shape is:

```
{
  protocol: 'oauth2' | 'mcp_oauth' | 'aauth' | 'ap2_vi' | string,
  valid: boolean,
  issuer: string | null,
  subject: string | null,
  scope: string[],
  attenuation_ok: boolean | null,
  delegation_ok: boolean | null,
  constraints: [
    {
      type: string,
      status: 'passed' | 'failed' | 'unresolved' | 'not_checked',
      expected?: unknown,
      actual?: unknown,
      reason?: string,
    },
  ],
  errors: string[],
  warnings: string[],
  details?: unknown,
}
```

`verifyRecord(record, { authorizationEvidence })` attaches an `evidence[]` array. Each evidence item is evaluated independently. A record can have `valid: true` while one or more `evidence[]` entries have `valid: false`; consumers apply policy based on their own trust posture. `ap2ViEvidence` remains available as the legacy AP2 / VI field and is also mirrored into `evidence[]` as `protocol: "ap2_vi"`.

The initial generic adapter is OAuth / MCP authorization evidence. It accepts a compact access-token JWT with caller-supplied trusted JWKS, caller-verified claims, or a caller-supplied OAuth token-introspection response. The verifier does not call an introspection endpoint; the caller owns that network and trust policy. The verifier checks:

1. JWT signature, `iss`, `aud`, `exp`, `nbf`, and clock skew when a JWT and JWKS are supplied.
2. MCP protected-resource binding through token `aud`, token `resource`, and OAuth Protected Resource Metadata.
3. Required scopes from `scope` or `scp`.
4. Optional RFC 9396 `authorization_details` constraints by `type`, `actions`, and `locations`.
5. Optional `client_id`, subject, actor subject, and `cnf.jkt` checks.
6. Optional RFC 9449 DPoP proof evidence: `typ`, public JWK thumbprint, `htm`, `htu`, `ath`, `jti`, `iat`, nonce when supplied, and `cnf.jkt` binding when the access-token claims expose it.

The OAuth / MCP adapter does not mint tokens, run OAuth redirects, call token-introspection endpoints, fetch authorization-server metadata, or maintain a global DPoP replay cache. Callers supply tokens, claims, trust roots, protected-resource metadata, seen DPoP `jti` values or a shared replay cache when they enforce replay policy, and required constraints. Missing trusted keys or unverified decoded claims make the evidence block invalid by default; callers MAY choose a best-effort signature policy for advisory triage.

`@atrib/verify` also exposes a host-owned token-introspection helper. The helper posts to the caller's configured introspection endpoint, applies caller-supplied client authentication and expectation checks, and returns a caller-supplied introspection response for the evidence verifier. `verifyRecord()` and `verifyOAuthAuthorizationEvidence()` still do not perform hidden network calls.

The second generic adapter is AAuth authorization evidence. It accepts an AAuth agent token, resource token, or auth token with caller-supplied trusted JWKS, caller-verified claims, or decoded claims under an explicit signature policy. The verifier does not fetch AAuth metadata, fetch JWKS, mint tokens, call a Person Server, call an Authorization Server, or perform user interaction. The verifier checks:

1. AAuth JWT `typ`, signature, `iss`, `aud`, `exp`, `iat`, and clock skew when a JWT and JWKS are supplied.
2. Resource binding through token `aud`, token `resource`, and caller-supplied `aauth-resource.json` facts such as `access_mode`.
3. Required scopes from `scope` or `scp`.
4. Optional agent, subject, `parent_agent`, `act.sub`, and mission constraints.
5. Optional HTTP Message Signature evidence: caller-verified signature status, covered components, `Authorization` coverage for `AAuth-Access`, and signing-key binding through `cnf.jwk` or `agent_jkt`.
6. Optional R3 document hash or issuer constraints when a resource registration record is available.

The AAuth adapter is verifier-side evidence. It does not make AAuth a new atrib `event_type`, graph edge, identity directory, or authorization issuer. It records which AAuth facts a verifier accepted for a signed atrib action.

The third generic adapter is x401 proof evidence. It accepts decoded x401 objects or base64url JSON header values for `PROOF-REQUEST`, `PROOF-RESPONSE`, and `PROOF-RESULT`. The verifier checks the x401 envelope, version, Digital Credentials request shape, OAuth token endpoint, request id, visible OpenID4VP nonce, result artifact or verification-token shape, optional agent id, satisfied requirement ids, and proof-result errors. Callers MAY also provide already-checked agent-origin, issuer-trust, and proof-payment binding facts. x401 `payment` members are recorded only as informational hints. They do not satisfy payment protocols and MUST NOT trigger transaction detection.

The x401 adapter does not validate OpenID4VP credentials, call credential issuers, run OAuth token exchange, fetch remote credential results, verify trust-list protocols, prove agent-origin semantics, bind payment receipts, or mint verification tokens. Callers supply `resultVerified` or `tokenVerified` after their own verifier path accepts the credential result or token. Missing proof-result or token verification makes the evidence invalid by default. Optional origin, trust, and proof-payment binding facts are advisory unless the caller supplies an explicit failed verifier outcome, which fails the evidence block. The adapter accepts older draft header and payload names with warnings so early integrations remain testable while the public x401 materials converge on the v0.2.0 names.

x401 evidence blocks MAY expose sanitized details such as `proof_request_hash`, `proof_response_hash`, `proof_result_hash`, `proof_gate`, `payment_separation`, `agent_origin`, `issuer_trust`, `proof_payment_binding`, `credential_result_uri_present`, and `credential_result_uri_hash`. Optional origin, issuer-trust, and proof-payment binding references are represented as hashes in public details. They MUST NOT expose raw credential payloads, raw proof-response headers, raw verification tokens, trust-list documents, proof-payment binding documents, or fetched result-by-reference bodies by default.

Deployments that require process-shared or fleet-shared DPoP replay protection pass a `dpopReplayCache` implementation into the evidence verifier. The cache contract is atomic `checkAndRemember(key, expiresAtSeconds)`, so hosts can back it with Redis, Durable Objects, Postgres, or another shared store. The bundled memory cache is for one-process deployments and tests. The bundled HTTP-backed adapter posts `{ key, key_id, expires_at_seconds }` to a host-owned endpoint and expects `{ "accepted": true }` for a new proof or `{ "accepted": false }` for replay.

A non-normative Cloudflare Worker and Durable Object reference for the HTTP replay-cache endpoint and host-owned introspection proxy lives at `packages/integration/examples/cloudflare-agents/oauth-evidence-infra/`. It is an implementation example for hosts; it is not required by this specification.

`@atrib/mcp` MAY capture MCP/OAuth evidence from an MCP HTTP transport's already-validated `authInfo` and request metadata into the local mirror sidecar. It MAY also capture AAuth evidence from AAuth client callbacks, server verification results, or audit-sink events into the same sidecar shape. It MAY capture x401 proof headers from request metadata when a host explicitly enables x401 authorization evidence. Producer-side capture MUST NOT persist raw bearer tokens, raw AAuth JWTs, or private credential payloads by default. The reference implementation stores verified claims or decoded token facts, one-way token or proof hashes when configured, optional DPoP or HTTP signature material, x401 proof-gate constraints, optional x401 origin, issuer-trust, and proof-payment binding facts, and verifier constraints. It also records resolved local facts such as `tool_name` so `verifyRecord()` can evaluate capability envelopes without changing the signed record bytes.

`@atrib/mcp` MAY submit archived record bodies and selected sidecar evidence through [§2.12](#212-record-body-archive-layer) when a producer explicitly configures an archive endpoint. This producer path runs after log acceptance, submits the returned proof bundle with the signed record body, and excludes raw local sidecar `args` and `result` fields by default.

The offline conformance corpora for the OAuth, AAuth, and x401 adapters live at `spec/conformance/5.5.6/oauth/`, `spec/conformance/5.5.6/aauth/`, and `spec/conformance/5.5.6/x401/`. They cover verified claims, JWT access tokens, MCP resource binding, scope attenuation failures, caller-supplied introspection responses, DPoP proof checks, AAuth token types, AAuth resource binding, AAuth-Access authorization coverage, mission evidence, HTTP signature binding, current x401 headers, result artifacts, token responses, request-id binding, proof-result errors, unverified proof failures, legacy-header strict mode, payment-hint separation, external agent-origin facts, issuer-trust facts, and proof-payment binding facts.

This section is intentionally at the verifier layer. Authorization systems decide what an agent is allowed to do. atrib records what the agent did, who signed the record, how it links to prior work, and which external evidence a verifier accepted. See [D109](DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks).

#### 5.5.7 Universal Evidence Envelope

The universal evidence envelope is the single protocol-level attachment model for all externally verifiable material: OAuth / MCP authorization results, AAuth tokens, x401 proofs, AP2 / Verifiable Intent receipts, human approvals, counterparty co-signature receipts, and every future evidence type. Each evidence type is a **profile** of the envelope, identified by an absolute HTTPS type URI and versioned independently of this specification. The generic blocks of [§5.5.6](#556-generic-authorization-evidence-blocks) are the legacy pre-envelope form; this section freezes their `protocol` string set and defines the deterministic mapping from that form into envelope form.

Envelopes are verifier-layer objects and never touch signed bytes. They exist only in: (a) the local mirror sidecar ([§5.9.3](#593-the-_local-sidecar-shape)), (b) the archive evidence projection ([§2.12](#212-record-body-archive-layer)), (c) verifier results, and (d) host-owned packets (handoff claims per [D105](DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance), continuation packets, action-gate packets per [D133](DECISIONS.md#d133-action-gate-is-a-host-owned-controlproof-package), proof packets). Envelopes MUST NOT be carried in propagation tokens ([§1.5.2](#152-http-transport-tracestate)) and MUST NOT enter the 90-byte log entry ([§2.3.1](#231-entry-serialization)). Evidence MUST NOT alter record signature verification, graph derivation ([§3.2.4](#324-edge-derivation-rules)), the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation, or `verifyRecord().valid`. A signed action is real even when its external evidence is missing, expired, over-scoped, or forged; consumers apply their own policy over tiers. See [D109](DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks).

**Envelope schema (normative).** One schema, versioned by the integer `envelope` field:

```json
{
  "envelope": 1,
  "profile": "https://atrib.dev/v1/evidence/oauth2",
  "profile_version": "1.0.0",
  "tier": "verified",
  "payload": {
    "hash": "sha256:64-lowercase-hex-chars",
    "media_type": "application/jwt",
    "ref": { "kind": "mirror", "uri": null, "record_hash": null },
    "inline": null
  },
  "facts": {
    "issuer": "https://as.example",
    "subject": "agent-7",
    "scope": ["tools:read"],
    "attenuation_ok": true,
    "delegation_ok": null
  },
  "result": {
    "valid": true,
    "constraints": [
      { "type": "scope", "status": "passed", "expected": ["tools:read"], "actual": ["tools:read"] }
    ],
    "errors": [],
    "warnings": []
  },
  "verifier": { "name": "@atrib/verify", "version": "1.x.y", "checked_at_ms": 1780000000000 }
}
```

Required fields: `envelope` (MUST be the integer `1`), `profile` (absolute HTTPS type URI), `profile_version` (non-empty semver of the profile document), `tier` (one of the four values below), `payload` with `hash` and `ref.kind`, and `result` with boolean `valid`, `constraints[]`, `errors[]`, and `warnings[]`. `facts` (a flat JSON object of profile-defined verifier facts), `verifier`, `payload.media_type`, `payload.inline`, `ref.uri`, and `ref.record_hash` are OPTIONAL. `result.constraints[]` reuses the [§5.5.6](#556-generic-authorization-evidence-blocks) constraint shape unchanged (`status: 'passed' | 'failed' | 'unresolved' | 'not_checked'`). Consumers MUST reject envelopes that violate these shape rules; rejecting an envelope never rejects the record it attaches to.

**Payload hash rule.** `payload.hash` is `"sha256:" + hex(SHA-256(bytes))` where `bytes` is the exact raw payload bytes for non-JSON media types (a compact JWT's UTF-8 bytes, a receipt JWT, an SD-JWT), or the JCS canonical form (RFC 8785, [§1.3](#13-canonical-serialization)) for JSON payloads. The profile document declares which rule applies per media type. This is the hash-not-body posture of [§8.3](#83-salted-commitment-posture): public surfaces carry hashes and sanitized facts, never raw payloads.

**`ref.kind` and the `ref.record_hash` rule.** `ref.kind` states where the payload bytes are retrievable and is a closed five-value enum: `'inline' | 'mirror' | 'archive' | 'external' | 'withheld'`. `payload.inline` (the raw payload, local-only, never public) is permitted ONLY when `ref.kind` is `"inline"`; any other combination MUST be rejected. `ref.record_hash` is a sibling field, NOT a `kind` value — implementations MUST reject `kind: "record"`. When set, `record_hash` declares that the payload is itself a signed atrib record: `payload.hash` commits to that record's canonical JCS bytes, while `kind` still states where those bytes are retrievable (typically `mirror`, `archive`, or `withheld`). `record_hash` MAY accompany any `kind` except `inline`, where it is redundant with the inline body. "The payload is a signed record" and "where the bytes live" are orthogonal facts; one axis per field.

**Tier ladder.** `tier` states how the party named in `verifier` established the claim, ordered by independent reproducibility:

| Tier | Name       | Meaning                                                                                                                                                                                                                                                             |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | `declared` | Payload hash and facts asserted by a producer or counterparty. Nothing checked.                                                                                                                                                                                     |
| 1    | `shape`    | Payload parsed and structurally validated offline. No trust root exercised.                                                                                                                                                                                         |
| 2    | `attested` | A caller-owned external path accepted the material (introspection per [D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), credential-verifier `resultVerified` per [D132](DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence)). Not independently reproducible from the envelope alone. |
| 3    | `verified` | Cryptographically verified against declared trust roots (JWKS, pinned keys, pinned corpus per [D096](DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus)). Reproducible by anyone with the envelope, the payload, and the same trust roots.  |

The enum is closed at these four values. Extending it requires revising the evidence-envelope decision record, never a consumer specification.

**Tier rules (normative).** (1) A tier belongs to the envelope *instance*: it states what the `verifier` party did, not what is true. (2) A consumer MUST NOT relay another party's envelope with its own identity in `verifier` or with a raised tier; re-verification produces a new envelope instance. (3) A consumer re-running checks MAY produce a higher- or lower-tier instance than the one it received. (4) The identity key for deduplication is `(profile, payload.hash)`; multiple instances per key are permitted, and consumers order by tier descending, then `checked_at_ms` descending, then verifier name. (5) A `tier: "verified"` envelope whose payload cannot be retrieved (`ref.kind: "withheld"` or unresolvable) is still well-formed; consumers MUST report it as claimed-but-not-reproducible, mirroring the tiered record-verifiability ladder of [§2.12.7](#2127-tiered-verifiability).

**Profile registration rule.** A profile is registered by publishing, together: (1) a type URI — atrib-maintained profiles use `https://atrib.dev/v1/evidence/<name>`; third parties use an absolute HTTPS URI on a domain they control, the same self-sovereign convention as extension event_type URIs and deliberately below the [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion bar, because no event_type byte and no signed field is involved; (2) a profile document (for atrib-maintained profiles: `docs/evidence-profiles/<name>.md`) defining accepted payload media types and the applicable hash rule, the `facts` vocabulary (each fact's name, JSON type, and provenance class: `verifier-derived`, `caller-attested`, or `producer-declared`), what each tier requires for the profile, the sanitization contract (which facts and hashes may appear in public projections — raw payloads never, by default, per [D110](DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop) / [D134](DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized)), and its own semver rules (`profile_version` refers to this document); and (3) a conformance case family at `spec/conformance/evidence-envelope/<name>/` in the same commit (atrib-maintained profiles only; third parties SHOULD publish equivalents). Profile identity is the full URI: a foreign domain reusing an atrib profile name (e.g. `https://example.com/v1/evidence/oauth2`) is a valid third-party profile URI and MUST NOT be treated as the atrib profile of the same name.

The initial atrib-maintained registry is: `oauth2`, `mcp-oauth`, `aauth`, `x401`, `ap2-vi` (mapped 1:1 from the legacy [§5.5.6](#556-generic-authorization-evidence-blocks) adapters), `human-approval` (per [D118](DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain): the payload is the human-signed approval record itself — `ref.record_hash` names it, `ref.kind` states where its body is retrievable, `payload.hash` commits to its canonical bytes; facts: approver key, approval scope, decision), `counterparty-attestation` (out-of-band co-signature receipts that are external evidence per [D098](DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) / [D107](DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)), and `delegation-certificate` (the certificate carrier defined by [§1.11.8](#1118-carriage): the payload is the certificate object under the JCS hash rule or its `cert_hash` reference; facts are the [§1.11.4](#1114-verifier-walk) walk outputs). Registered after the initial set, under the same rule: `continuation-packet` (per [D142](DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions): the payload is the continuation packet a baton-pass record hands to a successor agent — raw-bytes hash rule for document media types, the `ref.record_hash` sibling spelling when the carried material is itself a signed baton-pass observation; facts are role-term routing facts, with packet bodies private by default); and `payments-detection` plus `payments-settlement` (per [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core): rail detection facts on a transaction record and a settlement recommendation document attached by hash, both owned normatively by the [atrib Payments Profile §12](docs/payments-profile.md#12-evidence-profiles); detection material and recommendation bodies stay private by default).

**Unknown-profile handling (normative).** Consumers MUST preserve envelopes whose profile URI they do not recognize, MUST render them opaquely (profile URI, tier, payload hash), MUST NOT drop them, and MUST NOT let them affect record validity — the same posture as unknown extension event types ([§1.2.4](#124-event_type-values)). Filtering to known profiles is a rendering choice, never a storage or relay behavior.

**Legacy `protocol` strings are frozen (normative).** The pre-envelope [§5.5.6](#556-generic-authorization-evidence-blocks) `protocol` string set is closed at exactly five values: `'oauth2'`, `'mcp_oauth'`, `'aauth'`, `'x401'`, `'ap2_vi'`. No new legacy protocol string may be introduced anywhere in the substrate — not in `@atrib/verify`, not in producers, not in future decision records. Every new evidence type registers as an envelope profile.

**Legacy mapping (normative).** The mapping from a legacy [§5.5.6](#556-generic-authorization-evidence-blocks) block to envelope form (`fromLegacyEvidenceBlock`) MUST be deterministic; two implementations given the same block MUST produce identical envelopes:

1. `protocol` maps to the profile URI through the fixed five-row table: `oauth2` → `https://atrib.dev/v1/evidence/oauth2`, `mcp_oauth` → `https://atrib.dev/v1/evidence/mcp-oauth`, `aauth` → `https://atrib.dev/v1/evidence/aauth`, `x401` → `https://atrib.dev/v1/evidence/x401`, `ap2_vi` → `https://atrib.dev/v1/evidence/ap2-vi`. Any other protocol string MUST be rejected; the mapping MUST NOT invent a profile URI. The table is complete and final at five rows; a sixth row is a conformance failure, not an extension point.
2. The mapped envelope carries `envelope: 1`, `profile_version: "1.0.0"`, and `tier: "attested"`. A legacy block records what a caller-owned verifier path accepted; it carries no trust roots, so the mapping MUST NOT claim `"verified"`. Consumers re-verify to raise tier.
3. `payload.hash` commits to the legacy block itself: `"sha256:" + hex(SHA-256(JCS(block)))`, with `media_type: "application/json"` and `ref.kind: "withheld"` (the legacy shape does not carry the raw external material).
4. `issuer`, `subject`, `scope`, `attenuation_ok`, and `delegation_ok` copy into `facts` unchanged (nulls preserved). When `details` is present, `facts.details_hash` is `"sha256:" + hex(SHA-256(JCS(details)))`; the `details` value itself is never inlined into the envelope.
5. `valid`, `constraints`, `errors`, and `warnings` copy into `result` unchanged.
6. The mapped envelope carries no `verifier` block: the mapping is mechanical, not a re-verification (tier rule 2).

**Deliberate commitment path.** This section adds no signed-record field. A producer that wants the *signed record* to commit to evidence uses existing mechanisms only: include `{ profile, payload_hash }` in the content hashed into `args_hash` (per the [D099](DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash) default), or emit an extension record referencing the envelope and linked via `informed_by` ([§1.2.5](#125-informed_by)). A future optional signed `evidence_hash` field would slot lexicographically after `event_type` and before `informed_by` under [§1.3](#13-canonical-serialization); it is explicitly deferred.

**Invariants.** Fact/policy separation ([§3.6](#36-implementation-notes)) is preserved: `result.valid` and `facts` are verification facts, not weights; graph services never store, derive from, or serve envelopes. The [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) cross-attestation rule stays in core: the `signers[]` array over canonical transaction bytes remains the only way to satisfy the ≥2-distinct-keys minimum, and a verifier that sees only a `counterparty-attestation` envelope still reports `cross_attestation_missing: true` ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)). Producer-side envelope writers follow the degradation contract ([§5.8](#58-degradation-contract)): catch-all, silent-failure, `atrib:`-prefixed logging; a failed envelope construction drops the envelope, never the record or the primary tool response. The envelope is the concrete shape of trust layer 7 ("external evidence") in the [§8.7](#87-adversarial-threat-model) stack: it does not certify truth, it records what a named verifier accepted.

**Conformance.** The envelope conformance corpus lives at `spec/conformance/evidence-envelope/` with eight case families: `shape/` (schema validity, closed enums, the `ref.record_hash` sibling rule), `registry/` (HTTPS type-URI rule, full-URI profile identity), `unknown-profile/` (preservation, opaque rendering), `legacy-mapping/` (the frozen five-row table with sixth-string rejection), `tier/` (instance-scoped tier semantics, relay-swap rejection, claimed-but-not-reproducible reporting, and the never-flips-`valid` invariant), `continuation-packet/` (the [D142](DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions) post-initial profile registration), and `payments-detection/` plus `payments-settlement/` (the [D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core) payments-profile registrations, including the no-profile-loaded degradation family and a [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) duplicate-signer re-pin). The generator is `packages/log-dev/scripts/generate-conformance-evidence-envelope.ts`; the reference consumer is `packages/verify/test/conformance-evidence-envelope.test.ts`. Profile-internal semantics remain authoritative in the existing corpora at `spec/conformance/5.5.6/{oauth,aauth,x401}/` and `spec/conformance/ap2-vi-crypto/`, which are referenced, not moved.

---

### 5.6 Key Management

#### 5.6.1 Key Generation

All atrib SDKs use the same Ed25519 key format defined in [§1.4.1](#141-key-format). A keypair can be generated using the atrib CLI:

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

| Variable           | Used by                  | Contents                                                                                                                                                                                                                                         |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ATRIB_PRIVATE_KEY  | @atrib/mcp, @atrib/agent | Base64url-encoded 32-byte Ed25519 seed. The public key is derived from this at runtime. This is the only value that needs to be stored and secured. See [§5.6.1](#561-key-generation) for the distinction between seed and expanded key formats. |
| ATRIB_MERCHANT_KEY | @atrib/verify            | Base64url-encoded 32-byte Ed25519 seed used to sign settlement recommendations produced by post-hoc calculation. Uses the same format as ATRIB_PRIVATE_KEY.                                                                                      |
| ATRIB_LOG_ENDPOINT | @atrib/mcp, @atrib/agent | Optional. Override for the Merkle log submission endpoint. Overrides the `logEndpoint` init option.                                                                                                                                              |

#### 5.6.3 Key Storage Requirements

The private key signs every attribution record emitted by the creator. Compromise of the private key allows forged attribution records to be submitted to the log under the creator's identity. Implementations MUST enforce the following:

- The private key MUST NEVER appear in logs, error messages, attribution records, or any transmitted data.

- The private key MUST NEVER be embedded in source code or committed to version control. The `ATRIB_PRIVATE_KEY` environment variable convention exists specifically to prevent this.

- In production deployments, the private key SHOULD be stored in a secrets manager (AWS Secrets Manager, HashiCorp Vault, or equivalent) and injected at runtime.

- SDK implementations MUST zero the key material from memory after use when the runtime supports it.

**Key compromise.** [§1.9](#19-key-rotation-and-revocation) defines the normative key rotation and revocation mechanism. Creators who believe their key has been compromised SHOULD publish a `key_revocation` record per [§1.9.1](#191-revocation-record-format) with `revocation_reason: "compromise"` (and a `successor_key` if rotating to a new key), then submit subsequent records under the new key. Verifiers honor the revocation per [§1.9.2](#192-signing-rules) (records signed at or after the revocation timestamp are flagged `revoked_after_revocation`). The [§6](#6-key-directory) directory propagates revocations to other agents and verifiers.

---

### 5.7 Automation Triggers (Normative)

This section is normative. A conforming implementation MUST fire each trigger at exactly the stated moment, with exactly the stated behavior. Implementations MUST NOT require developer input to activate any trigger. Implementations MUST NOT expose configuration options for suppressing individual triggers.

| Trigger              | When                                                                                                        | Package      | Action                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| session_init         | Before the first outbound `tools/call` in a session                                                         | @atrib/agent | Establish context_id, generate session_token, fetch and negotiate policies, create session policy record ([§5.4.2](#542-session-initialization)).                                                                                                                                                                                                                                                 |
| tool_call_outbound   | Immediately before every outbound `tools/call` request is sent                                              | @atrib/agent | Attach attribution context token to request headers and `params._meta` ([§5.4.3](#543-outbound-context-forwarding)).                                                                                                                                                                                                                                                                              |
| tool_call_inbound    | Immediately after every inbound `tools/call` response is received, if `isError: false`                      | @atrib/agent | Read and store attribution context from response. Update session state ([§5.4.4](#544-inbound-context-accumulation)). Check for transaction signal ([payments profile §3](docs/payments-profile.md#3-sdk-transaction-detection)).                                                                                                                                                                                                        |
| tool_served          | Immediately after a tool handler completes successfully (`isError: false`), before the response is returned | @atrib/mcp   | Construct, sign, and write attribution record (event_type: `tool_call` URI, or `transaction` URI if tool is in `transactionTools`; see [§1.2.4](#124-event_type-values)). Attach context token to response ([§5.3.3](#533-record-construction-and-signing)–5.3.4). Submit to log (synchronously for transaction records, asynchronously for tool_call records per [§5.3.5](#535-log-submission)). |
| transaction_detected | When `detectTransaction()` returns `true` during `tool_call_inbound` processing                             | @atrib/agent | Apply path selection rule ([payments profile §3](docs/payments-profile.md#3-sdk-transaction-detection)): if attribution token is present in the response, Path 1 is in use: update session state and skip emission. If no token, Path 2 applies: emit a `transaction` record, submit to log immediately (high priority, non-blocking), finalize session policy record.                                                                   |
| task_created         | When a `tasks/create` response is received                                                                  | @atrib/agent | Store the task ID and associate it with the current session context. Continue forwarding attribution context on subsequent requests within the task.                                                                                                                                                                                                                                              |
| task_completed       | When a task polling response indicates completion                                                           | @atrib/agent | Treat task completion as a successful `tools/call` response. Apply `tool_call_inbound` trigger logic to the final task result.                                                                                                                                                                                                                                                                    |

---

### 5.8 Degradation Contract

atrib must never impair the primary function of a tool or agent. The attribution infrastructure is invisible infrastructure; it either works silently or fails silently. It does not fail loudly.

The degradation contract is:

**Any exception thrown inside an atrib trigger handler MUST be caught by the middleware.** Exceptions MUST NEVER propagate to the tool handler, the agent, or the calling code. The middleware MUST log the exception at warning level using a prefixed label (`"atrib:"`) and continue as if the trigger did not fire.

**Any network failure during log submission MUST be handled silently with retry.** This applies equally to `tool_call` and `transaction` records; both use exponential backoff with max 3 attempts over a 30-second window. Transaction records are queued at higher priority than tool_call records but are not submitted synchronously. If all retries fail, the signed record is cached locally. The tool or agent response is not affected in any case.

**Any timeout during policy negotiation MUST fall back to the default policy.** The timeout window is 3 seconds ([§5.4.2](#542-session-initialization)). The session proceeds under default policy. The session policy record records the timeout.

**Any missing attribution context in an inbound response is not an error.** The tool simply didn't have `@atrib/mcp` installed. An OTel gap node represents this hop. The session continues.

**If `ATRIB_PRIVATE_KEY` is not set at init, the middleware MUST log a warning and operate in pass-through mode.** Pass-through mode: all requests and responses are forwarded without modification, no attribution records are emitted, no context is attached. The tool or agent operates as if the `atrib()` wrapper were not present.

The degradation contract means a developer can add `@atrib/mcp` or `@atrib/agent` to a production system with zero risk of introducing failures.

---

### 5.9 Local Mirror Conventions

_This section is normative for hosts that persist signed records locally; see [D062](DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) for the design rationale and implementation evidence._

The Merkle log ([§2](#2-merkle-log-protocol)) stores cryptographic commitments only, 90-byte fixed-size entries plus the inclusion-proof material. The original signed record JSON is unrecoverable from the log alone. Hosts that want re-verifiability against `creator_key`, autoChain seed continuity across process restarts, or richer consumer surfaces (recall, trace, summarize) MUST persist signed records to a local mirror.

This section defines the canonical local-mirror persistence shape. It is normative for any implementation that produces or consumes the local mirror; non-mirror persistence (e.g. in-memory only, ephemeral test fixtures) is unaffected.

#### 5.9.1 The two-tier persistence pattern

atrib defines two distinct persistence tiers with different design constraints:

| Tier         | Owner                 | Constraint                                                                                             | Contains                                                                                                            |
| ------------ | --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Public log   | log operator          | MUST be lean; cryptographic-evidence-only; cheap to operate; safe to share publicly                    | `record_hash`, `creator_key`, `context_id`, `timestamp`, `event_type` byte (per [§2.3.1](#231-entry-serialization)) |
| Local mirror | host (per-deployment) | MAY carry pre-sign payload context; never reaches the public log; scoped to the host's own consumption | The signed AtribRecord plus an OPTIONAL `_local` sidecar                                                            |

The local mirror is OPTIONAL, hosts that don't need re-verifiability or richer consumer surfaces MAY skip it entirely. Hosts that DO persist locally MUST follow the conventions below so cross-producer mirrors (e.g. wrapper + emit writing to the same `~/.atrib/records/` directory) are interoperable for consumers.

#### 5.9.2 The envelope shape

Each line of a local-mirror JSONL file is a JSON object of one of three shapes. Readers MUST tolerate all three.

**Shape 1: Envelope with sidecar** (current, preferred):

```jsonc
{
  "record": {
    /* the canonical signed AtribRecord, bytes IDENTICAL to what was submitted to the public log */
  },
  "_local": {
    /* OPTIONAL pre-sign sidecar; see §5.9.3 */
  },
  "written_at": 1743850000000 /* OPTIONAL wall-clock timestamp in milliseconds */,
}
```

**Shape 2: Envelope without sidecar**:

```jsonc
{
  "record": {
    /* the canonical signed AtribRecord */
  },
  "written_at": 1743850000000 /* OPTIONAL */,
}
```

**Shape 3: Legacy bare-record** (pre-[D062](DECISIONS.md#d062-local-mirror-sidecar-two-tier-private-local-public-canonical-persistence) mirrors):

```jsonc
{
  /* the canonical signed AtribRecord, unwrapped */
}
```

Producers SHOULD write Shape 1 or Shape 2 going forward. Producers SHOULD NOT write Shape 3 going forward, but consumers MUST read it for compatibility with mirrors that predate this section.

**Field placement affects signature validity.** The `_local` sidecar MUST live at the envelope level (sibling to `record`), NEVER inside `record`. Placing sidecar content inside `record` would either change the JCS canonical form (breaking signature verification) or require producers to strip the sidecar before signing (introducing failure modes that the structural placement avoids).

#### 5.9.3 The `_local` sidecar shape

The sidecar is a free-form JSON object carrying pre-sign payload context that the signed record COMMITS TO via `content_id` / `args_hash` / `result_hash` / `tool_name` (per [§1.2](#12-the-attribution-record) and [§8](#8-privacy-postures)) but does not itself contain.

The following field names are normative when present (producers SHOULD use these names; consumers SHOULD recognize them):

| Field                   | Type   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `producer`              | string | Identifies the producer that wrote this entry, for cross-source disambiguation when multiple producers write to the same mirror directory. Values are producer-specific (e.g. `"atrib-attest"`, the historical `"atrib-emit"` family, or any other wrapper / emitter package name). Historical values remain valid forever; consumers treat the label as an opaque pass-through string.                                                                                                                                                                                                                                                                                 |
| `toolName`              | string | The MCP tool name as invoked. Populated by wrapper-side producers; absent for emit-side producers (which have no tool name to record).                                                                                                                                                                                                                                                                                                                                                                                      |
| `args`                  | object | The MCP tool call arguments as invoked. Populated by wrapper-side producers per the wrapped call.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `result`                | object | The MCP tool's result object, captured BEFORE any host-side mutation (e.g. before atrib middleware writes its propagation token to `result._meta`). Populated by wrapper-side producers.                                                                                                                                                                                                                                                                                                                                    |
| `content`               | object | The pre-sign content payload as supplied to the producer, or a normalized local content payload derived from the producer's runtime evidence. Populated by `atrib-emit`-style producers per the `content` argument the agent passed; typically carries `what`, `why_noted`, `intent`, `rationale`, `topics`, `summary`, `importance` (depending on `event_type`). OpenInference producers SHOULD use this field for recall-readable span metadata rather than adding span metadata to the signed `record`.                  |
| `authorizationEvidence` | array  | Optional verifier-ready external authorization evidence captured from the host runtime, such as MCP/OAuth evidence from already-validated `authInfo`, AAuth evidence from already-validated callbacks, or x401 proof evidence from a verifier-controlled credential result or token check. This field is local-only and MUST NOT include raw bearer tokens, raw AAuth JWTs, or private credential payloads by default. Consumers can pass it to `verifyRecord(record, { authorizationEvidence })` to populate `evidence[]`. |
| `resolvedFacts`         | object | Optional local facts resolved from the payload or runtime event, such as `{ "tool_name": "read_file" }`. Consumers can pass it to `verifyRecord(record, { resolvedFacts })` so capability-envelope checks can use facts that are not in the compact signed record.                                                                                                                                                                                                                                                          |

Producers MAY add additional fields beyond this list. Consumers MUST tolerate unknown fields and SHOULD pass them through unchanged when re-emitting (e.g. when `atrib-trace` surfaces a sidecar summary for downstream tools).

All sidecar fields are OPTIONAL. A sidecar containing only `{ "producer": "..." }` is well-formed; a missing sidecar is also well-formed.

For OpenTelemetry / OpenInference producers, `_local.content` SHOULD use a stable local convention so cognitive primitives can read span-derived evidence without making observability fields part of `AtribRecord`. The recommended content fields are:

| Field family        | Fields                                                                                                                                                                                  | Purpose                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Span identity       | `source`, `span_kind`, `span_name`, `trace_id`, `span_id`                                                                                                                               | Correlate a signed record with the runtime span tree and external observability systems.                                      |
| Legibility          | `what`, `why_noted`, `intent`, `rationale`, `topics`                                                                                                                                    | Let recall, trace, and summarize display the span as human-readable context.                                                  |
| Tool payload        | `tool_name`, `args`, `result`, `input`, `output`, `input_mime_type`, `output_mime_type`                                                                                                 | Preserve local payload context. `args_hash` and `result_hash` on the signed record remain the verifier-grade commitment path. |
| Runtime metadata    | `agent_name`, `model_name`, `tool_call_id`, `llm_output_tool_call_id`                                                                                                                   | Preserve framework and model identity plus the empirical LLM-to-tool linkage key.                                             |
| Prompt metadata     | `invocation_parameters`, `prompt`, `prompt_messages`, `prompt_tools`, `prompt_tool_choice`, `prompt_template`, `prompt_template_variables`, `prompt_version`, `prompt_id`, `prompt_url` | Make prompt and prompt-version evidence findable by cognitive consumers while keeping it local by default.                    |
| Operational metrics | `usage_details`, `cost_details`, `score_details`, `metadata`                                                                                                                            | Make token, cost, score, release, user, and other operational context available to local recall and summaries.                |

These fields are local-only. They MUST NOT be submitted to the public log as part of the standard submission path. If a later verifier, handoff, settlement, dispute, or recall consumer needs one of these fields to become protocol-visible, the field needs a separate ADR and either a signed-record commitment (`args_hash` / `result_hash` or a new field) or a promoted event type under [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary).

`intent` and `rationale` are signer- or runtime-supplied claims about why the action was taken. They do not prove that the stated reason is true, complete, or human-authorized. If a host needs human approval or external intent validation to be verifier-grade evidence, it MUST carry that approval or validation as separate evidence and bind it through `args_hash`, `result_hash`, archive body material, a separate signed record cited via `informed_by`, or an external evidence block. A human-attested approval can be represented today as its own signed observation or extension record under a human-controlled `creator_key`; native human authorization edge types are future work, not a prerequisite for the current pattern.

#### 5.9.4 Submission-path invariant

Implementations of the standard submission path (the path that POSTs to the log per [§2.6.1](#261-submit-entry)) MUST NOT include the envelope or sidecar in the submitted bytes. The submission queue receives only the bare AtribRecord. The structural placement of the sidecar at the envelope level (outside `record`) means this invariant is enforced by construction in any host that uses the standard submission path; no additional guard is required.

Hosts that build custom submission paths MUST manually ensure they extract `record` from the envelope before submission and never include `_local`.

#### 5.9.5 Reading discipline

Consumers (recall, trace, summarize, autoChain seed loaders) MUST normalize the three on-disk shapes to a uniform "signed record + optional sidecar" pair at read time. The reference normalization shape:

```
function normalize(line):
  parsed = JSON.parse(line)
  if parsed has "record" and parsed.record has all required AtribRecord fields:
    return { record: parsed.record, sidecar: parsed._local || null }
  if parsed has all required AtribRecord fields:
    return { record: parsed, sidecar: null }
  return null  // skip, malformed or unknown shape
```

The exact field-presence checks are implementation-defined; the required AtribRecord fields per [§1.2.1](#121-field-definitions) are `spec_version`, `creator_key`, `chain_root`, `event_type`, `context_id`, `timestamp`, and `signature` (or `signers` for transaction records).

Consumers that build cognitive surfaces SHOULD treat `_local.content` as the canonical recall-readable payload when it exists. For compatibility with older mirror lines, consumers MAY derive equivalent content from known sibling sidecar fields: `toolName`, `args`, and `result` for wrapper-produced tool calls; `input`, `output`, `agentName`, `llmOutputToolCallId`, `traceId`, `spanId`, `spanKind`, and `spanName` for early OpenInference callback sidecars. This derivation is read-time normalization only; it does not change signed record bytes.

#### 5.9.6 Compatibility commitment

This section freezes the envelope shape for atrib spec 1.0. Future spec versions MAY add new envelope-level fields (e.g. `cached_at`, `last_verified_at`) but MUST NOT remove the `record` field, MUST NOT change its semantics, and MUST NOT introduce a path by which envelope-level content reaches the public log.

#### 5.9.7 Out of scope

- Sidecar size limits (the sidecar persists the full result object regardless of size in this spec version). A future ADR may introduce a size-cap convention or "result fingerprint" pattern.
- Encryption at rest (the mirror inherits whatever the host filesystem provides in this spec version). Operator-level encryption (FileVault, LUKS, etc.) covers most threat models; spec-level encryption is not in 5.9 scope.
- Cross-host mirror sync (e.g. when a single human operates multiple agents on multiple devices). Per-host mirrors are independent in this section; cross-host coordination is a deployment concern, not a spec concern.

---

## §6 Key Directory

_Per [D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)._

The key directory maps `creator_key` to a public identity claim. Without it, attribution is purely cryptographic. Verifiers see opaque public keys with no way to learn whose key it is. The directory is the missing semantic layer between "this record was signed by key K" and "K belongs to identity I."

The directory is built on top of an Auditable Key Directory (AKD) primitive. AKD provides authenticated label-indexed lookup, non-membership proofs, per-label append-only version chains, and operator-independent verifiability. Two configurations of the same primitive are deployed for two distinct privacy models:

- **Unblinded mode** (this section): plaintext labels. Lookups are observable to the directory operator. Suitable for atrib because `creator_key` is already public on the log.
- **VRF-blinded mode** (separate spec, intended for downstream consumers): VRF-blinded labels. Lookups are hidden from the directory operator. Required for use cases where label-to-value lookup is itself sensitive (for example, end-to-end-encrypted messaging where `user_id → key` lookup must not leak interest in a specific user).

Both modes share the AKD library and the witness model from [§2.9](#29-witnessing-and-cosignatures).

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

The directory's root commitment is periodically posted to the Tessera log ([§2](#2-merkle-log-protocol)) as a `directory_anchor` record, allowing a verifier consulting the log to detect a forked or split-view directory:

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

The directory and the log SHOULD share witnesses where possible, since witness independence is the security property verifiers rely on. A witness witnessing both gives verifiers correlated evidence at lower cost.

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

**Privacy of unblinded mode.** atrib's directory is public by design. Anyone can enumerate registered creator_keys and their claims. This matches the public log model. The VRF-blinded variant of AKD is available for downstream consumers (separate spec) where label-to-value lookup must be hidden from the directory operator.

**Directory-key rotation.** The directory operator's signing key has the same rotation problem as the log key. Same V2 deferral.

**Cross-directory federation.** Multiple directories operated by different parties cannot today produce consistent answers about the same creator_key. Federation is a V2 concern.

**Anchor freshness and witness threshold are consumer policy, not protocol.** [§6.3](#63-verifier-consultation-algorithm) describes how a verifier consumes consumer-configured thresholds; it does not prescribe specific values. A consumer expecting near-real-time identity guarantees configures a low freshness threshold (e.g., 60 seconds) and high witness threshold (e.g., ≥3 cosignatures). A consumer doing batch settlement reconciliation configures a high freshness threshold (e.g., 24 hours) and accepts lower witness counts. The protocol surfaces the signals; the policy lives in the consumer.

**Anchor-window equivocation in batched directories.** If a directory operator opts into batching per [§6.2.4](#624-anchor-cross-reference-into-the-tessera-log), queries within the batch interval observe directory state that has not yet been anchored. Verifiers surface `directory_batching_window_ms`; consumers wanting per-operation guarantees configure their trusted-directory list to include only per-operation operators.

---

### 6.7 Capability Declarations

_This section is normative; the declaration itself is OPTIONAL._

[§6.1](#61-identity-claim-format) (identity claim format) resolves a `creator_key` to an identity ("this key belongs to Acme Corp's official agent"). Identity attestation answers WHO; it does not answer WHAT THE KEY IS ALLOWED TO DO. Without a capability framework, a compromised but legitimately-attested key can sign records of any kind, a customer-service agent's key suddenly signing million-dollar transactions verifies cryptographically the same as a normal action.

Capability declarations turn the static identity claim into a dynamic policy claim: the directory publishes the key's declared capability envelope. Verifiers check records against the envelope; out-of-envelope records are flagged.

#### 6.7.1 Identity claim extension

The [§6.1](#61-identity-claim-format) identity claim format gains an OPTIONAL `capabilities` field:

```jsonc
{
  "creator_key": "...",
  "claim_type": "domain_verified",
  "claim_method": "...",
  "claim_subject": {
    /* identity content per [§6.1](#61-identity-claim-format) */
  },
  "capabilities": {
    "tool_names": ["search", "browse", "read_email"], // optional allowlist; absent = no constraint
    "max_amount": {
      // optional cap on transaction amounts
      "currency": "USD",
      "value": 1000,
    },
    "counterparties": ["acme.com", "verified.example"], // optional allowlist of transaction counterparties
    "event_types": [
      // optional allowlist of event_type URIs
      "https://atrib.dev/v1/types/tool_call",
      "https://atrib.dev/v1/types/observation",
    ],
    "cost_policy": {
      // optional compute-spend scope for delegated runs (D165)
      "model_tiers": ["economy", "standard"], // optional allowlist of host-defined tier labels
      "max_tokens": 500000, // optional total token budget for the certified run
    },
    "expires_at": 1761000000000, // optional; envelope rotates with the identity claim
  },
}
```

All capability sub-fields are individually optional. A claim with `capabilities: {}` declares no scope (equivalent to omitting the field). A claim with some sub-fields and not others applies only the present constraints. `cost_policy` scopes what a key may spend rather than what it may do: `model_tiers` is an allowlist of host-defined tier labels (free-form strings, the `tool_names` idiom) and `max_tokens` caps total token spend. Its primary carrier is the [§1.11](#111-delegation-certificates) certificate scope, where a principal grants a delegated run a compute budget; the protocol records the grant and never enforces it.

#### 6.7.2 Verifier semantics

A verifier that has resolved a record's `creator_key` to an identity claim with a `capabilities` field MUST:

1. Determine the active envelope at the record's `timestamp`. The active envelope is the most recent identity claim published in [§6.2](#62-directory-operations) history at or before the record's timestamp. If no envelope was active at that time, the record is treated as having no envelope constraint.
2. Check the record's content against the envelope:
   - If `tool_names` is present, the record's `tool_name` MUST be in the list (for tool_call records). The verifier MAY use a `tool_name` field disclosed on the record or caller-supplied facts resolved from the local record body or upstream protocol event. If no tool name is available, the verifier MUST flag the check as `unresolvable: true`.
   - If `event_types` is present, the record's `event_type` URI MUST be in the list.
   - For transaction records, if `max_amount` and/or `counterparties` are present, the verifier MUST resolve the transaction amount and counterparty from the protocol-specific transaction event the record commits to (per [§1.7](#17-transaction-event-hooks)'s payment-protocol definitions: ACP order envelope, UCP envelope, x402 PAYMENT-RESPONSE header, MPP Payment-Receipt, AP2 CheckoutReceipt or PaymentReceipt, a2a-x402 receipts). The resolved amount MUST NOT exceed `max_amount`; the resolved counterparty MUST be in the `counterparties` allowlist. When the protocol-specific event is not available out-of-band or through caller-supplied resolved facts, the verifier MUST flag the check as `unresolvable: true` rather than passing or failing silently.
   - If `cost_policy` is present, the constraint is evaluable only against caller-supplied usage facts (model tier label, tokens spent): signed records carry neither, since spend accounting lives in local sidecar and join-record content per the [D142](DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions) orchestration conventions. With usage facts, the claimed tier MUST be in `model_tiers` and claimed spend MUST NOT exceed `max_tokens`; mismatches are named `cost_policy.model_tiers` / `cost_policy.max_tokens`. Without usage facts the check produces no mismatch (nothing checkable is claimed).
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

When a key's capabilities change, the operator publishes a new identity claim with the updated envelope. The [§6.2](#62-directory-operations) directory history preserves prior envelopes; verifiers checking historical records use the envelope active at the record's timestamp.

**Operational separation of publication and signing.** The envelope check's security depends on the publication channel for identity claims being on a different operational footing than agent operation. If an attacker compromises the agent's signing key AND can publish identity claims for that key, they can backdate or expand the envelope to retroactively legitimize forged actions. Operators MUST keep these channels separated; co-location collapses the envelope check to "agent-key-equivalent" trust and provides no additional security beyond what [§6](#6-key-directory) identity attestation alone provides. Operators that combine the channels MUST document the reduced trust posture in their consumer-facing documentation; verifiers MAY refuse capability-check enforcement for keys whose identity-claim publication channel is not separately attested.

**Time-of-check vs time-of-use.** The envelope active at the record's `timestamp` (per [§6.7.2](#672-verifier-semantics) step 1) is the verifier's reference. An attacker who compromises both the signing key and the publication channel can backdate envelope publications. [§1.9](#19-key-rotation-and-revocation) key revocation provides the recovery path: when compromise is discovered, the operator publishes a `key_revocation` record with `reason: compromise`, and verifiers tag all subsequent records under that key as `revoked_after_revocation`. Records signed before revocation are flagged as suspect retroactively but not invalidated. Cross-witnessing ([§2.9](#29-witnessing-and-cosignatures)) of the directory's checkpoints raises the bar against silent envelope-publication tampering: a backdated publication that was not previously witnessed is detectable.

#### 6.7.5 No protocol-level enforcement at signing time

atrib does not block out-of-envelope submissions or refuse to commit them. Enforcement is consumer policy at the verification layer. Consumers wanting signing-time enforcement build it into their middleware (e.g., the `@atrib/agent` adapter could refuse to sign records that violate a locally-cached envelope).

See [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) for the design rationale and the alternatives considered.

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

A harness exposes a tool (typically MCP) like `recall` (or its legacy `recall_my_attribution_history` alias) that the agent calls on-demand. The tool reads a local mirror of signed records, verifies signatures, and returns paginated records. Filters by trace, event type, and time window are useful.

**Why this pattern.** Lazy: the agent pays the token cost only when it actively wants to consult its past. Composes cleanly with the session-start pattern (the start surface tells the agent the tool exists; the tool serves the content).

**Where it falls short.** The agent has to know to call it. Some agents won't unless explicitly nudged.

### 7.3 The persisted-mirror pattern

A harness writes every signed record to a local jsonl mirror as the wrapper produces it (via `onRecord` from [§5.3](#53-atribmcp-mcp-server-middleware)). The mirror is durable across sessions and harness restarts. Other consumers (the recall tool from 7.2, an offline replay verifier, a compliance audit pipeline) read from the mirror.

**Why this pattern.** Closes the gap between "the log stores commitments only" and "the original signed bytes are recoverable for re-verification." Without this, a verifier replaying signatures has no source for the canonical record bytes other than transient memory inside the wrapper.

**Where it falls short.** The mirror is operator-local. Multiple agents running on different machines with the same creator key produce divergent mirrors that don't reconcile automatically. Cross-host reconciliation is a V2 concern.

### 7.4 Composing the patterns

A complete harness integration usually combines all three: the wrapper persists records to a mirror as it signs them (7.3); a session-start hook reads the mirror to surface a shape-only summary (7.1); a tool wired into the agent surface returns content from the mirror on demand (7.2). The recall tool can also verify signatures locally before returning, so the agent's read of its own past is independently re-verifiable, not "trust the mirror."

The reference implementation atrib ships under this pattern is `@atrib/recall` (a single-tool MCP server consuming the mirror). It is one shape among many; harness builders are encouraged to adapt rather than copy.

### 7.5 Harness-side reasoning chains

Agents reason between actions. atrib does not standardize what reasoning _is_: reasoning shapes vary too much across harnesses (ReAct, chain-of-thought, scratchpad, multi-agent debate, plan-and-execute) for any single shape to be observably canonical. Harnesses that want to capture deliberation as part of the verifiable record do so via extension URIs in their own namespace, linked to surrounding actions via the `informed_by` field defined in [§1.2.5](#125-informed_by).

**The pattern.**

The harness mints an extension URI in a namespace it controls (e.g., `https://example.com/v1/types/reasoning_step`). Between tool_call records, the harness emits records carrying that URI with the agent's reasoning content (or a hash/commitment of it, depending on privacy posture). When the agent emits a subsequent tool_call, the harness includes the reasoning record's hash in the tool_call's `informed_by` field.

A verifier reading the chain sees the reasoning records inline ([D043](DECISIONS.md#d043-extension-uri-participation-in-graph-derivation): extension URIs participate in CHAIN_PRECEDES), the explicit linkage from tool_calls to reasoning records ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type): INFORMED_BY edges), and the temporal ordering. The verifier can independently audit the agent's claimed reasoning chain.

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

Tools that want their responses to be verifiable sign the response. Specifically: the tool returns its content along with a signature over a canonical serialization, using a key the verifier can resolve (via DNS, the [§6](#6-key-directory) directory, or a tool-specific PKI). The agent sets `result_hash` to the SHA-256 of the tool's signed response (or to the signature itself, depending on commitment scheme).

A verifier with access to the tool's pubkey fetches the signed response (when available out-of-band) and confirms the agent's `result_hash` commitment matches what the tool actually signed. The trust now flows from the tool, not the agent.

This pattern requires tool cooperation. It does not change atrib's spec; the `result_hash` field already accommodates any 32-byte commitment. Tools that adopt this pattern publish their pubkey discovery method out-of-band.

**Pattern B: external witness records.**

For high-stakes outcomes (transactions especially), a downstream observation record carries an external proof: a chain transaction ID, an exchange settlement ID, an HTTPS Signed Exchange, etc. The verifier follows the external proof out-of-band and cross-checks against the agent's claimed outcome.

Example: an x402 payment tool_call is followed by an observation record committing to the on-chain transaction hash. The verifier can independently query the chain for the transaction and confirm it matches.

This pattern uses existing primitives (observation records per [D042](DECISIONS.md#d042-lift-observation-graph-participation-restriction) + chain ordering) and requires no spec changes.

**What both patterns share.**

The verifier's trust shifts from "agent says the tool returned X" to "the tool itself attests it returned X" (Pattern A) or "the world independently confirms the outcome occurred" (Pattern B). Neither is normative; both are documented patterns consumers adopt as their threat model requires.

### 7.7 Signed diagnostic outcome + trace replay

Repair and refinement tasks often need more than a record of what the agent did. They need a signed account of what happened when that prior action was evaluated, linked back to the action it evaluated, so a later agent can replay the signed evidence path without reading the whole session.

**The pattern.**

1. The harness signs the implementation or action record as usual.
2. The harness runs a diagnostic, evaluator, verifier, test suite, or external check against that action.
3. The harness signs the diagnostic outcome as a `tool_call` record. The diagnostic record's `informed_by` field references the implementation/action record hash it evaluated. Its `tool_name` identifies the evaluator, `args_hash` commits to the diagnostic input, and `result_hash` commits to the diagnostic outcome.
4. The local mirror body for the diagnostic record SHOULD include enough structured detail for a consumer to act without guessing: suite id, pass/fail counts, per-case names, inputs, expected values, actual values, and error or diagnostic text when present.
5. A later repair/refinement step walks backward from the diagnostic record hash (the `recall` verb with a backward walk shape, or the legacy `trace` alias) with a bounded depth and `include_content=true`. The trace returns the diagnostic outcome plus the implementation/action ancestor through the existing `informed_by` edge.

**Consumer interpretation.**

In repair and refinement contexts, a diagnostic outcome record is evidence about the action it evaluates. When the diagnostic record's expected/actual outcome conflicts with the implementation/action ancestor, the consumer SHOULD treat the diagnostic outcome as the repair target and the ancestor as the prior behavior being evaluated. This is not a new graph rule and does not change attribution weights; it is a consumer-side evidence rule for interpreting a signed trace.

This rule is generic. It applies to tests, validators, linters, external verifiers, transaction-status checks, and other outcome-producing evaluators. Harnesses SHOULD express the task class ("repair", "refinement", "regression follow-up", "audit replay") plainly to the agent so the agent knows how to use the evidence. That is different from bespoke prompt nudging: the substrate shape and the precedence rule stay stable across tasks.

**Why no new event type.**

A diagnostic outcome is still an observed tool action for v1 purposes: an evaluator was run with inputs and produced a result. The existing `tool_call` event type plus `tool_name`, `args_hash`, `result_hash`, local mirror content, and `informed_by` linkage are sufficient. A dedicated diagnostic event type would need evidence that downstream consumers require distinct graph derivation or settlement behavior, which this pattern does not require.

**What this does not claim.**

This pattern does not prove the diagnostic is true unless the diagnostic tool or an external witness also attests the result per [§7.6](#76-outcome-verification-patterns). It proves the harness signed an outcome record and linked it to the evaluated action. Consumers decide how much to trust the evaluator.

### 7.8 Cross-harness continuation packets

Long-running work often starts in one harness and continues in another. A support ticket may trigger a hosted agent, the hosted agent may post a result into a Slack thread, and an engineer may then continue the investigation in Claude Code or Codex. The public log proves that signed records exist, but it does not carry enough private context for the next harness to act. A continuation handoff therefore needs a packet outside the log.

**The pattern.**

A continuation packet carries the minimum material a receiving harness needs to resume a task without guessing:

1. **Upstream anchors:** `context_id`, latest `record_hash`, latest chain tail, parent dispatch record hash when the packet continues a subagent spawn, and any `provenance_token` the receiving session should use if it starts a fresh trace.
2. **Body access:** local mirror bundle, archive references, or both for the record bodies the receiving agent may need. Tier 1 log commitments are not enough when the agent must inspect signed content.
3. **Redacted evidence:** ticket, tenant context, request/response body, log-query, code-read, diagnostic, support-thread, and external-system references with hashes, scopes, and redaction policy. Operational evidence stays in the evidence systems; atrib proves how the agent used it.
4. **Skill and domain context:** skill pack names, versions, hashes, and domain reference documents that shaped the investigation. If the hosted run used a billing-investigation skill but the local continuation does not load it, that is a real continuity break.
5. **Runtime diagnostics:** tool availability, MCP auth status, skill-loading status, hosted memory and filesystem status, codebase checkout identity, and any failed hosted-agent capabilities. Diagnostic failures SHOULD be signed using the pattern in [§7.7](#77-signed-diagnostic-outcome--causal-trace-replay).
6. **Privacy posture:** which bodies are public, archived, local-only, salted, redacted, or withheld. The packet MUST NOT weaken the per-record posture chosen under [§8](#8-privacy-postures).

The packet MAY be carried privately by the support system, by a handoff message, or by a harness-specific extension record such as `https://example.com/v1/types/continuation_packet`. If it is emitted as a record, it participates in the normal chain and SHOULD use `informed_by` to point at the latest upstream record and any diagnostic records that shaped the handoff.

**Why no continuation primitive.**

Continuation is a packaging concern over existing primitives, not a new cognitive act. The receiving agent can use the `recall` verb to accept or reject the packet's signed evidence (the `verification` parameter, legacy `atrib-verify`), read local records (shape-dispatched lookups, legacy `recall_*`), and walk the upstream chain (walk shapes, legacy `trace`); a harness-side digest can condense the context, and `atrib-emit` / `atrib-revise` / `atrib-annotate` to continue the work. A dedicated continuation primitive would duplicate those verbs.

**Trust boundary statement.**

A continuation packet proves only what is signed and linked. It does not prove that a ticket, log result, or skill file is true unless those artifacts are independently attested per [§7.6](#76-outcome-verification-patterns). It also does not make private evidence public. The packet is a way to move verifiable context across harness boundaries while preserving the separation between the public log, producer-local mirrors, optional archives, and external evidence stores.

### 7.9 What the patterns DO NOT do

**They do not validate log inclusion.** Local signature verification proves "this record was signed by that creator_key." It does not prove "this record was committed to log.atrib.dev." A harness that needs the inclusion guarantee fetches an inclusion proof from the log per [§2](#2-merkle-log-protocol).

**They do not enforce identity claims.** A harness can resolve `creator_key` to an identity claim via the directory ([§6](#6-key-directory)) but does not enforce trust in any particular claim. Trust policy is consumer-side.

**They do not prescribe agent behavior.** atrib makes the past provable. What the agent does with that past, whether it reasons more carefully, defers to its prior commitments, or recommends past actions to itself, is agent-level concern, not substrate-level concern.

---

## §8 Privacy Postures

_This section is normative._

atrib's substrate is public by design. Disclosure within that substrate is configurable: harnesses choose how much each record reveals about the underlying action, on a per-field basis. The choice is encoded in each record's structural shape, so verifiers detect the posture from record bytes without out-of-band metadata.

This section defines four normative postures. Each may be combined with the others freely; combinations compose without interaction.

### 8.1 Default posture

The default behavior preserved from v1: plain SHA-256 hashes for `args_hash` and `result_hash`, millisecond timestamps, verbatim `tool_name` strings. Maximum auditability. Records that do not opt into other postures are assumed to use the default.

### 8.2 Opaque-name posture

`tool_name` (the optional MAY field on the record per [§1.2.1](#121-field-definitions)) MAY be one of:

- **Verbatim** (default): a human-readable string identifying the tool (e.g., `book_flight`, `transfer_usdc`). Maximum disclosure of intent.
- **Opaque label**: a string matching `[a-z0-9_-]{1,64}` with no required mapping to a real tool name (e.g., `tool_a7f3`, `op_42`). Hides what the tool does without breaking record format.
- **Hashed**: a string matching `sha256:<64 lowercase hex>` representing the SHA-256 of the verbatim name. Verifiers configured with a name-mapping can resolve; others see only the hash.

Verifiers indicate the detected form: `tool_name_form: "hashed" | "plain" | null` per [D061](DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121).

- `"hashed"` when the value matches `^sha256:[0-9a-f]{64}$` (unambiguous).
- `"plain"` for any other present value (a verbatim name like `book_flight` and an opaque label like `tool_a7f3` both match the opaque-label regex `[a-z0-9_-]{1,64}` and are NOT structurally distinguishable; verifiers MUST NOT assert one over the other from the record value alone).
- `null` when the field is absent from the record (the [§8.1](#81-default-posture) default posture).

The verbatim-vs-opaque distinction is a producer-side intent: the signer chooses whether their `tool_name` carries semantic meaning. Consumers wanting to enforce the distinction MUST do so via out-of-band metadata (e.g., a name registry), not by parsing the record value.

### 8.3 Salted-commitment posture

`args_hash` and `result_hash` (the optional MAY fields on the record per [§1.2.1](#121-field-definitions)) MAY use salted commitments. Two schemes are defined; they have meaningfully different privacy properties and consumers MUST pick the one that matches their threat model. When `args_hash` / `result_hash` is absent from the record entirely, the [§8.1](#81-default-posture) default posture applies and verifiers cannot independently confirm the commitment (they can verify the record's signature and structure, but the content claim is unverifiable without the hash field).

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

| Granularity           | Multiple of (ms) | Example         |
| --------------------- | ---------------- | --------------- |
| millisecond (default) | 1                | `1743850123456` |
| second                | 1000             | `1743850123000` |
| minute                | 60000            | `1743850080000` |
| hour                  | 3600000          | `1743847200000` |
| day                   | 86400000         | `1743811200000` |

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

| tool_name | args_hash     | timestamp | Disclosure                                                                                                                        |
| --------- | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| verbatim  | plain-sha256  | ms        | Default; maximum auditability. Full forensic trail.                                                                               |
| opaque    | salted-sha256 | min       | Action kind hidden, args content protected from pre-image enum, working-hour pattern blurred.                                     |
| hashed    | hmac-sha256   | day       | Action visible only to verifiers with name-mapping, args fully protected from non-key-holders, only date-level timing observable. |

A consumer chooses the combination that matches their threat model. atrib does not prescribe any particular combination; the postures are independent dials.

### 8.6 Threat model

_This subsection is informative._ The standalone-posture descriptions ([§8.1](#81-default-posture)-[§8.5](#85-combined-postures)) are normative; the combined-posture outcomes below are reasoned consequences of composing the standalone postures. They are listed as illustrative threat-modeling guidance, not as additional normative claims that implementations must independently validate.

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

In all postures the agent's identity (`creator_key`) and the structural graph remain observable. Identity privacy requires a different mechanism ([D033](DECISIONS.md#d033-key-rotation-and-revocation) key rotation, deferred [D038](DECISIONS.md#d038-per-conversation-key-derivation) per-conversation key derivation). Structural privacy requires a different layer (anonymous credentials, mix nets) outside this spec.

### 8.7 Adversarial threat model

_This section is normative._

[§8.1](#81-default-posture) through [§8.6](#86-threat-model) specify privacy postures: how a record's structural shape configures disclosure to a passive observer of the public log. This subsection covers a different threat model: an active adversary who can produce or influence atrib records. Examples include an attacker who compromises a creator_key and signs malicious records, an agent operator who knowingly signs false claims about tool calls or transactions, a tool operator who returns falsified responses, and a log operator who attempts to censor or equivocate. The substrate's response to these threats is shaped by what cryptographic signatures fundamentally CAN and CANNOT prove.

#### 8.7.1 The fundamental limit

A signature proves "the holder of this key signed these bytes." It cannot prove the bytes are true. This is a property of cryptographic signatures, not a limitation specific to atrib. Certificate Transparency has the same property: CT proves a certificate was issued and committed to the log; it does not prove the certificate's claims are accurate or that the issuing CA was uncompromised. atrib inherits this trust model.

A poisoned atrib record (one carrying false claims, signed by a compromised key, or emitted by a malicious actor) verifies cryptographically the same as a legitimate one. Both have valid signatures, both chain correctly, both appear in the log. The substrate certifies what was signed, not whether the signed claim is true.

This limit is intrinsic to any signed-attestation system. A spec or product that claims to defeat it is overpromising.

#### 8.7.2 Layered trust assessment

Truth assessment is layered above the signature primitive. atrib provides several mechanisms that contribute to a verifier's confidence assessment of any individual record:

| Layer | Mechanism                                                                                                   | What it adds                                                                                                        | What it does NOT rule out                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Signature + log inclusion ([§1.4](#14-signing-and-verification) + [§2.7](#27-inclusion-proof-verification)) | Forgery, alteration, deletion, equivocation about whether the record exists                                         | Compromised key; signer knowingly false content; signer malicious                              |
| 2     | Identity attestation ([§6](#6-key-directory))                                                               | Anonymous actors hiding behind opaque keys                                                                          | Identities making false claims; identities whose operational security is compromised           |
| 3     | Capability declarations ([§6.7](#67-capability-declarations))                                               | Out-of-scope claims by an otherwise-attested identity                                                               | Coordinated compromise of both the signing key AND the publication channel for identity claims |
| 4     | Key revocation ([§1.9](#19-key-rotation-and-revocation))                                                    | Silent compromise; verifier sees the revocation reason and tags subsequent records                                  | Past records being false (only flagged retroactively as suspect, not invalidated)              |
| 5     | Cross-attestation for transactions ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records))   | Single-key compromise fabricating transactions                                                                      | Collusion between agent and counterparty; both parties' keys compromised; two distinct but untrusted keys signing the same bytes (a Sybil/corroboration attack), unless the verifier additionally requires the signer keys to be in its trust set per [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) |
| 6     | Tool-side response signing ([§7.6](#76-outcome-verification-patterns) Pattern A)                            | Agent fabricating tool results                                                                                      | Collusion between agent and tool operator; tool operator compromised                           |
| 7     | External evidence ([§7.6](#76-outcome-verification-patterns) Pattern B)                                     | Agent claiming outcomes that did not occur in the world                                                             | External system itself being compromised                                                       |
| 8     | Witnessing ([§2.9](#29-witnessing-and-cosignatures))                                                        | Log operator equivocation at the checkpoint level; selective censorship of checkpoints                              | Compromise of individual signing keys; record-level censorship by the log operator             |
| 9     | Anchor plurality       ([§2.11](#211-cross-log-replication))                                                 | Single-anchor-operator censorship, equivocation, data loss; record-level discrepancies between anchors                    | Collusion across all anchors in the trusted set                                                   |
| 10    | Structural anomaly detection (consumer-side)                                                                | Implausible patterns: bursts, dangling references, contradictory claims, statistical oddities in hash distributions | Subtle attacks that evade pattern detection                                                    |

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

A complementary mechanism queued for follow-up ([D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up)): records cite the inclusion proofs of prior records, creating a web of mutual confirmation. If a log operator later removes or alters a referenced record, citing records still point at proof of the prior state. This would defend at the record level, complementing [§2.9](#29-witnessing-and-cosignatures) (checkpoint-level witnessing) and [§2.11](#211-cross-log-replication) (cross-log replication).

The mechanism is queued rather than specified because the design needs careful work on sequencing (chicken-and-egg with checkpoint witnessing), interaction with cross-log replication (which proofs to cite), storage growth (every record gains another reference list), and failure modes. [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) documents the intent and known design questions; the formal ADR will follow when the mechanism is added to the spec.

**Important:** [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) is a placeholder, not a normative commitment. The eventual specification of inclusion-proof aggregation MAY differ from [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up)'s sketch in any technical detail. Cross-references to it MUST treat the substance as forward-looking.

#### 8.7.6 Attestation corroboration (extension)

_This subsection is normative for verifiers that consume attestation records; the attestation record itself is an extension per [§1.2.4](#124-event_type) and [D150](DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first)._

Cross-attestation ([§1.7.6](#176-cross-attestation-requirement-for-transaction-records), Layer 5) is corroboration by CO-SIGNATURE of shared transaction bytes. Attestation generalizes Layer 5 corroboration off the transaction type and off shared-bytes co-signing: a signer that is NOT a record's producer vouches for that record by independent REFERENCE. This is the durable, third-party, aggregatable corroboration that neither cross-attestation (transaction-only, shared-bytes co-signature) nor handoff verification ([§5.5.5](#555-handoff-claim-verification), which checks a record's OWN signer against a trust set) can express.

**Attestation record.** An attestation is a record with `event_type` the extension URI `https://atrib.dev/v1/extensions/attestation` whose content is `{ attests: 'reliable', target: '<record_hash of X>', reason? }`. The content MUST be committed via `args_hash` ([§8.3](#83-salted-commitment-posture), [D099](DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash)) so the reference is tamper-evident: a valid signature over the record commits to `args_hash`, and `args_hash` commits to the content. Per [D080](DECISIONS.md#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion) attestation ships as an extension, not a normative `event_type` byte, until real use justifies promotion.

**Corroboration verdict.** Given a target record X and a set of attestation records, a verifier that requires trusted corroboration MUST count an attestor only when: the record's signature verifies, its `event_type` is the attestation extension URI, its committed content carries `attests: 'reliable'` and `target` equal to X's record_hash, and its signer key is NOT X's producer key (self-attestation MUST NOT count). Verifiers MUST NOT count annotation records ([§1.2.7](#127-annotates)) as corroboration; only the reserved `attests` marker qualifies. Distinct verified attestor keys give `attestors_valid`; a verifier supplied a trust set additionally surfaces `attestors_trusted` (distinct verified attestors in the trust set) and reports non-malleable corroboration only when `attestors_trusted` meets the caller's minimum (default 2), reusing the [§1.7.6](#176-cross-attestation-requirement-for-transaction-records) trusted signer composition. As with cross-attestation, this verdict is a signal: it MUST NOT by itself invalidate any record. A fail-closed "require N corroborators" gate is host-owned ([§7.6](#76-external-evidence) enforcement pattern, `@atrib/action-gate`), not a verifier behavior.

---

## Appendix A: Test Vectors

The following test vectors are generated from the reference implementation. Two independent implementations that produce identical outputs for these inputs are interoperable.

All values are deterministic given the inputs. Ed25519 signing with a fixed seed produces a fixed signature.

This appendix is normative. A conforming implementation MUST produce outputs identical to these test vectors for the given inputs.

### A.1 Key Material

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Private key seed (hex) | `0101010101010101010101010101010101010101010101010101010101010101` |
| Public key (hex)       | `8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c` |
| Public key (base64url) | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w`                      |

### A.2 Record Fields

| Field                | Value                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| spec_version         | `atrib/1.0`                                                               |
| event_type           | `https://atrib.dev/v1/types/tool_call`                                    |
| timestamp            | `1700000000000`                                                           |
| context_id           | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`                                        |
| creator_key          | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w`                             |
| content_id           | `sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e` |
| chain_root (genesis) | `sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547` |

### A.3 Canonical Signing Input ([§1.3](#13-canonical-serialization))

The signing input is `JCS(record without signature)`:

```
{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547","content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e","context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","event_type":"https://atrib.dev/v1/types/tool_call","spec_version":"atrib/1.0","timestamp":1700000000000}
```

SHA-256 of signing input (hex): `e2ad8c62656a32b381c9b4c6b55fb13529e8843ffcdd0f03a80bb1afb87a9676`

### A.4 Signature ([§1.4](#14-signing-and-verification))

| Field                 | Value                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Signature (base64url) | `ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg`                                           |
| Signature (hex)       | `64c8ed19a505c69dcde19036570d3934183c2a2ca639d3512f7b9107f409fb330aecc54e041aad380d712e8f8332678b65f8d68df045c2b1ed41e9a8c575cc06` |
| Verification passes   | `true`                                                                                                                             |

### A.5 Canonical Record and Record Hash

The canonical record is `JCS(complete record with signature)`:

```
{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547","content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e","context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","event_type":"https://atrib.dev/v1/types/tool_call","signature":"ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg","spec_version":"atrib/1.0","timestamp":1700000000000}
```

| Field                   | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Record hash (hex)       | `ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c1` |
| Record hash (base64url) | `6m-0E8Ukq1dnUgUW_7iuOKdDkfeJIXfgI29fLeUjucE`                      |

### A.6 Propagation Token ([§1.5.2](#152-http-transport-tracestate))

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Token  | `6m-0E8Ukq1dnUgUW_7iuOKdDkfeJIXfgI29fLeUjucE.iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w` |
| Format | `base64url(record_hash) + "." + base64url(creator_key)`                                   |

### A.7 Chain Root for Next Record

| Field                        | Value                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| chain_root                   | `sha256:ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c1` |
| Format                       | `"sha256:" + hex(record_hash)`                                            |
| Matches record_hash from A.5 | `true`                                                                    |

### A.8 Log Entry Serialization ([§2.3.1](#231-entry-serialization))

| Field                 | Value                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry (hex, 90 bytes) | `01ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c18a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000018bcfe5680001` |
| Entry length          | `90`                                                                                                                                                                                   |

Byte layout:

- Byte 0: version (`0x01`)
- Bytes 1-32: record_hash (32 bytes)
- Bytes 33-64: creator_key (32 bytes)
- Bytes 65-80: context_id (16 bytes)
- Bytes 81-88: timestamp_ms (uint64 big-endian)
- Byte 89: event_type (`0x01` = `https://atrib.dev/v1/types/tool_call`)

### A.9 Merkle Tree ([§2.3.2](#232-leaf-hash-computation), [§2.7](#27-inclusion-proof-verification))

**Single-entry tree (tree_size = 1):**

| Field                         | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| Leaf hash                     | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Leaf hash (base64)            | `QkwgK0bCRoqaYpWMhBw4iEtTRUNBzQwyYpbdLNwxA38=`                     |
| Root (= leaf hash for size 1) | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Inclusion proof               | `[]` (empty for single-entry tree)                                 |
| Verification passes           | `true`                                                             |

**Two-entry tree (tree_size = 2):**

| Field                       | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Leaf 0 hash                 | `424c202b46c2468a9a62958c841c38884b53454341cd0c326296dd2cdc31037f` |
| Leaf 1 hash                 | `5133c40d0435ff1b7db13abebf7a417c03dbe86309ca8ed9121e04cf1d728866` |
| Root                        | `bfec13ffa5af1f27d9c878c6557aaf480686a34789b2c8b8630ce0c644817398` |
| Inclusion proof for index 0 | `["UTPEDQQ1/xt9sTq+v3pBfAPb6GMJyo7ZEh4Ezx1yiGY="]`                 |
| Inclusion proof for index 1 | `["QkwgK0bCRoqaYpWMhBw4iEtTRUNBzQwyYpbdLNwxA38="]`                 |

Leaf hash computation: `SHA-256(0x00 || entry_bytes)`
Internal node hash: `SHA-256(0x01 || left || right)`
Root of 2-entry tree: `SHA-256(0x01 || leaf_hash_0 || leaf_hash_1)`

### A.10 Vector Cases for Optional Fields and Postures

The vectors in §A.1 through §A.9 cover the minimal record shape (default posture, no optional fields). The conformance corpus at [`spec/conformance/1.4/`](spec/conformance/1.4/) extends these with byte-level vectors covering each optional field and posture combination introduced in [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section), [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), and [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records). It also includes adversarial vectors from [D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus), covering malformed inputs, bad signatures, wrong creator keys, and JCS ordering edge cases. The dedicated [`spec/conformance/1.2.6/`](spec/conformance/1.2.6/) corpus provides the four cases that define the [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) `provenance_token` field (canonical-form invariance with the field present, upstream-derivation rule, genesis-only invariant rejection, absence-not-null contract). Implementations MUST produce outputs identical to the corpus vectors for the inputs the corpus specifies.

The full graph edge-derivation corpus at [`spec/conformance/3.2.4/`](spec/conformance/3.2.4/) covers the normative [§3.2.4](#324-edge-derivation-rules) edge rules. The reduced response-shape corpus at [`spec/conformance/3.4.1/`](spec/conformance/3.4.1/) remains specific to `/v1/graph/{context_id}` compacting behavior.

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
13. **transaction with duplicate signer key rejection**: transaction record carries 2 entries from the same `creator_key`; verifier counts 1 distinct valid signer and flags `cross_attestation_missing: true`.
14. **combined posture**: record carries opaque tool_name + salted commitments + minute timestamp + informed_by. Validates that postures compose without interaction.
15. **multi-log proof bundle**: record bundle carries proofs from 2 logs in `log_proofs` array per [§2.11.3](#2113-proof-bundle-format-extension). Validates verifier-side threshold and equivocation detection.
16. **PROVENANCE_OF derivation**: pair of records where downstream's `provenance_token` derives from upstream's hash; derivation produces correct PROVENANCE_OF graph edge per [§3.2.4](#324-edge-derivation-rules) step 7.

The corpus is generated from the reference implementation; a conforming implementation produces identical bytes for the inputs in `inputs.json` of each vector directory. The Appendix A vectors above and the corpus vectors are jointly normative.

---

## §9 Runtime Integration Patterns

_This section is informative._

[§7](#7-harness-integration-patterns) covers how a harness consumes atrib once it is mounted: the agent-side surfacing, recall, and reasoning patterns. This section covers the orthogonal axis: how a runtime mounts atrib in the first place. The two are independent, a runtime picks one [§9](#9-runtime-integration-patterns) integration pattern (sometimes more than one) AND any subset of [§7](#7-harness-integration-patterns) consumption patterns.

Seven integration patterns cover every runtime category surveyed in atrib's harness field study (48 harnesses across IDE-integrated, multi-agent SDK, autonomous, browser-use, sandboxed, and managed-cloud categories). **None is canonical.** Each pattern is a candidate scope for the [D048](DECISIONS.md#d048-plug-and-play-enforcement-contract-for-adapters) conformance contract; in atrib v1 the contract specifies Pattern #3 in detail (callback / lifecycle handlers in `@atrib/agent`), and per-pattern conformance test surfaces will land alongside each pattern's reference implementation. A runtime builder picks the pattern its ergonomics support; multiple patterns can compose for one runtime when the runtime supports more than one.

### 9.1 Pattern: Lifecycle hooks (stdin-JSON IPC)

**Where it fits.** Runtimes that expose a typed lifecycle event surface where a third-party hook script receives a JSON envelope on stdin, returns a JSON envelope on stdout, and may deny / allow / modify the runtime's next action. Surveyed examples: Claude Code, Cursor, OpenAI Codex CLI, Browser-Use lifecycle hooks, CrewAI tool hooks, Augment Code (Auggie SDK with PreToolUse/PostToolUse/Stop/SubagentStart-Stop), Pi (Earendil events API, deliberately non-MCP).

**How atrib mounts.** A hook script reads the lifecycle envelope (typically a `PreToolUse` or `PostToolUse` event with `tool_name`, `tool_input`, `tool_result`, `session_id`, `transcript_path`), constructs an [§1.2.1](#121-field-definitions) AtribRecord, signs with the operator's Ed25519 key, and submits to the log. Best practice: spawn a detached helper subprocess so the runtime's tool-call latency is the hook's spawn time, not the signing roundtrip.

**Causality formation.** Each tool call produces a `tool_call` AtribRecord. `chain_root` per [§1.2.3](#123-chain_root-for-genesis-records) inherits from the prior record in the same `context_id` via the cascade in [§1.2.3.1](#1231-multi-producer-chain-composition). `informed_by` per [§1.2.5](#125-informed_by) is auto-detected from any sha256 references in the tool's args/result, OR explicitly populated by the hook from runtime-known prior-record context.

**Reference implementation.** A hook helper script that subprocesses the write-verb MCP server (`atrib-attest`, or the forwarded legacy `atrib-emit` binary). The helper reads the lifecycle envelope on stdin, calls the `attest` tool (or its legacy `emit` alias) over stdio with `content`, optional `context_id`, and any explicit `informed_by` declarations, and exits with the runtime's expected hook contract. Detached spawning keeps the runtime's tool-call latency bounded by spawn time, not signing roundtrip.

**Trade-offs.** Strongest causality formation in any pattern (the runtime knows exactly what triggered the tool call). Requires the runtime to ship a hook surface; not all do. Hook scripts run in the consumer's process space, so the consumer's atrib key is reachable.

### 9.2 Pattern: In-process MCP middleware (the wrapper)

**Where it fits.** Runtimes that call tools through Model Context Protocol (MCP) servers. atrib mounts as a middleware server fronting the upstream tool MCP, signing each request/response pair as it passes through. Surveyed examples: Goose (70+ MCP extensions), Continue (MCP-only), Cody, Claude Code MCP-served tools, opencode, Browserbase/Stagehand (covered transitively via the official `@browserbasehq/mcp-stagehand` MCP server), any generic stdio MCP host. Pi (Earendil) is intentionally NON-MCP; integrations with Pi use Pattern #1 hooks instead.

**How atrib mounts.** The runtime registers `@atrib/mcp-wrap` (or an equivalent middleware) instead of the upstream MCP server. The wrapper spawns the upstream as a subprocess, intercepts every `tools/list`, `tools/call`, and `tools/call/result` message, signs the call payload as an AtribRecord, and forwards transparently. The operator's MCP host config points at the wrapper instead of the upstream; the upstream sees no protocol change.

**Causality formation.** Within a single wrapped MCP, every tool call carries the wrapper's session-scoped `chain_root` cascade. Cross-MCP causality requires either (a) the wrapper consuming the inbound `_meta.atrib` propagation token per [§1.5.2](#152-http-transport-tracestate), or (b) the env-var or mirror-file inheritance per [§1.2.3.1](#1231-multi-producer-chain-composition).

**Reference implementation.** [`@atrib/mcp-wrap`](packages/mcp-wrap/), a generic config-driven wrapper that reads `$ATRIB_WRAP_CONFIG` (or `~/.atrib/wrap-config.json`) to specify which upstream to wrap. Library API for in-tree wrappers (`wrap`, `parseConfig`, `buildPreCallTransform`, `resolveKey`) and `atrib-wrap` binary for standalone use.

**Required for.** Transaction records ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) cross-attestation, where a counterparty co-signer requires synchronous request-path access). `preCallTransform` ([D057](DECISIONS.md#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding) cross-tool causal embedding, where the wrapper rewrites the upstream call payload to inject an atrib receipt-id). Payment-protocol adapters that require cross-attestation. Any MCP-native runtime where lifecycle hooks aren't available.

**Trade-offs.** Universal across MCP-served tools regardless of host runtime. Adds a process boundary (subprocess spawn). Cannot intercept tools that bypass MCP (host-internal Bash/Edit/Read in hook-only runtimes).

### 9.3 Pattern: Callback / lifecycle handlers (SDK-native interception)

**Where it fits.** Multi-agent SDKs and frameworks that expose a callback or hook API in their core surface. Surveyed examples: LangGraph (BaseCallbackHandler with `on_tool_start`/`on_tool_end`), CrewAI (`register_before_tool_call_hook` / `register_after_tool_call_hook`), AutoGen (InterventionHandler `on_send`/`on_publish`/`on_response`; AutoGen entered maintenance mode April 2026, Microsoft directs new users to Microsoft Agent Framework), Microsoft Agent Framework (explicit middleware system designed for "compliance / logging / safety filters", verbatim atrib fit), Anthropic Claude Agent SDK (`HookCallback` with `PreToolUse`/`PostToolUse`/`SubagentStart`), smolagents (`step_callbacks`), OpenAI Agents SDK (`RunHooks` and `AgentHooks` with `on_tool_start`/`on_tool_end`/`on_handoff`), Vercel AI SDK (tool wrapping), Flue (`ctx.setEventCallback(cb)` with 14-variant FlueEvent discriminated union; pre-1.0 API, semver-pin recommended), Google ADK (community-extensions structure).

**How atrib mounts.** A framework-specific adapter registers callbacks at the SDK's documented extension points and constructs AtribRecords from the callback context. The adapter ships with the framework's typed input + idiomatic registration code.

**Causality formation.** Pattern-#3 frameworks vary. OpenAI Agents SDK has a first-class `handoff` span type that maps directly to cross-agent `informed_by`. CrewAI has declarative `Task.context = [upstream_task]` references that produce explicit cross-task causal edges. AutoGen's actor-message interception captures inter-agent traffic that other patterns miss. Each adapter documents the framework's natural `informed_by` formation point.

**Reference implementations.** [`@atrib/agent`](packages/agent/) ships adapters per [D018](DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow), [D021](DECISIONS.md#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder), [D022](DECISIONS.md#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy), [D023](DECISIONS.md#d023-vercel-ai-sdk-mcp-adapter-monkey-patch-mcpclientrequest-not-wrapmcpclient-and-not-the-tools-execute-callbacks), [D024](DECISIONS.md#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private). Each adapter answers the integration shape revealed by source-reading the host framework, not by guessing from dependency graphs. Conformance contract per [D048](DECISIONS.md#d048-plug-and-play-enforcement-contract-for-adapters).

**Trade-offs.** SDK-native means tightest integration with that framework's feature surface (e.g., handoff spans, task context). Pattern coverage requires an adapter per framework; the LCD interface is "register a callback receiving (tool_name, input, output, agent_context)" but the registration shape varies.

### 9.4 Pattern: OpenInference SpanProcessor (telemetry-substrate hook)

**Where it fits.** Runtimes instrumented with OpenInference (the OpenTelemetry conventions layer for LLM/agent frameworks maintained by Arize). atrib mounts as a custom SpanProcessor that reads OpenInference-shaped spans and constructs AtribRecords. Surveyed examples: Vercel AI (native), OpenAI Agents SDK (native), Claude Agent SDK (Python instrumentation), smolagents (via OpenInference instrumentation), CrewAI (optional), LangChain / LangGraph (via OpenInference + LangSmith bridge), LlamaIndex, DSPy, MCP itself (instrumented), Strands Agents (OTel-native), Bedrock AgentCore (planned Langfuse / Datadog / Dynatrace integrations route through OTel). OpenInference maintains a multi-language package set across Python, JavaScript, Java, and Go.

**How atrib mounts.** A custom SpanProcessor implementing OpenTelemetry's `onEnd(span)` interface filters for spans carrying OpenInference attributes (`openinference.span.kind`, `tool.name`, `input.value`, `output.value`, `llm.*`, etc.), maps each span to an AtribRecord, signs with the operator's key, and passes the signed record plus local sidecar to the caller's submission callback. `TOOL` spans map to `tool_call`; `LLM`, `AGENT`, `EMBEDDING`, `RETRIEVER`, `RERANKER`, `CHAIN`, `GUARDRAIL`, `EVALUATOR`, and `PROMPT` map to `observation`. The runtime's existing OpenTelemetry tracer registration adds atrib's processor alongside existing exporters (Phoenix, Langfuse, Datadog, etc.); atrib does not replace existing observability, it composes.

**Local sidecar formation.** The signed AtribRecord stays lean. Rich span data lives in the local mirror sidecar per [§5.9.3](#593-the-_local-sidecar-shape): span kind/name/id, input/output, model and agent names, prompt metadata, usage, cost, score, and generic metadata. The signed record MAY carry `args_hash` and `result_hash` when the caller wants replay-checkable commitments to sidecar bytes. OpenInference `input.value` and `output.value` strings that contain JSON SHOULD be parsed and JCS-canonicalized before hashing, so verifier-side body replay can use supplied JSON material rather than runtime-specific raw string bytes.

**Causality formation.** OpenInference spans nest hierarchically, but the graph still records only signed structure and agent-declared references. Parent-child span nesting is a correlation fact about runtime execution, not a replayable claim that one signed action used another signed action as evidence. The reference implementation currently derives `informed_by` from the empirical LLM-to-TOOL tool-call id match: an LLM span that emits `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` registers its signed record hash, and the matching TOOL span with `tool_call.id` cites it before signing. Future span-link or graph-node parent-id derivations must still materialize as explicit `informed_by` fields before signing; the graph service does not infer semantic causality from span nesting.

**Reference implementation.** `@atrib/openinference`. The package exports a standard OpenTelemetry SpanProcessor that maps OpenInference spans into signed atrib records. Callers wire it into their existing OTel `TracerProvider`.

**Trade-offs.** Highest reach per LOC across the multi-agent SDK landscape (one integration → 8+ frameworks). OpenInference span schema is stable for the common attributes but evolving for newer ones; the adapter codes against the stable subset and falls through cleanly when extended attributes appear. Requires the runtime to be OpenInference-instrumented; non-instrumented runtimes need a different pattern.

### 9.5 Pattern: Post-hoc API import + consumer re-sign

**Where it fits.** Closed-loop proprietary runtimes that own the agent's execution loop and expose a session-export API but no in-process middleware path. Surveyed examples: Cursor Cloud Agents (recommended first reference target, public REST API, Pro tier, SSE stream emits `event: tool_call` as first-class type, official `@cursor/sdk` ships Zod validators), Devin (Core $20/mo blocks API; Teams $500/mo gates; messages endpoint plain text only), Manus (hosted), Replit Agent (LangSmith only), OpenAI Operator (no public trace API), Bolt/v0/Lovable (chat history + deployed code only).

**How atrib mounts.** A consumer-controlled adapter polls or webhook-receives the runtime's session-export API, parses each step into a tool*call shape, constructs an AtribRecord per step, signs with the consumer's atrib key, and submits to the log. Critically: the consumer (not the vendor) is the signer. The signature attests to \_the consumer's observation of what the vendor reported happened*, not to the vendor's truthfulness.

**Causality formation.** Limited by the vendor's API. If the vendor returns structured tool_call sequences with timestamps, the adapter forms a chain over the operator's `chain_root` cascade. If the vendor returns only chat history or summaries, the adapter does best-effort reconstruction; structural causality is lossy and the resulting records carry a flag (e.g., `provenance_quality: "vendor-summary"`) that downstream verifiers MUST surface.

**Trust posture.** This pattern is consistent with [§8.7](#87-adversarial-threat-model)'s threat model. atrib does not certify truth, only signing. The consumer-attested signature proves "I observed this is what the vendor told me happened", strictly weaker than in-process patterns where the substrate observed the call directly. Verifiers MUST treat consumer-attested records differently from in-process-attested records when their threat model requires the distinction.

**Reference implementation.** Deferred until a target runtime API is selected. Pattern is documented here so consumers building Pattern #5 adapters can do so against a stable reference contract.

**Trade-offs.** Only path for closed-loop proprietary runtimes. Latency is post-hoc (not real-time). Trust shifts to consumer-attestation. Vendor API shape varies; each adapter is bespoke.

**Run-level attestation fallback.** When a vendor's API returns only chat history or summary text (not structured per-step actions), per-step Pattern #5 isn't viable. The fallback is a single run-level observation record per completed agent execution, signed by the consumer, attesting to the vendor-reported summary. Strictly weaker than per-step Pattern #5 but recoverable for runtimes (Devin's plain-text messages endpoint, Bolt/v0/Lovable, GitHub Copilot Coding Agent's `Agent-Logs-Url` trailer) where structured per-step access is structurally blocked. Verifiers MUST surface the attestation level so consumers can reason about which records carry per-step verifiability and which carry only session-level.

### 9.6 Pattern: Streaming interceptor (real-time bidirectional)

**Where it fits.** Runtimes that expose a streaming bidirectional protocol (audio, video, real-time tool dispatch) where action capture must happen in the protocol stream itself, not at discrete tool-call boundaries. Surveyed examples: OpenAI Realtime API (voice agents), future voice/multimodal harnesses, WebSocket-based agent runtimes that don't model tool calls as request/response pairs.

**How atrib mounts.** A streaming interceptor sits in the protocol path (typically a WebSocket proxy or a transform stream), filters frames carrying tool-dispatch payloads, signs each as it passes through, and submits to the log. The interceptor MUST NOT add latency that breaks the streaming contract; signing happens on a separate concurrent path with the dispatched action.

**Causality formation.** Streaming intervals are softer than discrete tool-call boundaries. The adapter chooses a granularity (per-frame, per-utterance, per-action-cluster) and emits one record per chosen unit. `informed_by` formation depends on the runtime's session-state model.

**Reference implementation.** Not yet built. Pattern documented here so consumers building voice-agent or multimodal-agent integrations have a reference contract.

**Trade-offs.** Necessary for real-time bidirectional protocols. Latency budget is tight. Granularity choices are consumer-specific.

### 9.7 Pattern: Sandboxed-execution signer proxy

**Where it fits.** Runtimes that execute agent code inside a filesystem, network, process, container, or VM sandbox while a host process remains outside that sandbox. Surveyed examples include Claude Code sandboxing, hosted coding-agent sandboxes, local container sandboxes, and managed runtimes that expose a proxy boundary for credentials or network calls.

**How atrib mounts.** Sandboxed code constructs an unsigned atrib record request and sends it to a host signer proxy. The host signer lives outside the sandbox, holds the Ed25519 key, runs host policy, controls `creator_key` and `signature` or the local `signers[]` entry, signs canonical bytes per [§1.4](#14-signing-and-verification), optionally submits the record to the log, and returns a `record_hash` or signed record to the sandbox. The sandbox never receives the private key.

**Causality formation.** The sandbox passes `context_id`, `chain_root`, `informed_by`, and any sidecar context it knows to the host signer. The host signer applies the same chain-root precedence contract as other producers ([§1.2.3.1](#1231-multi-producer-chain-composition)) and returns the signed result so the sandbox can propagate [§1.5](#15-context-propagation) context to later calls.

**Security boundary.** This pattern satisfies [§1.4.6](#146-signing-key-isolation-for-sandboxed-execution). It does not stop a prompt-injected sandboxed agent from asking the host to sign a bad request. It makes that request cross a host-owned policy and signing boundary, which lets the host deny the request, log the denial, require approval, or attach additional evidence before signing.

**Reference implementation.** [`packages/integration/src/signer-proxy-example.ts`](packages/integration/src/signer-proxy-example.ts) plus [`packages/integration/examples/signer-proxy/`](packages/integration/examples/signer-proxy/). The test surface lives in [`packages/integration/test/signer-proxy.test.ts`](packages/integration/test/signer-proxy.test.ts).

**Trade-offs.** Keeps key material outside the sandbox and composes cleanly with sandbox credential proxy designs. Adds a host signing hop and a policy surface. The host signer must be treated as part of the trusted producer boundary.

### 9.8 Composing patterns

A runtime may support multiple patterns concurrently. Claude Code supports Pattern #1 (lifecycle hooks for builtin tools) AND Pattern #2 (the wrapper for MCP-served tools) simultaneously. AutoGen supports Pattern #3 (InterventionHandler) AND Pattern #4 (native OpenInference). When patterns compose, the consumer MUST ensure they don't double-sign the same observation: each pattern's adapter signs its own boundary; the boundaries should not overlap.

A canonical composition example: PostToolUse hooks fire on `mcp__.*` tools (Pattern #1 covers write-verb signing through `attest` or its legacy aliases) AND on built-in tool names like `Bash|Edit|Write|Read|MultiEdit|WebFetch|WebSearch` (Pattern #1 again, with verb-based importance grading). Wrapper-fronted MCP tools (Pattern #2) sign at the protocol boundary. The hook skip-list excludes already-wrapped MCPs to avoid double-signing.

Parent-child producers use the [D115](DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle) env bundle when the parent dispatch record hash is known before the child signs. The parent sets `ATRIB_CONTEXT_ID=<parent-context-id>`, `ATRIB_CHAIN_TAIL_<parent-context-id>=<latest-tail-record-hash>`, and `ATRIB_PARENT_RECORD_HASH=<parent-dispatch-record-hash>` for the child process. `@atrib/mcp` exposes `buildSubagentProducerEnv()` as the reference helper. Pattern #2 middleware applies the valid parent hash to the first successful child record's `informed_by` field; Pattern #1 hook producers and short-lived `atrib-emit-cli` calls may apply the same value to explicit emit records. Invalid values are ignored. This does not add a new edge type: graph derivation uses the existing INFORMED_BY edge. If the parent dispatch hash is not available before the child signs, the runtime uses pre-call signing, Pattern 3 verified handoff claims, or a later annotation instead of preserving an unresolved parent edge.

Producer-side `informed_by` validation is source-aware per [D116](DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware). Parent env seeds are producer-owned spawn anchors and are not looked up through the child-visible mirror or public log before signing. Refs from explicit `informedBy` callbacks and structured auto-detect paths can be resolver-accepted through local mirrors plus log lookup. Hosts that promote exact argument paths into `informed_by` SHOULD provide a resolver and SHOULD drop refs that return `not-found` or `unknown`.

### 9.9 Selecting a pattern

A runtime builder picks based on:

1. **What does the runtime expose?** Lifecycle hooks → Pattern #1. Native MCP → Pattern #2. SDK callbacks → Pattern #3. OpenInference instrumentation → Pattern #4. Closed-loop API only → Pattern #5 (or run-level attestation fallback when per-step shape is unavailable). Streaming bidirectional protocol → Pattern #6. Sandboxed execution with a host proxy boundary → Pattern #7.
2. **What does the runtime's threat model require?** Real-time signing for cross-attestation → Pattern #2 (only synchronous request-path access supports counterparty signature collection per [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)). Key isolation from sandboxed code → Pattern #7. Deferred-signature signing acceptable → any pattern whose trust posture matches the runtime.
3. **What's the deployment shape?** Consumer-controlled execution loop → Patterns #1-4, #6, and #7. Vendor-owned execution loop → Pattern #5 (or #5b).

**Pattern coverage commitments.** atrib v1 ships reference implementations for Patterns #1, #2, #3 (multiple frameworks), and #4. Pattern #7 ships a tested reference example for the key-isolation boundary, not a framework adapter. Patterns #5 and #6 are documented in this section with their conformance contract scope; reference implementations are planned for future development, prioritized by community demand and integration readiness. Third-party adapters in any pattern are encouraged; the [D048](DECISIONS.md#d048-plug-and-play-enforcement-contract-for-adapters) conformance contract scope extends to each pattern's reference test surface.

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
- **[x401]** x401 Proof Requirement Protocol, https://x401.proof.com/spec/latest/ (v0.2.0 draft)
- **[MPP]** Machine Payments Protocol, IETF draft-ryan-httpauth-payment-01, March 2026, https://mpp.dev
- **[AP2]** Agentic Payment Protocol v0.2, https://github.com/google-agentic-commerce/AP2
- **[a2a-x402]** A2A Payment Extension v0.1, https://github.com/google-agentic-commerce/a2a-x402
- **[MCP]** Model Context Protocol Specification, version 2025-11-25, https://modelcontextprotocol.io/specification/2025-11-25/
- **[Tessera]** Transparency-dev Tessera, https://github.com/transparency-dev/tessera
