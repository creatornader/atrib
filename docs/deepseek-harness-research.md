# DeepSeek Harness: trace architecture and implications for atrib

Research document, 2026-08-14. Not an ADR. This is a primary-source comparison
of DeepSeek Harness (`dsh`) with atrib. It does not propose an integration or
claim that DeepSeek's local session records are independently verifiable.

The DeepSeek sources were inspected at commit
[`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a).
The project is in developer preview and explicitly expects compatibility
breaks. Its public launch material calls every run traceable. This document
defines that statement precisely before comparing it with atrib.

## 1. Executive read

DeepSeek Harness is an unusually explicit implementation of the **host-owned
runtime-log layer**. It makes the session event stream the source of model
context, records model-visible inputs and execution results, exposes a
Trajectory inspection projection, and derives resume, fork, replay, search,
and UI views from the same stream. It also treats plugin seams, lifecycle
events, and crash-safe append persistence as first-class design work.

That is highly complementary to atrib. It validates the premise that a rich
agent event stream matters. It does not replace atrib: DeepSeek's trace is a
local, harness-authoritative history. atrib adds signer identity, immutable
record commitments, declared relationship lineage, third-party verification,
and public or replicated anchoring when a deployment chooses it.

The useful product sentence is: **DeepSeek can tell an operator how a DSH run
unfolded; atrib can let a receiving host or independent verifier check a
claimed action and the context declared to have informed it.** Neither
substitutes for the other.

## 2. What DeepSeek Harness actually ships

### Plugin architecture and control seams

DSH is a Cordis application in which the model adapter, tools, session log,
and agent loop are plugins. A profile composes ordered bundles and patches; the
documented extension points distinguish durable session events, live agent
events, and capability events. Waterfall and serial event modes support policy
interception before a tool runs or a request reaches the model.

Sources: [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md),
[Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.md),
and [tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md).

The tool pipeline logs `tool/call` before execution, runs approval, sandbox,
hook, and guard work at the pre-execution seam, runs post-execution processing,
then publishes one frozen authoritative `tool/result` outcome to the session.
This is the correct seam for an optional atrib producer or action-gate adapter.
It is not itself a cryptographic gate.

### Session log and replay

The durable object is an append-only `SessionEvent` log. Each entry has a
monotonic sequence number, timestamp, JSON payload, and event type. Surface
events can cite contributing earlier event sequence numbers and carry an append
or replacement operation. The project states its key invariant plainly:
anything model-visible must be reconstructable from the session log. Raw
assistant chunks are also retained for replay and UI fidelity. The session
header has `parentSession` and `seedLength` to describe inherited work after a
fork or resume.

Sources: [architecture, Session log](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md#session-log),
[session types](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/session/src/types.ts#L58-L99),
and [generated persistence catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md).

The persistence design is mature for a developer preview. Default logs use
concatenated Zstandard frames over logical JSONL batches. Materialization,
append, file and directory sync, rollback after a failed write, checksum
validation, and torn-final-frame recovery are specified. This supplies useful
durability and replay fidelity. It does not make a log entry tamper-evident to
someone who does not trust its local storage owner.

Source: [Zstandard JSONL session-log decision](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md).

### Trajectory: an inspection projection, not a new evidence object

Trajectory is DSH's stage-oriented inspection view. It groups the loaded event
window into requests, assistant activity, tool-call trees, prompt and tool
schema state, compactions, steering input, timing, usage, and errors. It
provides search, a timeline, folding, pagination, and a record inspector. The
current architecture deliberately shares one session window with Chat while
using target-specific definitions and state assembly for each view. It consumes
browser session data and explicitly has no service or model-request effect.

This is a very good product pattern. A trace viewer should be a view over an
owned event stream, not an invented second source of truth. DSH also documents
pagination repair and exact business keys such as `turn:step`, root call ID,
and compaction ID. That is a precise account of where correlation must be
explicit to avoid a false join.

Sources: [Trajectory UI](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-trajectory/README.md#L5-L17),
[trajectory ledger](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/feature/2026-07-27-trajectory-inspection-ledger.md),
and [trajectory context assembly](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-08-11-trajectory-conversation-context-assembly.md).

### Trace and tracing

DeepSeek's public site says every run is traceable because system prompts,
reasoning, tool calls and results, subagent scheduling, and context injections
are recorded in the append-only session log. It names resume, fork, search,
replay, and Trajectory as consumers of that stream. In source, the event
catalog includes request and stream activity, tool call-result pairs,
approvals, hook outcomes, goals, compactions, subagent descriptors, and
workflow lifecycle records.

Sources: [official launch page](https://deepseek.com/harness/en/),
[agent lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/agent-lifecycle.md),
and [persistence catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md).

This use of "trace" is a session transcript and its projections. It is not an
OpenTelemetry trace, an attribution graph, or a proof log. The published OTel
integration is an optional log-export pipeline, not a separately established
span exporter. This matches atrib's existing runtime-log boundary in
[D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
and [the trace landscape research](traces-integration-research.md).

### Attribution

The published app-attribution mechanism is provider-request attribution, not
action provenance. DSH requires a provider-neutral `User-Agent` carrying a
static public application identity. Its inspected identity package uses an
anonymous local correlation UUID and explicitly does not authenticate an
account. The policy keeps provider-specific request identity separate and
excludes secrets, paths, prompt text, and per-user identifiers from the
app-attribution value.

Sources: [mandatory app-attribution header decision](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)
and [identity package](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/identity/README.md#L5-L9).

That is a sound transport and support practice. It should not be described as
attribution in atrib's sense: it does not attest to the identity of a tool-call
producer, its inputs or result, a causal relationship, or third-party
verification.

### Lemmas

I could not find a defined DSH construct named "lemma" in the public launch
page, documentation index, or inspected source paths at this commit. GitHub's
unauthenticated code search did not expose result content, so this is an
explicit search limit, not proof of absence. If the term refers to a specific
DeepSeek design note, paper, or code path, it needs a separate source-bound
pass before we infer its role.

## 3. The actual overlap and the decisive divergence

| Surface            | DeepSeek Harness                                                                              | atrib                                                                                     | Strategic reading                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primary object     | Local append-only session event log                                                           | Signed protocol record plus declared graph relationships                                  | Complementary layers, not competing logs.                                                 |
| Integrity boundary | Local persistence, checksums, replay contract                                                 | Ed25519 record signature, canonical bytes, Merkle-log and anchor verification where used  | DSH durability does not prove a history to an external party.                             |
| Causality          | Sequence numbers, `sourceEventSeqs`, request and call IDs, parent-session and delegation data | Signed `informed_by`, annotation and revision relationships, verifier policy over lineage | DSH captures operational causality. atrib carries asserted, checkable provenance.         |
| Tool control       | Plugin event seams, approvals, guards, sandbox, hook policy                                   | Host-owned action gate and signed decision/outcome evidence                               | A DSH adapter can compose both. atrib should not claim it enforces an unmodified DSH run. |
| Inspection         | Trajectory and Chat projections over the DSH log                                              | Explorer and local recall/trace projections over signed records and sidecars              | Keep viewer surfaces separate. DeepSeek already owns the rich DSH trace UI.               |
| Portability        | DSH-specific event vocabulary and persistence                                                 | Protocol records and evidence profiles across host runtimes                               | atrib can bind a DSH window without becoming the DSH event store.                         |
| Provider identity  | Static application `User-Agent` and a local anonymous UUID                                    | Signer identity and optional delegated authority                                          | These answer different questions.                                                         |

## 4. Competitive insights

### What the release validates

1. **The event stream is a product surface.** DeepSeek did not treat logging as
   debugging exhaust. It made the stream drive context reconstruction, replay,
   fork, search, and a first-class inspection experience. atrib's
   [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
   and [D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records)
   direction is well aligned: raw host logs remain host-owned, while atrib
   contributes proofs and cross-run relationships.

2. **Correlation IDs are part of correctness.** The trajectory design refuses
   to merge legacy events without the required correlation key. atrib should
   retain the same refusal posture for runtime-log adapters and evidence
   profiles. A plausible join is worse than a missing projection.

3. **One execution seam can serve control and evidence.** DSH's pre-execute
   and post-execute waterfalls make a clean optional integration point for
   signing call intent and final outcome. The implementation must preserve DSH
   ordering and distinguish observation from a fail-closed protected action.

4. **Trace UI is not the wedge.** DSH's Trajectory is already purpose-built for
   its internal facts. Rebuilding that viewer in atrib would recreate the
   rejected Langfuse-style path from
   [D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload).
   The wedge is portable evidence at
   the boundary where a DSH record becomes relevant to another agent, host,
   merchant, or auditor.

### What remains atrib's differentiated problem

DSH's own sources support reconstruction by its operator. They do not, in the
inspected material, specify per-event signing, Merkle inclusion, independently
verifiable provenance, external attribution, verifier trust roots, witness
consistency, delegated authority, or a lemma/proof subsystem. atrib's
differentiation should remain exact: it is the evidence and verification layer
for selected actions and context claims, not the canonical transcript store for
every harness.

Do not turn the absence of a documented DSH proof layer into a broad
competitive claim. It is a boundary of this review, and DSH is rapidly changing.

## 5. High-value integration hypothesis, deliberately not a plan

The lowest-risk future proof is an optional `dsh-atrib` plugin with two
independent modes:

1. **Observational bridge:** at durable DSH `session/event` append or post-tool
   result, create atrib records or a
   [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)/[D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records)-style
   runtime-log manifest with
   DSH session ID, event/window bounds, canonicalization version, and redaction
   policy. DSH remains the raw-log owner and Trajectory stays the viewer.
2. **Protected-action bridge:** at DSH's pre-execution seam, require a host
   policy decision only for explicitly configured high-impact tools. Sign the
   allow, block, or escalation decision and its eventual outcome. Do not imply
   that importing a DSH session log retroactively governs execution.

The first mode tests transcript binding and cross-harness continuity. The
second tests action-path composition. They have different security properties,
failure modes, and product claims, so they must not share a success metric.

Before implementation, validate all of the following against a pinned DSH
release: event ordering and flush semantics; whether plugin listeners can
receive durable event payloads without perturbing the driver; actual session
ID, fork, and subagent identities; redaction behavior; crash and retry
semantics; and an end-to-end verifier showing that a DSH artifact matches the
claimed atrib receipt.

## 6. Questions for a second pass

- Does DSH have a stable package/release contract, or only a moving `master`
  developer preview?
- Which DSH events represent an externally meaningful completed action rather
  than model intent, a transport attempt, or an internal UI fact?
- Can a downstream plugin introduce durable events and persistence schema
  without losing replay compatibility on upgrades?
- What should a verifier receive when DSH content is redacted: record body,
  hash commitment, encrypted archive reference, or only a window manifest?
- Does the referenced Cordis paper supply a formal meaning for "lemmas," or is
  that term from a separate DeepSeek artifact?

## Related research

[Lemma research](lemma-research.md) analyzes the hosted semantic-monitoring
layer that can consume an OpenTelemetry-style projection of a harness run. It
keeps the DeepSeek session log, Lemma issue analysis, and atrib evidence layer
as separate objects with different trust boundaries.

## Source register

- [DeepSeek Harness official launch page](https://deepseek.com/harness/en/)
- [Repository README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/README.md)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md)
- [Agent lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/agent-lifecycle.md)
- [Tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md)
- [Session persistence catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md)
- [Trajectory inspection ledger](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/feature/2026-07-27-trajectory-inspection-ledger.md)
- [Trajectory conversation-context assembly](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-08-11-trajectory-conversation-context-assembly.md)
- [Zstandard JSONL session logs](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md)
- [Mandatory app attribution](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)
