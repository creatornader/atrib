# Redesign upgrade path: clean-room findings → ordered, compatible spec changes

Status: proposed working plan (pre-ADR). Each item below is a candidate ADR;
none is accepted yet. Source: the 2026-07-06 clean-room redesign analysis
session. The governing constraint for every item: **no signed byte of any
existing record, log entry, or checkpoint changes.** Every step is additive
except step 7 (a subtraction of scope, not of bytes).

The clean-room exercise re-derived atrib's invariants (degradation contract,
fact/policy separation, Ed25519, deterministic derivation, local mirror as the
center of gravity) and diverged on infrastructure ontology: what gets to be an
operated service, what the atomic object is, who the trust root is. Every
divergence turned out to be reachable by *promoting* something atrib already
has. This document is that promotion sequence, ordered by dependency.

## 1. Anchor plurality as the default trust posture

**Promotes:** [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)
cross-log replication from optional hardening to default posture; generalizes
"log" to "anchor."

**Shape.** The spec defines an *anchor interface*: a service that accepts a
hash (record hash or session-checkpoint root) and returns an inclusion /
existence proof independently verifiable later. Conforming anchors include
atrib log-node instances, Sigstore Rekor, RFC 3161 TSAs, and OpenTimestamps.
The existing `log_proofs` array form is the wire shape; it gains sibling proof
types for non-tlog anchors. SDK default config requires **≥2 independent
anchors**; single-anchor operation is an explicit opt-in
(`allow_single_anchor: true`), mirroring the `allow_unresolved_informed_by`
pattern from [D113](../DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default).

**Position of log.atrib.dev.** It does not go away and is not demoted in
product terms: it remains the best-behaved anchor (explorer, APIs, SSE feeds,
fast inclusion proofs) — but it becomes *one member of the anchor set*, so the
protocol's trust claim no longer terminates at the operator. The verifier
threshold M ≥ 2 machinery from
[D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) /
[§2.11](../atrib-spec.md#211-cross-log-replication) already implements the
verification side.

**Compatibility.** Existing single-log bundles remain valid (they verify as
anchor-count-1 with a tier flag, exactly like `cross_attestation_missing`).
No record change. No log-node change required to start; Rekor/TSA anchoring is
producer-side.

## 2. Session checkpoint event type (the stream, formalized)

**Promotes:** the per-context mirror JSONL (physically) and the
CHAIN_PRECEDES chain (logically) to a first-class Merkle-committed session
stream.

**Shape.** One new event type, promoted through the
[D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
gate: `session_checkpoint`. Its body commits to the Merkle root over the
ordered `record_hash` values of the context so far (plus range: first/last
index, prior checkpoint hash). Signed like any record; submitted/anchored like
any record — but anchoring one checkpoint root per interval is what makes the
step-1 multi-anchor posture affordable.

**What it buys.**
- Selective disclosure: prove event N belongs to a committed session history
  without revealing events 1..N-1 (inclusion proof against the session root),
  complementing the [§8.3](../atrib-spec.md#83-salted-commitment-posture)
  salted-commitment posture.
- Completeness claims: "this is the *whole* session as of checkpoint K"
  becomes provable; per-record commitments alone can never distinguish
  "committed 10 actions" from "committed 10 of 50."
- Cheap counterparty attestation of position: a co-signer can attest an event
  hash *plus* its position under a session root.

**Historical sessions: attested backfill.** A checkpoint signed now over an
old chain proves the history existed and was tree-committed as of the backfill
date, not as of the original session. Verifiers tier it accordingly
(`retroactive: true`). Existing log entries remain the per-record anchors of
pre-stream history.

**Compatibility.** Purely additive. Existing records, chains, edge
derivation, and verifiers are untouched; old verifiers see an unknown event
type and ignore it per the extension rules.

## 3. Delegation certificates (principal → run keys)

**Promotes:** existing flat agent keys to *principal* keys; adds one new
object rather than replacing the identity model. Deliberately certification,
not the key *derivation* deferred by
[D038](../DECISIONS.md#d038-per-conversation-key-derivation) — explicit,
scoped, no deterministic linkage from a parent secret.

**Shape.** A delegation certificate: principal key signs
`{run_pubkey, scope, not_after, context_id?}`. Run records are signed by the
run key, which occupies the existing `creator_key` slot in both the record and
the 90-byte log entry — no format change. The certificate travels in-band
(genesis record body, or as an evidence attachment per step 4). Verifiers walk
record → run key → certificate → principal, offline. A record signed directly
by a principal is delegation depth 0 — i.e., every record ever signed is
already valid under this model, by definition.

**What it buys.**
- Revocation blast radius of one run (a signed revocation record or directory
  tombstone per certificate), so principal keys never rotate because a sandbox
  was compromised.
- [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)'s
  signer proxy is demoted from structural requirement to optional hardening:
  the key inside the sandbox is worth one scoped, expiring run.
- Capability scoping ([D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes))
  gets a second, in-band carrier: the certificate's `scope`.

**Compatibility.** Additive object + verifier logic. Old verifiers verify new
records' signatures fine and attribute to the run key (degraded attribution,
not broken verification). Directory continues to map principals; run keys
never enter the directory.

## 4. Universal evidence envelope

**Promotes:** [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)'s
generic tiered authorization evidence blocks to the single protocol-level
attachment model for *all* externally verifiable material: OAuth/MCP
introspection results, AAuth, x401, AP2/VI receipts, human approvals
([D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)'s
separate signed approval evidence), counterparty co-signatures, and
delegation certificates (step 3).

**Shape.** One envelope schema (type URI, tier, verifier facts, payload
hash/reference), N profiles. Each profile versions independently of the spec.
The protocol accommodates payments precisely by knowing nothing specific about
any payment protocol; the transaction event type and the ≥2-distinct-signers
cross-attestation rule ([D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records))
stay in core because they are trust semantics, not protocol plumbing.

**Compatibility.**
[D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) /
[D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side) /
[D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence)
evidence blocks already have this shape; the work is declaring the envelope
normative and migrating profile docs out of the spec body into per-profile
documents.

## 5. Daemon consolidation (`atribd`)

**Promotes:** the private `services/atrib-primitives` runtime shape
([D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned),
[D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes))
to the *public, default* integration: one host-owned local daemon owning keys
(or signer-proxy client), mirror, content index, and the primitive tool
surface over Streamable HTTP; stdio shims for harnesses that need them.

**Shape.** Internally two handlers — write and read — with the seven primitive
names mountable as thin named aliases where the tool-list affordance is wanted
(a tool named `atrib-revise` in the tool list actively prompts mind-change
recording; a `ref.kind` enum buried in a schema does not). The operational
surface the seven-process layout actually cost (spawn storms, coordinator,
per-generation health gates, ppid session discovery) dissolves regardless of
how many names are mounted.

**Compatibility.** Signed records byte-identical (the primitives already share
`handleEmit`/`emitInProcess`). The seven npm packages continue to work as
standalone stdio servers; the daemon becomes the recommended topology, not the
only one.
[D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes)
health gates carry over as the daemon's own probes.

## 6. Verb rename: `attest` / `recall`

Tentatively agreed verbs for the consolidated surface: **`attest`** (write:
emit/annotate/revise collapse to one handler with `ref.kind`) and **`recall`**
(read: recall/trace/verify collapse to one handler with `shape` and
`verification` parameters; summarize relocates to the harness). The full
upstream/downstream impact catalog — npm packages, tool names, persisted
producer labels, signed-bytes analysis, docs/spec/skill surfaces — lives in
[`attest-recall-rename-impact.md`](attest-recall-rename-impact.md). No rename
lands until that catalog's sequencing is accepted as an ADR.

## 7. Payments profile spin-out

**Subtracts scope, not bytes.** Protocol detection for the six payment
protocols, settlement schemas, and the
[§4](../atrib-spec.md#4-attribution-policy-format) policy/calculation layer
move out of core (separate packages / separate docs), attached through the
step-4 envelope. Core keeps: the `transaction` event type, cross-attestation
([D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) /
[D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)),
and the envelope. The [§4](../atrib-spec.md#4-attribution-policy-format)
calculation remains a pure function over the graph, so nothing about the
spin-out forecloses settlement later — that reversibility is the proof the
original layering was right.

## Dependency order

1 and 3 are independent starters. 2 depends on nothing but makes 1 cheap.
4 precedes 7 (the envelope must exist before profiles move onto it).
5 is independent of 1–4; 6 lands with or after 5 (the rename is cheapest when
the daemon is the mounting point for aliases). Suggested landing order:
**4 → 1 → 2 → 3 → 5 → 6 → 7**, each as its own ADR with a conformance-corpus
addition in the same commit.

## Relationship to a future SDK effort

The planned Python and JS/TS client libraries should be built against the
*post*-step-5/6 surface (daemon + two verbs) rather than the seven-server
topology, with the [§1](../atrib-spec.md#1-attribution-record-format) record
layer ported against the existing conformance corpora (1.2.6, 1.4, 3.2.4,
multi-producer 1.2.3). See
[`atrib-sdk-session-brief.md`](atrib-sdk-session-brief.md) for the handoff
brief.
