# P044 candidate ADR draft: session_checkpoint event type: the Merkle-committed session stream

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P044](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

Candidate set (cross-references between drafts resolve via this table):

| Pending | Key | Draft |
|---|---|---|
| P042 | evidence-envelope | [docs/adr-draft-p042-evidence-envelope.md](adr-draft-p042-evidence-envelope.md) |
| P043 | anchor-plurality | [docs/adr-draft-p043-anchor-plurality.md](adr-draft-p043-anchor-plurality.md) |
| P044 | session-checkpoint | [docs/adr-draft-p044-session-checkpoint.md](adr-draft-p044-session-checkpoint.md) |
| P045 | delegation-certificates | [docs/adr-draft-p045-delegation-certificates.md](adr-draft-p045-delegation-certificates.md) |
| P046 | atribd-daemon | [docs/adr-draft-p046-atribd-daemon.md](adr-draft-p046-atribd-daemon.md) |
| P047 | attest-recall-rename | [docs/adr-draft-p047-attest-recall-rename.md](adr-draft-p047-attest-recall-rename.md) |
| P048 | payments-spinout | [docs/adr-draft-p048-payments-spinout.md](adr-draft-p048-payments-spinout.md) |
| P049 | mcp-extension | [docs/adr-draft-p049-mcp-extension.md](adr-draft-p049-mcp-extension.md) |

---

# ADR draft: `session_checkpoint` event type: the Merkle-committed session stream

**Status:** Draft (pre-acceptance). Promotes redesign-upgrade-path step 2
([`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md), "Session
checkpoint event type (the stream, formalized)") to a normative design. The
event_type promotion itself follows the
[D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
five-indicator bar; this draft specifies the complete normative shape so that
promotion is a byte-flip plus the
[D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)
sync-trigger checklist, not a redesign.

## Context

atrib already has a session stream in two representations: physically, the
per-context mirror JSONL ([§5.9](../atrib-spec.md#59-local-mirror-conventions));
logically, the CHAIN_PRECEDES chain
([§3.2.3](../atrib-spec.md#323-edge-types)). Neither is committed to as a whole.
Every record is individually anchored in the public log
([§2.3.1](../atrib-spec.md#231-entry-serialization)), but per-record commitments
can never distinguish "the agent committed 10 actions" from "the agent
committed 10 of the 50 actions it took." Three concrete gaps follow:

1. **No selective disclosure over a session.** Proving that event N belongs
   to a specific session history requires either revealing the whole chain or
   trusting the producer's narration. The
   [§8.3](../atrib-spec.md#83-salted-commitment-posture) salted-commitment
   posture protects record *bodies*; nothing protects-while-proving record
   *position* within a session.
2. **No completeness claim.** "This is the whole session as of point K" is
   not provable from per-record log entries.
3. **Anchoring cost.** Redesign step 1 (anchor plurality, generalizing
   [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) /
   [§2.11](../atrib-spec.md#211-cross-log-replication)) wants every commitment at
   ≥2 independent anchors. Per-record multi-anchoring is expensive; one root
   per interval is cheap.

Precedents this design leans on: `directory_anchor`
([D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04))
established that an operator-emitted record may carry its commitment payload
inline in the signed bytes (see `services/directory-node/src/anchor.ts`, whose
signed record carries `metadata.directory_root` + epoch). `annotation` /
`revision`
([D058](../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05),
[D059](../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06))
established the "field REQUIRED on this event_type, REJECTED on every other"
validation pattern. [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)
established design-level byte reservation with extension-URI production ahead
of promotion, and reserved `0x07` for `handoff`.

## Decision

Add one new event type, `https://atrib.dev/v1/types/session_checkpoint`, with
log-entry byte **`0x08`** upon promotion. The byte allocation deliberately
skips `0x07`, which stays where
[D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) left it: a
design-level reservation for `handoff`, not an allocation; [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) explicitly
declined to tighten the [§2.3.1](../atrib-spec.md#231-entry-serialization)
reserved range. At promotion the [§2.3.1](../atrib-spec.md#231-entry-serialization) byte table must therefore represent
the split explicitly: `0x07` "reserved for `handoff` per [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) (design-level,
not yet allocated)", `0x08` `session_checkpoint`, and `0x09`-`0xFE` "reserved
per [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)", not a single contiguous reserved range. A session checkpoint is an
ordinary signed atrib record whose body commits to the RFC 6962 Merkle root
over the ordered `record_hash` values of its `context_id` so far, plus the
interval range and the prior checkpoint's record hash. It is signed like any
record ([§1.4](../atrib-spec.md#14-signing-and-verification)), chained like any
record ([§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition)
precedence via `resolveChainRoot`, never reimplemented), submitted like any
record ([§2.6.1](../atrib-spec.md#261-submit-entry)), and non-blocking like any
record ([§5.3.5](../atrib-spec.md#535-log-submission),
[§5.8](../atrib-spec.md#58-degradation-contract)).

Rollout is staged per the [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) precedent: producers emit the URI under
log-entry byte `0xFF` (extension) immediately; the byte-flip to `0x08` lands
when the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
adoption/demand indicators are met. Because the event_type in the *signed
bytes* is the URI, records emitted before and after promotion are
byte-identical; only the 90-byte log entry's type byte changes for new
submissions.

## Mechanism

### Record shape

Standard (single-signature) shape. One new OPTIONAL top-level field,
`checkpoint`, which is REQUIRED on `session_checkpoint` records and MUST be
rejected by validators on any other event_type (the
[§1.2.7](../atrib-spec.md#127-annotates) / [§1.2.9](../atrib-spec.md#129-revises)
pattern):

```json
{
  "spec_version": "atrib/1.0",
  "content_id": "sha256:<hex of SHA-256(UTF-8(producer_origin + \":session_checkpoint\"))>",
  "creator_key": "<43-char base64url Ed25519 key>",
  "chain_root": "sha256:<parent record hash, normal D067 resolution>",
  "checkpoint": {
    "first_index": 17,
    "prior_checkpoint": "sha256:<record_hash of previous session_checkpoint>",
    "retroactive": true,
    "session_root": "sha256:<64 hex, RFC 6962 root over leaves 0..tree_size-1>",
    "tree_size": 42
  },
  "event_type": "https://atrib.dev/v1/types/session_checkpoint",
  "context_id": "<32 hex>",
  "timestamp": 1751760000000,
  "args_hash": "sha256:<JCS hash of the local leaf-list content, per D099>",
  "signature": "<86-char base64url>"
}
```

JCS slotting ([§1.3](../atrib-spec.md#13-canonical-serialization)): `checkpoint`
sorts after `chain_root` (`c-h-a` < `c-h-e`) and before `content_id`
(`c-h` < `c-o`). It is a new OPTIONAL field, so it is absent from every
existing record and no existing canonical form or signature changes.

Field semantics inside `checkpoint` (all REQUIRED unless marked):

| Field | Type | Rule |
| --- | --- | --- |
| `session_root` | string | `"sha256:" + 64 lowercase hex`. RFC 6962 root over leaves `0..tree_size-1`. |
| `tree_size` | integer | ≥ 1. Number of leaves committed. The last covered leaf index is `tree_size - 1` (implicit; not a separate field). |
| `first_index` | integer | `0 ≤ first_index < tree_size`. Index of the first leaf newly covered by this interval. MUST equal the prior checkpoint's `tree_size` when `prior_checkpoint` is present, and `0` when absent. |
| `prior_checkpoint` | string, OPTIONAL | `"sha256:" + 64 hex` record hash of the immediately preceding `session_checkpoint` on the same `context_id`. MUST be present iff `first_index > 0`. Omitted, not null, on the first checkpoint (invariant 5 discipline). |
| `retroactive` | boolean, OPTIONAL | When present, MUST be `true`. `retroactive: false` MUST NOT be emitted (absence-not-null; presence changes the signature). See semantics below. |

Validator rules ([§2.6.1](../atrib-spec.md#261-submit-entry) conformance targets):
reject `session_checkpoint` records missing `checkpoint`; reject `checkpoint`
on any other event_type; reject `tree_size < 1`, `first_index ≥ tree_size`,
`prior_checkpoint` present with `first_index == 0` or absent with
`first_index > 0`; reject `retroactive: false`.

`content_id` follows the [§1.2.2](../atrib-spec.md#122-content_id-derivation)
derivation (`"sha256:" + hex(SHA-256(UTF-8(input)))`, never the hex of the
input string itself) with tool_name `"session_checkpoint"`, mirroring
directory-node's `"<origin>:directory_anchor"` input (exact constant for
origin-less cognitive producers is an open question). Per
[D099](../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash),
producers SHOULD set `args_hash = sha256(JCS({"leaves": [ ...ordered
"sha256:<hex>" strings... ]}))`, committing the flat leaf list alongside the
tree root, with the list itself in `_local.content.leaves`.

### Tree construction rule

- **Leaf value:** the raw 32-byte record hash of each covered record,
  hex-decoded from `"sha256:" + hex(SHA-256(JCS(complete signed record
  including signature)))`, exactly the record-hash definition in
  [§1.2.3](../atrib-spec.md#123-chain_root-for-genesis-records)'s normative
  clarification. Leaves are the *bytes*, not the prefixed hex string.
- **Hash function and domain separation:** RFC 6962 §2.1 exactly as
  [§2.3.2](../atrib-spec.md#232-leaf-hash-computation):
  `leaf_hash = SHA-256(0x00 || leaf_bytes)`,
  `node_hash = SHA-256(0x01 || left || right)`. No new personalization
  string. Cross-tree confusion with the public log is structurally
  impossible: log leaves have fixed 90-byte preimages
  ([§2.3.1](../atrib-spec.md#231-entry-serialization)); session leaves have
  fixed 32-byte preimages. Keeping the algorithm verbatim means the
  [§2.7](../atrib-spec.md#27-inclusion-proof-verification) inclusion-proof
  procedure, the RFC 6962 §2.1.4 consistency-proof check the
  [§2.9](../atrib-spec.md#29-witnessing-and-cosignatures) witness protocol
  already relies on, existing Merkle libraries, and the Appendix A.9 vector
  style are reused unchanged.
- **Leaf ordering:** producer-declared session order, and it is a *signed
  claim*. Conforming producers MUST append leaves in the order they observed
  the records: signing order for records they signed, mirror append order for
  records read back from the [§5.9](../atrib-spec.md#59-local-mirror-conventions)
  mirror. Verifiers do NOT recompute a canonical order; multi-producer
  sessions ([§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition),
  [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract))
  have no trustworthy global time order (coarsened timestamps per
  [§8.4](../atrib-spec.md#84-coarsened-timing-posture), clock skew).
- **Ordering consistency checks (verifier-side, categorical, signal not
  block, per [§3.3](../atrib-spec.md#33-verification-state)):** when the verifier
  can resolve the leaf records it MUST check: (a) if CHAIN_PRECEDES A → B and
  both are leaves, `index(A) < index(B)`; (b) leaf timestamps are
  non-decreasing beyond declared `timestamp_granularity`; (c) every resolved
  leaf's `context_id` equals the checkpoint's `context_id` (violation is a
  hard structural fault, not a soft flag); (d) every prior
  `session_checkpoint` record on the context appears as a leaf.
- **Self-exclusion:** a checkpoint MUST NOT include itself as a leaf (its
  hash depends on `session_root`). It becomes a leaf in the next checkpoint's
  tree; checkpoints are part of the stream they formalize.
- **Empty checkpoints prohibited:** `tree_size ≥ 1`; producers SHOULD skip an
  interval that added no new leaves.

### Consistency and equivocation

For consecutive checkpoints K_i → K_{i+1} on one `context_id`:
`K_{i+1}.checkpoint.prior_checkpoint` = record hash of K_i;
`K_{i+1}.first_index = K_i.tree_size`; and the leaf sequence
`0..K_i.tree_size-1` MUST be identical: append-only extension, provable by
an RFC 6962 §2.1.4 consistency proof from `(K_i.session_root, K_i.tree_size)`
to `(K_{i+1}.session_root, K_{i+1}.tree_size)`, the same append-only check
the log's witness protocol applies between successive log checkpoints
([§2.9](../atrib-spec.md#29-witnessing-and-cosignatures)). Two signed checkpoints
from the same `creator_key` claiming the same `prior_checkpoint` (or
overlapping ranges) with inconsistent roots constitute equivocation evidence
against that key, the session-scale analogue of log equivocation in
[§2.11](../atrib-spec.md#211-cross-log-replication), reported as a categorical
verifier fact.

Honest scope ([§8.7](../atrib-spec.md#87-adversarial-threat-model)): the
completeness claim is provable *relative to the creator's own committed
stream*: a creator that maintains a never-checkpointed side chain is not
detected by this mechanism; what changes is that any two committed views of
the same session are now cryptographically comparable, so selective
re-narration becomes attributable equivocation instead of deniable omission.

### Retroactive / attested-backfill semantics

A checkpoint signed now over an old chain proves the history existed and was
tree-committed as of the checkpoint's log-inclusion time, not as of the
original session. The covered records' own log entries remain the per-record
contemporaneous anchors.

- **Producer rule:** `retroactive: true` MUST be set when any leaf in the
  newly covered interval `[first_index, tree_size-1]` was not observed live
  by the checkpointing producer (backfilled from a mirror, archive, or
  third-party history). The canonical case: the one-time backfill checkpoint
  over dogfood history that predates checkpoint adoption.
- **Verifier rule:** verifiers assign one categorical freshness fact per
  checkpoint: `contemporaneous`, `declared-retroactive`, or
  `stale-undeclared` (checkpoint timestamp exceeds the max covered leaf
  timestamp by more than a verifier-configured bound; proposed default 24h),
  mirroring the `in_envelope: false` signal-not-block posture of
  [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) /
  [§6.7](../atrib-spec.md#67-capability-declarations).

### Graph derivation ([§3.2.4](../atrib-spec.md#324-edge-derivation-rules) discipline)

**No new edge types. The nine-edge set is unchanged.** The Merkle root does
not structurally reveal its member hashes; deriving per-leaf edges would
require external leaf-list material, which violates the observable-structure
rule ([§3.1](../atrib-spec.md#31-design-principles-and-rationale), invariant 2).
The one field that IS observable structure, `checkpoint.prior_checkpoint`,
deliberately stays verifier-side in v1: checkpoint ordering is already
coherent through `chain_root`, and producers wanting a declared graph
relationship MAY additionally list the prior checkpoint hash in
`informed_by`, reusing existing INFORMED_BY machinery (dangling-safe per
[D041](../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) /
[D113](../DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default)).

Node participation ([§3.2.1](../atrib-spec.md#321-node-types) matrix gains one
row) is identical to `observation`: CHAIN_PRECEDES / SESSION_PRECEDES /
SESSION_PARALLEL yes; CONVERGES_ON no; CROSS_SESSION no; INFORMED_BY and
PROVENANCE_OF source/target yes;
[§4.6](../atrib-spec.md#46-the-calculation-algorithm) attribution **skipped**.
The skip preserves invariant 3 and
[§4.1](../atrib-spec.md#41-purpose-and-position-in-the-protocol): a session's
attribution distribution MUST be bit-identical whether or not its producer
adopted checkpointing, so checkpoints must never enter contributing-node
sets. Graph endpoints continue to return no weighted or interpreted data
([§3.6](../atrib-spec.md#36-implementation-notes)); ordering-consistency and
freshness results are verifier facts, not graph payloads.

### What it buys, precisely

- **Selective disclosure:** an inclusion proof of leaf i against
  `session_root` reveals only the record hash, its position, and ~log2(n)
  sibling hashes, never sibling record bodies. Composes with
  [§8.3](../atrib-spec.md#83-salted-commitment-posture): position becomes
  provable while args/result stay salted commitments.
- **Completeness:** "whole session as of checkpoint K," relative to the
  committed stream, with equivocation detection between any two committed
  views.
- **Cheap anchoring:** one root per interval is the unit redesign step 1
  multi-anchors ([D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)).
- **Position attestation:** a counterparty can co-attest "hash H at index i
  under root R" by signing an ordinary `annotation` over the checkpoint
  record (existing machinery, no new signature scheme); whether this deserves
  a step-4 evidence-envelope profile is an open question.

## Compatibility and migration

- **Existing signed records: zero change.** `checkpoint` is a new OPTIONAL
  field absent from every existing record; JCS canonical forms, signatures,
  record hashes, chain roots, and propagation tokens all stand. No log entry
  byte, 90-byte layout, or checkpoint-note format
  ([§2.4](../atrib-spec.md#24-checkpoint-format), the *log's* checkpoints, an
  unrelated concept; the spec section MUST add a disambiguation note)
  changes.
- **Old verifiers/validators:** per the
  [§1.2.4](../atrib-spec.md#124-event_type-values) extension rules, an
  unrecognized-but-valid URI does not block signature verification. Old
  verifiers verify the signature, treat the record as an extension node
  ([D043](../DECISIONS.md#d043-extension-uri-participation-in-graph-derivation)),
  and skip checkpoint semantics. Old log-node deployments accept the `0xFF`
  form today with no change.
- **Published packages (additive minors):** `@atrib/mcp` gains the tree
  builder + checkpoint record constructor (chain resolution stays
  `resolveChainRoot`); `@atrib/verify` gains `verifySessionCheckpoint`
  (structural validation, root recomputation from a supplied leaf list,
  inclusion/consistency proof checks, categorical freshness + ordering
  facts); the producer ships in the emit family or the primitives runtime
  (open question below). No package's existing API breaks.
- **Deployed services:** pre-promotion, graph-node and log-node need nothing
  (extension handling already exists). At promotion, the
  [D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)
  checklist applies: log-node byte decoder, dashboard chip color, verify-loop
  `validEventTypes`, metrics filter, package constants. archive-node
  optionally accepts the leaf list as evidence per
  [§2.12](../atrib-spec.md#212-record-body-archive-layer); the archive stays a
  separate service ([D070](../DECISIONS.md#d070-record-body-archive-layer)).
- **Operator machines:** the mirror sidecar gains `_local.content.leaves`;
  old mirror lines are unaffected (read-time normalization only, per the
  [§5.9](../atrib-spec.md#59-local-mirror-conventions) compatibility
  commitment). Historical sessions get opt-in attested backfill: a host-owned
  script reads the mirror per context and emits one `retroactive: true`
  checkpoint per historical `context_id`.
- **Degradation:** checkpoint emission is producer-side and silent-failure
  per [§5.8](../atrib-spec.md#58-degradation-contract). It never blocks a tool
  call, response, or transaction; a missed interval widens the next one;
  pass-through mode emits no checkpoints.

## Conformance-corpus plan

Directory: `spec/conformance/1.2.4/session-checkpoint/` (the location
[D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) established
for event-type promotions). Generator in `packages/log-dev/scripts/`,
reference tests in `packages/verify/test/`, adversarial cases joining the
[D101](../DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)
pattern. Case families:

1. **canonical-form/**: `checkpoint` JCS slot between `chain_root` and
   `content_id`; presence/absence of `prior_checkpoint` and `retroactive`
   changes the signature; `retroactive: false` rejected (absence-not-null,
   mirroring the 1.2.6 corpus contract).
2. **tree-construction/**: pinned leaf lists → `session_root` for sizes 1,
   2, 3, 7, 8 (odd/unbalanced RFC 6962 shapes); a trap vector proving the
   raw-32-byte-leaf rule (tree over hex *strings* MUST NOT match).
3. **inclusion/**: valid proof; wrong index; wrong root; truncated path.
4. **consistency/**: valid append-only K1 → K2; reordered-leaf violation;
   `first_index` mismatch; `prior_checkpoint` mismatch; equivocation pair
   (same prior, divergent roots) → equivocation fact.
5. **structural-validation/**: `checkpoint` on wrong event_type rejected;
   missing on `session_checkpoint` rejected; `tree_size 0`,
   `first_index ≥ tree_size`, prior/first-index coupling violations;
   foreign-`context_id` leaf → hard fault.
6. **retroactive/**: declared-retroactive, contemporaneous, and
   stale-undeclared vectors with expected categorical facts.
7. **byte-uri-duality/**: identical signed bytes under the `0xFF`
   (pre-promotion) and `0x08` (post-promotion) log-entry encodings.
8. **graph/**: a `spec/conformance/3.2.4/` addition pinning that
   session_checkpoint nodes derive chain-spine edges only, receive no
   CONVERGES_ON, and change no existing edge set.

## Alternatives rejected

- **Verifier-computed canonical leaf order (timestamp, record_hash
  tiebreak).** Rejected: multi-producer sessions have no trustworthy global
  time order (coarsened timestamps, clock skew, mirror lag per
  [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)),
  and a root over an order the producer never asserted would be a verifier
  artifact, not a signed claim. atrib certifies signing, not truth
  ([§8.7](../atrib-spec.md#87-adversarial-threat-model)); the order is the claim,
  with structural consistency checks as the counterweight.
- **New hash personalization / domain-separation string for session trees.**
  Rejected: 32-byte leaf preimages are structurally disjoint from the log's
  90-byte entries, and keeping [§2.3.2](../atrib-spec.md#232-leaf-hash-computation)
  / [§2.7](../atrib-spec.md#27-inclusion-proof-verification) verbatim reuses
  every existing implementation and test vector.
- **Enumerate leaf hashes inline in the signed record.** Rejected: unbounded
  record size, no selective disclosure (the full list would sit on the public
  submission path), and it duplicates what `args_hash` +
  `_local.content.leaves` already commit per
  [D099](../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash).
- **A tenth CHECKPOINT_PRECEDES edge type from `prior_checkpoint`.**
  Rejected for v1: the docs, the 3.2.4 corpus, and graph-node all depend on
  the nine-edge count; `chain_root` already orders checkpoints; and
  [D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)'s
  framing says presentation needs should be met by projection rules before
  new edge types. Revisit only with a demonstrated consumer query the
  existing projections cannot serve.
- **CONVERGES_ON participation / [§4.6](../atrib-spec.md#46-the-calculation-algorithm) inclusion.** Rejected: checkpoints are
  meta-records; letting them contribute would change attribution
  distributions the moment a producer adopts checkpointing, violating the
  pure-function stability of
  [§4.6](../atrib-spec.md#46-the-calculation-algorithm) and the no-thumb rule of
  [§4.1](../atrib-spec.md#41-purpose-and-position-in-the-protocol).
- **Overload `directory_anchor` with a session payload.** Rejected: different
  emitter class (agents vs. atrib-system directory operators), different
  validator rules; overloading breaks
  [D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)'s
  structural validation.
- **Log-operator-materialized per-context subtrees.** Rejected: turns a
  producer claim into operator trust, is unavailable offline/local-first, and
  erodes the separation instinct of
  [D070](../DECISIONS.md#d070-record-body-archive-layer): the log commits, it
  does not interpret.
- **Group by `session_token` instead of `context_id`.** Rejected:
  `context_id` is the session anchor
  ([§1.5.1](../atrib-spec.md#151-context_id-the-session-anchor));
  cross-trace continuity already has `session_token` / CROSS_SESSION
  ([§1.5.5](../atrib-spec.md#155-cross-trace-session-continuity)). Cross-context
  completeness composes: checkpoint each context, link via `informed_by`.
- **Immediate byte promotion without an extension phase.** Rejected per
  [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary):
  pre-emptive allocation accumulates normative debt.
  [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) is the
  precedent; the difference here is that atrib's own dogfood loop is the
  producer *and* the consumer (step-1 anchoring), so the adoption/demand
  indicators are expected to clear quickly.

## Doc-sync impact

- **`atrib-spec.md`:** [§1.2.4](../atrib-spec.md#124-event_type-values) URI table
  row + canonical example + decision-tree entry; new `checkpoint`-field
  subsection under [§1.2](../atrib-spec.md#12-the-attribution-record) (with [§1.2.1](../atrib-spec.md#121-field-definitions)
  table row noting the JCS slot); [§2.3.1](../atrib-spec.md#231-entry-serialization)
  byte table gains the `0x08` row at promotion, and the current single
  `0x07`-`0xFE` reserved row is split into an explicit `0x07` row ("reserved
  for `handoff` per
  [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr),
  design-level, not yet allocated") plus a `0x09`-`0xFE` reserved row
  (honoring [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)'s choice not to tighten its reservation into an allocation),
  plus a disambiguation note distinguishing session checkpoints from
  [§2.4](../atrib-spec.md#24-checkpoint-format) log checkpoints;
  [§3.2.1](../atrib-spec.md#321-node-types) participation-matrix row; Appendix A
  session-tree vectors.
- **`CLAUDE.md`:** event_type byte-mapping line in "Key technical decisions";
  repository-structure entry for the new conformance directory; DECISIONS.md
  summary line.
- **`DECISIONS.md`:** this ADR; a status update to
  [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) noting
  `0x08` is now allocated adjacent to its `0x07` reservation, which remains
  design-level.
- **`scripts/check-doc-sync.mjs`:** the node-type count check (Check 2) trips
  when [§3.2.1](../atrib-spec.md#321-node-types)/ARCHITECTURE gain the row, so update the enumeration ground
  truth; edge-type count (Check 1) stays at nine (assert unchanged); consider
  adding a byte-table ↔ URI-table consistency check while touching the
  script, per the CLAUDE.md guidance to extend rather than rely on review.
- **At promotion, the [D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)
  sync-trigger checklist:** URI table, byte mapping, package constants
  (`@atrib/mcp`), log-node decoder, dashboard chip color, verify-loop
  `validEventTypes`, metrics filter.
- **`README.md` / `ARCHITECTURE.md`:** any event-type or node-type
  enumerations; `PRIOR-ART.md` gains the RFC 6962-over-session-streams row if
  absent. `DESIGN.md` only when the explorer renders checkpoint coverage
  (defer; state why the contract did not change otherwise). `METRICS.md` if
  checkpoint coverage becomes a dogfood metric.

## Open questions (operator decisions)

- What producer_origin constant should origin-less cognitive producers use in the [§1.2.2](../atrib-spec.md#122-content_id-derivation) content_id input (they have no MCP server URL; directory-node uses its service origin): a fixed 'atrib:' pseudo-origin, the producing package name, or something else?
- Where does the checkpoint producer ship: the @atrib/emit family (a specialized emit like annotate/revise), the private primitives runtime / future atribd daemon (redesign step 5), or both?
- What is the default checkpoint trigger policy for dogfood: every N records, every T minutes, at session end via a host hook, or a combination, and is the trigger host-owned or wrapper-owned?
- Is 24h the right verifier default for the stale-undeclared freshness bound, and should it be per-verifier config only or a spec-recommended default?
- Should counterparty position attestation ('hash H at index i under root R') get a step-4 universal-evidence-envelope profile, or is a plain annotation record sufficient indefinitely?
- Should producers set informed_by to the prior checkpoint hash by default (giving a declared-plane INFORMED_BY edge between checkpoints), or leave that to explicit operator opt-in per [D113](../DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default) discipline?
- When should the one-time retroactive backfill over pre-adoption dogfood history run, and over which contexts (all mirrored contexts vs. a curated allowlist)?
- Does the promotion ADR allocate 0x08 while 0x07 is still only design-reserved, or should handoff's promotion be resolved first so the byte table never carries a skipped design-level reservation?
