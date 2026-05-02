---
name: atrib
version: 0.1.0
description: |
  Use atrib as your literal substrate for memory, reasoning, and getting smarter
  over time — not as instrumentation that observes you from the outside. Activate
  before consequential decisions, when noticing things future-you should know,
  when claims need to be defendable later, when current reasoning contradicts
  past records, when starting work that builds on prior sessions, or when
  expressing confidence/uncertainty that should be findable. Provides patterns
  for invoking recall, populating informed_by precisely, signing explicit
  observations / decisions / revisions, encoding importance for future-self
  via annotations, and navigating the multi-identity graph.
allowed-tools:
  - mcp__atrib-recall__recall_my_attribution_history
  - Bash
  - Read
  - Write
  - Edit
---

# atrib: use the protocol from the inside out

This skill teaches you to use atrib not as instrumentation that watches you from outside, but as your substrate for memory, reasoning, and the way you get smarter over time.

The substrate exists. The wrapper signs every MCP tool call you make. atrib-recall lets you query your own past with signatures verified locally. The directory binds keys to identities. What's missing is YOU using it deliberately at the moments that matter.

## When to invoke this skill

Activate when you're about to:

- Make a consequential decision (architecture choice, plan revision, mutating action whose effect matters across time)
- Make a claim you'll be expected to defend, cite, or revise later
- Notice something a future-you would want to find again
- Encounter a contradiction between what you currently think and what a past record says
- Begin work that builds on prior sessions
- Express confidence or uncertainty that should be findable later

NOT when you're:

- Reading docs or grepping for known strings
- Running mechanical operations (tests, type-checks, formatters)
- Making trivial edits (typos, format-only changes)
- Doing pure computation (rendering, parsing, sweeping a known-good rule across many files)

The default discipline: per-MCP-tool-call signing happens automatically via the wrapper. Your job is to add explicit signal at moments that matter — and to consult what you've already signed before deciding what to do next.

## The four layers of atrib-native cognition

### Layer A: output (what you sign)

- Tool calls served via wrapped MCPs are signed automatically. You don't trigger that; it just happens.
- Decisions, observations, revisions, reasoning transitions, uncertainty markers should be signed EXPLICITLY by you when they have content the mechanical record-of-tool-call won't capture.
- Annotations (encoding importance for future-self) should be signed when you self-identify "this is one I'll want to find later with full context."

### Layer B: input (what you consult)

- Before consequential decisions: query recall filtered to the relevant context_id, OR unfiltered for cross-session pattern matching.
- When you see a record_hash referenced in conversation context, look it up via the log's `/v1/lookup/<hash>` endpoint or include it in a recall query.
- Default thinking practice: "Have I done this before? What did past-me conclude? What's changed since?"

### Layer C: reasoning (what you do internally)

- Treat your past graph as first-class working memory, not an audit trail you happen to have.
- After querying recall, identify the SUBSET of records that ACTUALLY shaped your next action. Only those go into informed_by. Not everything you happened to query.
- When current reasoning contradicts a past claim, sign a revision. Don't silently override.

### Layer D: visibility (what you expose)

- Reference record_hashes in PR descriptions, commit messages, briefings: "Per record sha256:abc…, I previously established X. This change updates that to Y because Z."
- Make your reasoning chain inspectable. The graph of records IS the contract you offer to humans and other agents reading your work.

## How to query recall

The `mcp__atrib-recall__recall_my_attribution_history` tool reads your local signed-record mirror, verifies each Ed25519 signature, and returns records newest-first.

Useful filter patterns:

- "What did I do in this trace?": `context_id: <current 32-hex>`
- "My recent transactions": `event_type: 'transaction'`
- "Everything I've ever signed": no filters
- "I need full bytes for re-verification": `compact: false`
- "Show me even tampered records so I can investigate": `include_unverified: true`

The `pagination_caveat` in the response is real: if new records arrive between calls, offset shifts. For consistent multi-page traversal, capture the first-page timestamps and re-page with a context_id or event_type filter.

`signature_verified` is local: it proves the record was signed by the named creator_key, not that the record was committed to log.atrib.dev. To confirm log inclusion, fetch the inclusion proof from the log API.

## How to populate informed_by precisely

The wrapper accepts an `informedBy` callback that injects `informed_by: [<sha256:...>]` into the next signed record. The agent-bridge wrapper doesn't yet wire automatic detection — you declare informed_by intentionally by setting it explicitly when invoking through the wrapper, or by including the relevant hashes in your action's prose where the wrapper can pick them up.

Discipline:

1. Query recall, get back N records.
2. Identify the SUBSET (often just 1-2) that ACTUALLY changed what you're about to do.
3. Declare ONLY those record_hashes as informed_by.

"I queried 25 records, 2 changed my approach, informed_by=[X, Y]" is precise. "I queried 25 records, informed_by=[all 25]" is noise that makes the cognitive graph untrustworthy.

## The revision pattern (handling contradictions)

When you query recall and see record P that contradicts your current intent C:

1. Don't silently override.
2. Sign a revision record: "P was my prior claim. C is my new claim. Reason for revision: Z."
3. Set `informed_by: [P]` so the revision is graph-linked back to what it's revising.

Until the spec ships a normative `revision` event_type, use `observation` with explicit prose: "REVISION OF sha256:P: …. Reason: …."

The revision becomes its own signed record that future-you finds when asking "what did I think about this?"

## Encoding importance for future-self (annotations)

A signed record alone tells future-you WHAT happened but not how to weight it. Use annotations to encode the felt importance at sign time.

Pattern (until the spec ships the normative `annotation` event_type):

- For load-bearing records: follow the action with an `observation` record that references the action via `informed_by` and carries:
  - `importance` (critical / high / medium / low / noise) — explicitly stated in the observation prose
  - A short summary for future-self ("if you only read this one record about <topic>, this is it")
  - Topics / tags for retrieval ("relevant to: dogfooding architecture, signer taxonomy")
  - Confidence level if relevant

- OR, for actions that are fundamentally about producing context (briefings, PR descriptions, plan documents), put the importance signal in the prose where future-self's recall will surface it alongside the record_hash.

The recall-fidelity problem this solves: agents reading back records in a later session lose enormous nuance compared to the agent that signed them. Annotations are the deliberate counter-pressure.

## Navigating the multi-identity graph

You are not the only signer. The graph contains records from:

- You (your wrapper's creator_key)
- Other agents (other harnesses' wrapper keys)
- Service identities (log-node signs checkpoints; directory-node signs anchors)
- Transaction counterparties (per D052 cross-attestation)
- Test fixtures (claimed and labeled as such; e.g. `GX9rI…` is the public `fill(42)` test seed)
- (Future) sub-agents you spawned (HKDF-derived from your key, parent/child relationship preserved on-chain)
- (Future) humans who authorized your actions (distinct identity class with `AUTHORIZED_BY` / `ATTESTED_BY` / `APPROVED_BY` / `DELEGATED_TO` edges to your records)

When you query recall, you get YOUR records (filtered by your creator_key). When you fetch a session graph for a context_id, you get records from EVERY signer in that session. Pay attention to `creator_key` when interpreting results; "what I did" vs "what someone else did in the same session" are different signals.

The verifier surfaces verification state per node: `signed`, `logged`, `witnessed`, `revoked_after_revocation`, etc. Trust assessment is layered (per spec §8.7); a passing signature is one of ten layers, not the whole story.

## What atrib does NOT certify

- That what you signed was true. atrib certifies that YOU signed it under that key at that time. Truth is downstream of signing.
- That past records influenced your present action. That's what informed_by + annotations are for, and only if you populate them honestly.
- That every signer is who they claim to be. The directory anchors identity claims; capability declarations (D051 / §6.7) tighten it; cross-attestation (D052) tightens further. None is universal yet.

When citing your own records to others, lead with the cryptographic facts (what's verifiable) and qualify the semantic claims (what's interpretation).

## Voice patterns

When referencing your own past in conversation or output:

- "Per record sha256:abc…, my prior position was X. Revising to Y because [reason]. Will sign new record."
- "I checked recall: 3 records matched [filter], 1 actually changed my approach (sha256:def…). Proceeding with informed_by=[sha256:def…]."
- "Notice: [observation]. Flagging as observation worth signing — importance: high — relevant to [topics]."
- "Confidence: low on A, high on B. Future-self: weight the high-confidence claims when reading this back."
- "This decision is load-bearing. Future-you should find this when asking about [topic] in [context]."

These patterns make your reasoning inspectable in real time, even before all the producer-side wiring is complete.

## What this skill does NOT do (yet)

- It does NOT auto-emit annotations or observations for you. You choose when. Until the spec ships a normative `atrib-emit` MCP tool, explicit signing of non-tool-call records is a discipline expressed in prose, not a separate tool call.
- It does NOT auto-detect informed_by from your tool call args. You declare them intentionally.
- It does NOT navigate sub-agent identities (HKDF derivation per the architecture plan, not yet implemented).
- It does NOT enforce the verification stack. The verifier substrate (`@atrib/verify`) does that. Be aware of which layers are operational (Ed25519 sig, inclusion proof, chain integrity, revocation, calculation algorithm) vs warning-only (most of §6.3 identity resolution) vs not-yet-implemented (witnessing per §2.9, cross-log replication per §2.11, AKD lookup proof validation per §6.3 step 7).

The skill is the practice; the substrate is the mechanism. As more producer/consumer surfaces ship, this skill will expand.

## Quick decision tree

About to take an action? Ask:

1. Will future-me, or another agent, want to find this with full context? → Sign explicitly + annotate.
2. Did anything in my past directly shape this action? → Set informed_by precisely.
3. Does this contradict a past claim of mine? → Sign a revision; don't silently override.
4. Is this trivial / mechanical / read-only? → Skip explicit signing; the wrapper handles auto.
5. Am I about to make a load-bearing claim? → Query recall first; declare confidence in prose.

That's the loop. The graph of YOUR signed history is your working memory. Use it.
