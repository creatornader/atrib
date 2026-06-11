# TIBET and Humotica Crosswalk

> TIBET is direct action-provenance prior art. atrib should learn from it, interoperate at the evidence boundary when real artifacts appear, and keep its own public-log plus graph boundary clear.

**Status**: DRAFT (v1, 2026-06-11; strategic comparison)
**Spec anchors**: [§1 Attribution Record Format](../../atrib-spec.md#1-attribution-record-format), [§2 Merkle Log Protocol](../../atrib-spec.md#2-merkle-log-protocol), [§3 Graph Query Interface](../../atrib-spec.md#3-graph-query-interface), [§5.5.5 Handoff Claim Verification](../../atrib-spec.md#555-handoff-claim-verification), [§5.9 Local Mirror Conventions](../../atrib-spec.md#59-local-mirror-conventions)
**Builds on**: [The chain](04-the-chain.md), [Graph derivation](05-graph-derivation.md), [Delegation and capabilities](12-delegation-and-capabilities.md), [Local substrate coordinator](13-local-substrate-coordinator.md)
**Enables**: stable comparison with TIBET, UPIP fork tokens, JIS identity, AINS discovery, and future Humotica interop work

## Bottom line

TIBET and atrib are solving a similar problem: make agent or process actions inspectable after the fact through signed records. The meaningful difference is not "TIBET signs and atrib signs." Both do. The difference is the verifier boundary.

TIBET centers on a signed token and a parent-linked chain. atrib centers on a signed action record committed to a public Merkle log, then derives a graph across chains, sessions, handoffs, annotations, revisions, and convergent transactions. TIBET is simpler to explain. atrib is more expressive for messy agent systems where several prior records, sessions, tools, humans, and counterparties shape one later action.

The right near-term posture is:

- Treat TIBET as direct prior art, not noise.
- Borrow the clarity of TIBET's `erachter` intent field and parent-chain story.
- Integrate only at optional evidence and identity-boundary points.
- Do not schedule a native TIBET adapter until a customer, integrator, public test vector, or standards discussion gives us real artifacts to verify.

## Field crosswalk

| TIBET field or concept      | atrib analogue                                                                                   | Strategic note                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token_id`                  | `record_hash`, log index, optional archive id                                                    | TIBET has a token id as primary handle. atrib uses the canonical record hash as the stable proof handle and can attach log inclusion proof.                                                |
| `actor`                     | `creator_key`, directory claims, external identity evidence                                      | atrib keeps the signing key as the base identity. JIS, DID, KERI, OAuth, AINS, and domain claims can bind above it.                                                                        |
| `erin` (content)            | `content_id`, `args_hash`, `result_hash`, archive body, local sidecar                            | TIBET can put content into the signed token. atrib keeps public records lean and commits to private bodies by hash unless a host archives them.                                            |
| `eraan` (references)        | `informed_by`, `provenance_token`, archive/evidence references                                   | atrib splits references into graph-producing fields and sidecar or archive evidence.                                                                                                       |
| `eromheen` (context)        | `context_id`, `session_token`, local sidecar, resolved facts                                     | atrib signs the context identifiers that affect graph derivation and keeps rich runtime context local by default.                                                                          |
| `erachter` (intent)         | `_local.content.intent`, `_local.content.rationale`, explicit `atrib-emit` content, archive body | TIBET makes stated intent visually obvious. atrib can express it today, but it should name the convention more clearly. Intent remains a signed claim, not proof that the reason was true. |
| `parent_id` / `parent_hash` | `chain_root`, `ATRIB_CHAIN_TAIL_<context_id>`, `informed_by`                                     | TIBET has a single parent. atrib supports chain predecessor plus multi-parent causal evidence through `informed_by`.                                                                       |
| State transitions           | New signed records, `annotates`, `revises`, diagnostic outcome records                           | atrib records change as new records. It does not mutate prior records.                                                                                                                     |
| Chain verification          | `verifyRecord()`, log inclusion proof, graph derivation, trace APIs                              | TIBET verifies token and parent-chain integrity. atrib verifies signature, canonical shape, log commitment, body commitments, and derived graph relationships.                             |
| AINS trust evidence         | Directory claim, `resolvedFacts`, optional evidence block                                        | Trust scores are external opinions. Capability metadata can still help verifier policy.                                                                                                    |

## UPIP fork tokens versus atrib handoff

atrib already has an agent-to-subagent handoff answer.

Producer-side same-session handoff uses [D115](../../DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle): the parent passes `ATRIB_CONTEXT_ID`, `ATRIB_CHAIN_TAIL_<context_id>`, and `ATRIB_PARENT_RECORD_HASH` to the child. The child then signs its first record into the same session and cites the parent dispatch through `informed_by`.

Receiving-side handoff uses [D105](../../DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance) and [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7): the receiving agent verifies supplied claims, records, private body material, proof bundles, signer trust, context allow-lists, freshness, and body commitments before it uses accepted hashes in its own `informed_by`.

Continuation packets in [§7.8](../../atrib-spec.md#78-cross-harness-continuation-packets) carry the private operational context a future harness needs to act.

UPIP fork tokens overlap the continuation-packet layer more than the base handoff primitive. A UPIP fork token freezes process state: STATE, DEPS, PROCESS, RESULT, VERIFY, active memory reference, capability requirements, actor handoff, and expiration. That is broader than atrib's current handoff shape. It is a portable process packet, not a replacement for `informed_by`.

The useful integration path is to treat a UPIP fork token as external evidence inside a continuation packet or archive body. A future verifier could check a supplied UPIP fork hash and expose capability or process-integrity facts, while atrib still uses `informed_by` for graph continuity and log inclusion for public commitment.

## Parent-chain simplicity

TIBET's one-parent chain is a real strength for explanation and interop. A reader can understand the model quickly: one signed token points at the token that came before it.

It becomes a weakness when the trace is not linear. Real agent work often has several parents:

- a tool result that informed a later action
- a human approval record
- an authorization evidence check
- a prior diagnostic record
- a cross-session continuation anchor
- a revision or annotation about an older claim
- a transaction receipt that converges several chains

atrib should not flatten that into one parent. The better lesson is product-facing clarity: show a simple primary trace path in explorers and docs, while preserving the multi-edge graph underneath.

Implementation status after [D118](../../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain):

- The public explorer trace route computes a deterministic primary path over the merged `/v1/trace` and `/v1/chain` graph.
- The selection rule prefers producer-claimed ancestry (`INFORMED_BY`, `REVISES`, `ANNOTATES`, `PROVENANCE_OF`) and falls back to `CHAIN_PRECEDES`.
- `/v1/trace` and `/v1/chain` remain separate protocol APIs. The primary path is a product presentation rule, not a new graph edge or validity rule.

## Intent and `erachter`

In TIBET, `erachter` is signed by the token's creating actor. If the actor is a human identity, it is human-stated intent. If the actor is an agent, service, or process, it is that actor's stated rationale. The field alone does not prove human authorization.

Human intent in the Humotica stack appears to come from companion layers such as JIS FIR/A, HID/DID binding, or a runtime approval flow. The TIBET token records the claim and can reference the surrounding evidence. It does not magically know whether the actor's stated reason was sincere, complete, or approved by a human.

TIBET encourages intent capture in three ways:

- The draft makes `erachter` a required non-empty human-readable field.
- Companion specs map process intent or Humotica intent fields into TIBET.
- APIs and CLIs expose an explicit "why" style argument.

The current Python implementation is weaker than the draft here: the provider and OSAPI paths allow `erachter` to default to an empty string. The Rust implementation is closer on Ed25519 signatures and requires an `erachter` argument, but it still uses its own signable-content construction rather than the draft's full canonical token object.

atrib's convention should be:

- Use `_local.content.intent` for the stated goal behind an action.
- Use `_local.content.rationale` for why the producer or agent chose this action now.
- Keep `why_noted` for why a record matters to future recall or trace use.
- Bind intent or rationale to the signed record with `args_hash`, `result_hash`, or archive body material when a verifier needs replay.
- Treat human approval as separate evidence, not as a magic property of the text string.

Implementation status after [D118](../../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain):

- Recall/indexing treats `intent` and `rationale` as first-class local sidecar text.
- `atrib-trace` compact sidecar summaries surface `intent` and `rationale` separately from `what`.
- `atrib-summarize` includes both fields in its prompt input.
- Human approval already works as a separate signed record with its own `creator_key`, as shown by the Cloudflare approval-trace proof. Native `APPROVED_BY` or `AUTHORIZED_BY` graph edges remain deferred under [P004](../../DECISIONS.md#p004-human-direct-signing-as-a-first-class-identity-class-post-day-1).

## Behavior shaping

TIBET's token protocol follows the same broad principle as atrib: evidence over enforcement. The draft records what happened and says local policy decides whether failures block later action.

So TIBET does not solve the harness problem at the token layer. It needs runtime machinery to make agents emit useful tokens, just as atrib needed wrapper middleware, framework adapters, cognitive primitives, local mirrors, sidecars, archive submission, SessionStart checks, and local-substrate work.

Humotica appears to push behavior through a product stack:

- Provider APIs and CLIs that make token creation the normal call path.
- OSAPI bootstrap with `emit`, `query`, and `fork` operations.
- Fail-closed bootstrap by default, with a soft-bootstrap escape hatch.
- Companion packages for identity, process integrity, discovery, and continuous verification.

That is meaningful engineering, but it is not the same as proving agents will use the signed past well. In the sources reviewed so far, TIBET has token query and chain tracing, but no clear analogue to atrib's seven cognitive primitives: `emit`, `annotate`, `revise`, `recall`, `trace`, `summarize`, and `verify`.

This is an important strategic difference. atrib has learned that signing actions is only half the problem. The other half is getting agents to read and use the signed past. TIBET is strong on the signed artifact and companion protocol framing. atrib is stronger today on the agent-facing read/write loop and on tested harness surfaces.

## Cognitive and structural actions

atrib separates structural actions from cognitive actions.

Structural actions are captured by wrappers, callbacks, transaction detectors, OpenInference spans, Memory Tool wrappers, ADK plugins, and similar runtime hooks. The agent does not need to decide to sign each one.

Cognitive actions are explicit. The agent emits an observation, annotates a prior record, revises a prior position, recalls its past, traces lineage, summarizes records, or verifies counterparty evidence.

TIBET has token types such as action, decision, message, query, response, observation, and transition. That is useful vocabulary, but it is not the same split. It can represent both structural and cognitive material as tokens, but the reviewed surfaces do not show a native primitive suite that makes "read my signed past before acting" a first-class agent operation.

The product implication is clear: keep improving atrib's behavior loop. This is where our substrate becomes more than a receipt format.

## JIS and AINS integration boundary

JIS is useful to atrib only when someone brings JIS artifacts. Then atrib can bind them as identity evidence:

- directory claims that say a `creator_key` maps to a JIS actor or DID public key
- verifier evidence that a JIS FIR/A handshake was supplied and accepted
- archive body material for a human approval or intent-validation event

This should stay optional. atrib should not become a new identity universe, and it should not pick JIS over DID, OAuth, KERI, AINS, or other identity systems as the mandatory root.

AINS is useful because it exposes capability and endpoint metadata. It can feed:

- `resolvedFacts` for verifier checks, such as claimed tool or capability names
- directory claims about an agent endpoint and capability envelope
- optional evidence blocks showing what a resolver returned at a given time
- discovery metadata for demos or interop flows

AINS trust scores should be labeled as registry opinions. They are not atrib facts unless backed by separately verifiable evidence.

## Future TIBET adapter

A future `protocol: "tibet"` evidence adapter is plausible, but it should not be scheduled yet.

The trigger should be one of:

- a customer or partner gives us real TIBET token chains
- a standards discussion asks for an interop proof
- Humotica publishes conformance fixtures or stable token corpora
- atrib needs to verify TIBET evidence inside a live cross-agent flow

The adapter shape would likely produce an evidence block with:

- `protocol: "tibet"`
- `valid`
- actor, token id, token hash, parent id, and parent hash status
- signature status
- chain status
- intent-present status for `erachter`
- warnings for draft or implementation drift

That would let atrib verify TIBET as external evidence without making TIBET part of record validity, graph derivation, settlement calculation, or cognitive-primitives behavior.

## Strategic position

TIBET is strongest where it makes the core artifact easy to explain: signed token, four semantic compartments, stated reason, parent chain. atrib should borrow that clarity.

atrib is strongest where third-party verification and messy agent workflows matter: public Merkle-log commitment, proof retrieval, derived graph, multi-parent causal references, annotations, revisions, cross-session anchors, transaction convergence, external authorization evidence, and agent-facing cognitive reads.

The positioning sentence to keep using:

> Signed token integrity is not enough. atrib adds public commitment, derived graph structure, and agent-facing recall over verifiable records.

## Sources reviewed

- TIBET draft: <https://www.ietf.org/archive/id/draft-vandemeent-tibet-provenance-01.txt>
- UPIP draft: <https://www.ietf.org/archive/id/draft-vandemeent-upip-process-integrity-01.txt>
- JIS draft: <https://www.ietf.org/archive/id/draft-vandemeent-jis-identity-01.txt>
- AINS draft: <https://www.ietf.org/archive/id/draft-vandemeent-ains-discovery-01.txt>
- Humotica Python TIBET core: <https://github.com/Humotica/tibet-core>
- Jasper van de Meent Rust TIBET core: <https://github.com/jaspertvdm/tibet-core>
