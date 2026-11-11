# P061 draft: log-window event roots as RFC 6962 Merkle trees

**Status:** Candidate. Filed 2026-11-02 as [P061](../DECISIONS.md#p061-log-window-event-roots-should-be-rfc-6962-merkle-trees).
Not accepted. No signed byte, published schema or conformance case changes
until this is acted on.

**Extends:** [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
(runtime-log window manifests), [D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records)
(session-transcript source). Reuses the tree algebra of
[D139](../DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized)
and [§1.2.10.1](../atrib-spec.md#12101-session-tree-construction). Relates to
[D168](../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable).

## Summary

A `log_window_manifest` commits to a runtime-log window through `event_root`.
In v0, `event_root` is `sha256(JCS({schema, events: [ordered event refs]}))`:
one hash over a flat list. That gives integrity but no selective disclosure
and no relation between windows. This draft proposes a v1 window root that is
the RFC 6962 Merkle Tree Hash over one leaf per event ref, so that:

1. one event can be proven to belong to a committed window by disclosing that
   event's ref and about log2(n) sibling hashes, with nothing about any other
   event beyond the window size; and
2. a later window over the same growing log can be proven to extend an earlier
   one, so history rewritten between two manifests is detectable.

The change is additive. v0 manifests stay valid and verifiable forever; the
manifest's `canonicalization.algorithm` says which rule built `event_root`.

## Problem

### Proving one event costs the whole window

To check one event against a v0 `event_root`, a verifier needs every event ref
in the window, because the root is a hash over the complete list. Each ref
carries `event_id`, `position`, `event_hash`, and optionally `kind`,
`timestamp` and `parent_event_hashes`. So a single-event proof:

- grows linearly with the window, and
- discloses the id, position, kind, timestamp, parent links and content hash
  of every other event in it.

The second point is the more serious one. Runtime-log windows are host-owned
and usually private ([D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
privacy posture `host-owned`, redaction `hash-only`). Showing a reviewer that
one tool call happened should not hand them a timeline of every prompt,
attachment and tool call in the session. Bodies stay withheld in both cases;
the metadata does not.

### Successive windows are unrelated

Hosts that manifest a growing log at intervals (for example at the end of each
agent turn, over the full transcript so far) produce a series of manifests
whose roots have no checkable relation. Each manifest verifies on its own. If
the host, or anything with write access to the log, edits an earlier event
between two manifests, both manifests still verify against their own evidence,
and nothing shows that the later window disagrees with the earlier one about
the shared prefix. [D139](../DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized)
solved exactly this for signed record streams; runtime-log windows have no
equivalent.

### Measured on a real window

A spike ran the shipped session-transcript source
([D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records))
over one real 895-event Claude Code session transcript, then built a v1 root
with the existing `@atrib/mcp` session-tree helpers and checked proofs with the
existing `@atrib/verify` session-proof verifiers. No package code changed.

| Measure | v0 flat root | v1 Merkle root |
| --- | --- | --- |
| Bytes disclosed to prove one event | 235,229 (all 895 refs) | 628 (one ref plus 10 hashes) |
| Other events' kinds and timestamps disclosed | all 895 | none (window size only) |
| Root build time | not measured | 8.3 ms |
| Prove window at 223 / 447 / 894 events extends window at 895 | not possible | 11 / 11 / 9 hashes, all verify |
| Detect an edited early event between two windows | not possible | consistency proof fails |

The v0 root computed by the spike matched the manifest the shipped source
produced, so the input refs are the ones the current code commits to.

## Proposal

### 1. v1 window root

- **Algorithm id.** `canonicalization.algorithm: "rfc6962-jcs-sha256-v1"`, with
  `window_root_rule: "RFC 6962 MTH over sha256(JCS(window leaf)) in window order"`.
  The other rules (event hash, manifest hash, projection root, receipt root)
  are unchanged in v1.
- **Leaf value.** The raw 32 bytes of
  `SHA-256(JCS({"schema": "https://atrib.dev/schemas/runtime-log/window-leaf/v1", ...event ref}))`,
  where the event ref is normalized exactly as v0 normalizes each list member
  (optional fields present only when set). Leaves are bytes, not the
  `sha256:` display string, matching [§1.2.10.1](../atrib-spec.md#12101-session-tree-construction).
- **Tree.** RFC 6962 §2.1 verbatim, as [§2.3.2](../atrib-spec.md#232-leaf-hash-computation):
  `leaf_hash = SHA-256(0x00 || leaf)`, `node_hash = SHA-256(0x01 || left || right)`.
  The schema string inside each leaf preimage keeps a window leaf from ever
  equalling a session-tree leaf (a signed record hash), so roots from the two
  tree kinds cannot be confused even though both use 32-byte leaves.
- **Order.** Window order, which is the source's position order. Leaf order is
  part of what the host claims, as in v0; it is not re-sorted.
- **Empty windows.** Prohibited, as v0 already requires at least one event.
- **`event_count`** equals the tree size.

### 2. Single-event proof

A new disclosure object, `log_window_event_proof` v1:

| Field | Meaning |
| --- | --- |
| `manifest_hash` | Hash of the v1 manifest the proof is against |
| `index` | 0-based leaf index |
| `tree_size` | The manifest's `event_count` |
| `event` | The event ref at that index |
| `proof` | Sibling hashes, leaf to root |
| `body` | Optional. The raw event payload, so `event_hash` can be recomputed |

The verifier recomputes the leaf from `event`, runs the
[§2.7](../atrib-spec.md#27-inclusion-proof-verification) inclusion procedure
against `event_root`, and, when `body` is present, checks
`event_hash = sha256(JCS(body))`. Disclosure is then: one ref, its body if the
host chooses, the window size, and the proof hashes. One adjacent leaf hash is
among them; every higher node aggregates several events and reveals nothing
recoverable.

Proving a tool call end to end composes this with what already exists: the
signed record that committed the manifest (through `args_hash` per
[D099](../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash)),
its log inclusion proof, the manifest itself, and the event proof.

### 3. Append-only windows

- **Signed claim.** An optional `prior_window` object on a v1 manifest:
  `{ manifest_hash, event_count, event_root }` of an earlier v1 manifest with
  the same `source.id`, `session.id` and `window.start`. Present only when
  set, following the absence-not-null rule.
- **Proof.** A `log_window_consistency_proof` disclosure carries the RFC 6962
  §2.1.2 proof from `(prior event_root, prior event_count)` to
  `(event_root, event_count)`. Verification is RFC 6962 §2.1.4.2, the check
  the [§2.9](../atrib-spec.md#29-witnessing-and-cosignatures) witness protocol
  and session checkpoints already use.
- **Equivocation.** Two manifests signed under the same key, with the same
  source, session and start, whose roots cannot be related by a consistency
  proof over their shared prefix, are equivocation evidence against that key.
  Verifiers report it as a categorical fact (signal, not block), as
  [§1.2.10.2](../atrib-spec.md#12102-consistency-and-equivocation) does for
  session checkpoints.
- **Honest scope.** This proves the host's committed windows agree with each
  other. It does not prove the host committed everything it ran; that remains
  [D168](../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable)
  coverage's job.

Windows that start fresh (a compaction continuation, a fork) keep using the
existing `compaction` and `fork` bindings; `prior_window` is only for the same
log growing.

### 4. Library and corpus

- `@atrib/runtime-log` gains `hashLogWindowV1`, `logWindowEventProof`,
  `verifyLogWindowEventProof`, `logWindowConsistencyProof` and
  `verifyLogWindowConsistency`, delegating to the existing RFC 6962 helpers
  rather than adding a third Merkle implementation. `createLogWindowManifest`
  takes an `algorithm` option; `verifyLogWindowManifest` dispatches on
  `canonicalization.algorithm`.
- `spec/conformance/runtime-log/` gains v1 cases: valid v1 root (1, 2 and 5
  events), display-string-leaf trap, v0 and v1 algorithm mismatch, valid and
  tampered event proofs, valid consistency proof, an edited-prefix pair that
  must fail, and a `prior_window` identity mismatch.
- The session-transcript source switches its default to v1 once the corpus
  lands. Other `RuntimeLogSource` implementations get v1 by passing the
  option; the change is independent of log format, so every harness profile
  added later inherits it.

## Considerations

- **Additive.** No atrib record field, event type, edge or log entry changes.
  Manifests are committed inside ordinary signed content, so signed bytes for
  existing records are untouched. The [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
  bar is not engaged.
- **Old manifests.** v0 manifests remain valid and verifiable. They cannot
  produce single-event or consistency proofs. Re-manifesting a still-available
  log under v1 produces a new commitment, not a retroactive upgrade of the old
  one; if anything is ever re-committed that way it should say so, following
  the `retroactive` precedent of [§1.2.10.3](../atrib-spec.md#12103-retroactive-checkpoints-and-freshness).
- **Guessable hashes.** `event_hash` is an unsalted hash of the payload. A
  proof reveals one adjacent leaf hash; confirming a guess for that neighbour
  requires guessing its whole ref (id, position, kind, timestamp and payload).
  For sources with random event ids this is not practical. For sources whose
  ids fall back to line positions (268 of the 895 events in the measured
  transcript had no uuid) and whose payloads are short, it can be. An optional
  per-leaf salt, `leaf = sha256(JCS({schema, salt, ...ref}))` with salts derived
  by the host from a per-session secret and disclosed only for proven leaves,
  closes it in the [§8.3](../atrib-spec.md#83-salted-commitment-posture) style.
  The cost is that anyone holding the log but not the secret can no longer
  recompute the root. Recommendation: specify the salted variant, leave it off
  by default, and revisit when a source with low-entropy ids publishes proofs.
- **Cost.** Building a root is linear in the window and took 8.3 ms for 895
  events. Hosts that manifest the full log at every interval do the same total
  hashing as today; an incremental tree would make each interval
  logarithmic, but that is an implementation choice, not a protocol one.
- **Other flat roots.** The coverage action root
  ([D168](../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable)),
  projection root and side-effect receipt root are also flat sorted lists. The
  coverage action root has the same problem (proving one action was captured
  discloses every action); it is the natural second step, under its own
  algorithm id, once v1 windows have a consumer. Projection and receipt roots
  are small and rarely disclosed singly; leave them.

## Alternatives considered

- **Put transcript events in a `session_checkpoint`.** Rejected. Session-tree
  leaves are signed atrib record hashes, and verifiers resolve them as
  records. Runtime-log events are unsigned host events; mixing them in would
  change what a checkpoint leaf means.
- **Sign each event.** Rejected for the reasons in
  [D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records):
  transcripts are bulk host-owned bodies and the window commitment is the
  boundary. Per-event signing stays with
  [P013](../DECISIONS.md#p013-new-runtime-integration-pattern---hosted-runtime-adapter-sign-events-stored-by-hosted-runtimes-like-anthropic-managed-agents).
- **Smaller flat windows chained by hash.** Manifesting only each interval's
  new events and chaining manifests by `prior` hash gives tamper evidence
  across intervals, but proving one event still discloses every ref in its
  interval, and a verifier has to walk the chain to relate distant windows. The
  Merkle root gives both properties with one object.
- **Sorted leaves.** Rejected. Position is part of what a window means; the
  v0 list is ordered for the same reason.
- **Vector or polynomial commitments.** Rejected for now. Smaller proofs, but
  new cryptography and libraries, where RFC 6962 is already implemented,
  tested and witnessed across atrib.

## Open questions

1. Should v1 become the default for new manifests as soon as the corpus lands?
   Recommended: yes.
2. Should the salted leaf variant ship in v1 or wait for a consumer?
   Recommended: specify now, off by default.
3. Should `prior_window` be required when a host manifests the same log
   repeatedly? Recommended: no; optional and checked when present, since
   requiring it would make a missed interval an error rather than a gap.
