# Agent traces: landscape, overlap with the runtime-log layer, and integration options

Research document, 2026-07-14. Not an ADR. External claims were verified against
primary sources on the date above; repo claims carry file references. The
decision candidates in [§8](#8-decision-candidates) are proposals for discussion,
not accepted decisions.

## 1. The question

Agent harnesses produce traces: full session transcripts, span logs, event
streams. The questions this document answers:

1. How accessible and usable are traces across harnesses today (Claude Code,
   Codex, Pi, Hermes Agent, OpenClaw, custom harnesses)?
2. How does "trace integration" relate to atrib's existing runtime-log work
   ([D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows),
   [D122](../DECISIONS.md#d122-host-runtime-adapters-stay-distinct-from-agent-framework-adapters)),
   its OpenInference intake
   ([D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)),
   and its recall/trace primitives? Where is the overlap, where is the
   difference?
3. What would indexing, searching, and semantically mapping traces mean for
   atrib, and which parts of that should atrib build, bind, or leave to other
   layers?

## 2. Four things called "trace"

The word "trace" names at least four distinct objects in this problem space.
[ARCHITECTURE.md](../ARCHITECTURE.md) already separates them in its
"Observability Boundary" reader map; this table restates the separation with
the harness-transcript landscape added.

| Object | Example | Owner | atrib category |
| --- | --- | --- | --- |
| Harness session transcript | Claude Code `~/.claude/projects/*.jsonl`, Codex `~/.codex/sessions/**/rollout-*.jsonl`, Pi sessions, Hermes Agent session export | The harness (host runtime) | Runtime log: a host-owned event stream over one run or session ([D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)) |
| OTel / OpenInference span tree | A `trace_id`-scoped tree of nested spans from instrumentation | The instrumentation pipeline | Intake and correlation surface, not canonical evidence ([D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)) |
| atrib provenance trace | `GET /v1/trace/{record_hash}` ([§3.4.5](../atrib-spec.md#345-get-v1tracerecord_hash)) | The graph service, derived from signed records | Declared-relationship projection: walks INFORMED_BY, ANNOTATES, REVISES; never CHAIN_PRECEDES |
| Primitive walk (the `recall` verb, shape `walk` with a direction; `trace` / `trace_forward` stay mounted as permanent aliases per [D164](../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)) | The read-verb MCP surface over the local mirror | The agent's own substrate | Bounded `informed_by` walk with sidecar summaries (cognitive primitive #5) |

ARCHITECTURE.md pins the rule that makes the first row work: hosts call the
same object "a session log, event stream, thread, trace, or run history. The
name varies. The boundary does not" (ARCHITECTURE.md, "Runtime log boundary").
The consequence for this document: **when an operator says "traces" about
Claude Code or Codex sessions, the atrib object that governs them is the
runtime log, not `/v1/trace` and not the span tree.** The rest of the analysis
follows from placing harness transcripts in that category.

## 3. External landscape (verified 2026-07-14)

### 3.1 Per-harness trace availability

| Harness | Local trace surface | Format | Notes |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/` | One JSONL file per session; subagent transcripts nest under `<sessionId>/subagents/` | Full replayable event stream: user, assistant, tool events, `parentUuid` threading, `gitBranch`, `cwd`. Docs describe a `cleanupPeriodDays` retention default of 30 days; on the dogfood machine no value is set and transcripts persist back four months, so treat retention as version- and config-dependent rather than assuming the documented default is active |
| Codex | `~/.codex/sessions/YYYY/MM/DD/` | Rollout JSONL, `{timestamp, type, payload}` per event | Plus a session index file and an archive directory |
| Pi | `~/.pi/agent/sessions/` | JSONL, tree-structured via `id`/`parentId` | One file can hold multiple branches of work |
| Hermes Agent (Nous Research) | `hermes sessions export session.jsonl --session-id <id>` | JSONL; message arrays shaped like Claude Code's | Export command rather than a passively readable directory |
| OpenClaw | Transcript-shaped tables in its state SQLite (`acp_sessions`, `acp_replay_events`, `capture_sessions`, `capture_events`) | SQLite | On the dogfood machine these tables exist but are empty; OpenClaw's bulk on disk is logs, media, cache, and workspace artifacts. Trace capture appears present in schema but not active by default |
| Custom harnesses | Whatever the builder emits | Varies | Two convergence paths exist: OTel GenAI instrumentation, or emitting the Hugging Face Session Traces Format directly |

So the operator's hunch is half right. Traces are more accessible than they
used to be: the two highest-volume harnesses on the dogfood machine write
complete, replayable transcripts to disk by default. What is missing out of
the box is exactly the second half of the hunch: nothing ships indexing,
search, semantic organization, retention policy, or cross-harness unification.
That layer is third-party (claude-mem, memsearch, hosted observability
platforms) or absent.

### 3.2 A de facto interchange format is forming

Hugging Face made agent traces a first-class Hub artifact (May 2026):

- The Hub natively renders Claude Code, Codex, and Pi session JSONL in a
  dedicated trace viewer, auto-detects the format, and tags datasets
  `agent-traces` ([docs](https://huggingface.co/docs/hub/agent-traces)).
- A published [Session Traces Format](https://huggingface.co/docs/hub/agent-traces)
  lets any other harness join: a Claude-Code-style event stream, one JSON event
  per line, one session per file, covering session headers, user and assistant
  messages, tool results, model changes, thinking-level changes, compaction
  summaries, and branch summaries.
- Storage Buckets plus `hf buckets sync` give continuous upload of new
  sessions.
- Community corpora already archive raw sessions organized by harness
  (`claude_code/`, `codex/`, `pi/`, `cursor/`, `opencode/`), unmodified except
  anonymization ([trace-commons](https://huggingface.co/datasets/trace-commons/agent-traces)).

The companion blog post
(["Software Forgets: Agent Traces Are the Memory"](https://huggingface.co/blog/huggingface/agent-traces-as-memory),
2026-05-19) states the product thesis: traces are "the densest record of the
decisions that shaped" a codebase; sync every session to one bucket and "the
agent gets a memory layer for free"; a PR can link back to the trace that
produced it.

Two omissions in that thesis matter for atrib. The post says nothing about
verifiability, signing, provenance, or trust of traces, and nothing about
search, indexing, or semantic organization. The first omission is atrib's
core competence. The second is what atrib's recall stack does for signed
records and deliberately does not do for raw transcripts.

### 3.3 OTel status

- `gen_ai` client spans are stable; agent and framework spans remain
  experimental with no published stabilization timeline
  ([semconv](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)).
- Claude Code exports OTLP metrics and events when
  `CLAUDE_CODE_ENABLE_TELEMETRY=1`; distributed traces are a beta behind the
  additional `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` flag, emitting spans that
  link a user prompt to the API requests and tool executions it triggered
  ([monitoring docs](https://code.claude.com/docs/en/monitoring-usage)).

The practical reading: for local harnesses, the transcript file is today the
complete trace; the OTel path is partial, opt-in, and aimed at fleet
monitoring rather than replay or memory.

## 4. What atrib already has on this surface

Each subsystem below was mapped against source in this repo; references are to
the governing decisions and packages.

**Runtime-log proof layer.**
[`@atrib/runtime-log`](../packages/runtime-log/) implements the
[D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
`log_window_manifest`: a signed commitment over a bounded window of a
host-owned event stream (source identity, window bounds, event root,
projection roots, fork and compaction parents, side-effect receipt roots,
canonicalization, redaction policy, privacy posture). Raw bodies stay with the
host. Verification is offline and file-based, with thirteen pinned conformance
cases ([spec/conformance/runtime-log/](../spec/conformance/runtime-log/)).
Five integration examples prove the shape against real sources, including
ActiveGraph's `export-trace` JSONL, which is structurally the same object as a
harness transcript. [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
explicitly rejected treating an OTel, OpenInference,
or hosted-observability trace as the runtime log, because a verifier needs a
source-owned window identity, canonicalization rule, and privacy posture.

**Adapter taxonomy.** [§9](../atrib-spec.md#9-runtime-integration-patterns)
defines seven runtime integration patterns.
Claude Code composes Pattern #1 (lifecycle hooks) and Pattern #2 (MCP
wrapping) today; Pattern #5 (vendor session export) is documented with a
run-level attestation fallback but has no reference implementation, and
[P013](../DECISIONS.md#pending-decisions) holds the hosted-runtime variant
(per-event signing under the agent's own key). No pattern currently consumes
the local transcript files that Claude Code and Codex already write.

**OpenInference intake.**
[`@atrib/openinference`](../packages/openinference/) maps every OpenInference
span kind to a signed record (TOOL to `tool_call`, the rest to `observation`)
and puts the heavy content (prompts, outputs, usage, cost, scores, model and
prompt metadata) in the local sidecar per
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload).
Span parent-child nesting never becomes an atrib edge; the one automatic
`informed_by` derivation is the LLM-to-TOOL `tool_call.id` match, applied
before signing. [D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)
also carries the standing product rejection: "Build a
Langfuse-style trace viewer inside atrib. Rejected." Composition is the
committed strategy.

**Recall and the content index.** The recall stack is lexical: BM25 over
per-record sidecar content
([D086](../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content)),
weighted by recency and importance
([D085](../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale)),
with explicit coverage contracts
([D123](../DECISIONS.md#d123-critical-path-content-recall-requires-complete-evidence-or-explicit-fallback)-[D125](../DECISIONS.md#d125-complete-content-recall-is-coverage-first-not-cap-first))
and a durable fingerprint-keyed index sidecar
([D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)).
The unit of indexing is one signed record's sidecar content, with a 2048-char
cap per content field. No embedding, vector, or semantic search exists
anywhere in the repo; a "Layer 2" vector sidecar is referenced in comments and
in the consequences of
[D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)
as deferred future work.

**Retrieval semantics from the benchmark work.**
[D149](../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)-[D162](../DECISIONS.md#d162-factual-values-never-truncate-in-rendered-memory)
separated memory retrieval into selection (BM25 ranking, mapping to the
`recall` verb's content and history shapes) and expansion (graph walk from
seeds, mapping to its walk shapes; the legacy `atrib-trace` names stay
mounted as aliases per [D164](../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)), and hardened rendering: own signed content wins over
chain-derived text, lineage renders as ordered chains, rendered lines carry
temporal provenance, factual values never truncate. These rules were tuned on
memory benchmarks and apply to whatever corpus the substrate holds.

**Trace and chain projections.** `/v1/trace` walks producer claims
(INFORMED_BY, ANNOTATES, REVISES), `/v1/chain` walks substrate order
(CHAIN_PRECEDES), and
[D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)
renders a primary path over both as presentation only. None of this touches
harness transcripts; it replays signed causality.

## 5. Overlap and difference: traces vs the runtime-log work

The runtime-log work and the traces question are the same question at the
boundary and different questions in the interior.

**Where they are the same thing.** A harness transcript is a runtime log in
the exact sense of
[D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows):
an append-only, host-owned event stream over a bounded run,
with forks (subagent transcripts, Pi branches), compactions (context-window
compaction events appear in the transcript), and side effects. Every concept
the manifest already commits to has a direct transcript equivalent. The
Session Traces Format even carries compaction summaries and branch summaries
as first-class event types, which map to the manifest's `compaction` and
`fork` bindings. The ActiveGraph example
([packages/integration/examples/activegraph-runtime-log/](../packages/integration/examples/activegraph-runtime-log/))
already proves this flow for an exported JSONL event stream. Binding a
Claude Code or Codex session file into a verifiable window needs only a new
`RuntimeLogSource` adapter over an already-proven manifest shape.

**Where they differ.** The runtime-log layer answers "can a consumer verify a
claim about this window" and stops. The traces question, as posed by the
operator and by the Hugging Face thesis, continues into use: read the
transcript, search it, cluster it, feed it back as memory. atrib drew a
deliberate line here twice.
[D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
keeps raw bodies host-owned and out of the public log.
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)
keeps span content in local sidecars and out of signed records. The substrate stores what the agent chose to sign, and its recall
stack indexes exactly that. Raw transcripts are wider than the signed record
stream: they contain every token of every turn, including content no producer
ever signed. Verifiable binding of transcripts is on-pattern for atrib.
Retrieval over raw transcript content is a new decision, not an extension of
an existing one.

**The linkage nobody else provides.** The Hugging Face post wants a PR to
link back to the trace that produced it, and treats a synced bucket as memory.
Both uses are unverifiable in their proposal: a bucket file can be edited,
replaced, or misattributed after the fact, and nothing binds a transcript to
the actions it claims to describe. atrib's manifest object closes exactly this
gap: `event_root` binds the transcript bytes, `side_effect_receipts` bind the
signed tool-call and transaction records that occurred inside the window, and
the signed manifest record commits the whole binding to the public log before
any retention window can erase the original.
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)
and [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
already set the division of labor for the rest: buckets and archives hold
bodies, viewers render them, and the manifest carries the verifiable binding.

## 6. Local reality check (dogfood machine, 2026-07-14)

Measured on the operator's machine to ground the landscape claims. Rounded.

| Surface | Volume | Character |
| --- | --- | --- |
| Claude Code transcripts | ~460 MB, ~860 session files, 40 projects, 4 months deep | Complete replayable transcripts, unindexed at the source |
| Codex rollout sessions | ~3.7 GB, ~200 files | Complete replayable transcripts, no local index beyond a session index file |
| atrib signed-record mirrors | ~155 MB, ~57k records across per-producer files | Signed records with full sidecar content; indexed by recall (BM25 + durable index) |
| atrib instrumentation state | ~340 MB of jsonl | Derived telemetry (decision-guidance fires, skill routing, read-primitive calls); span-log shaped, no message bodies |
| claude-mem | ~690 MB SQLite + ~1.4 GB vector store | Derived observations and summaries over ~1,850 Claude Code sessions with FTS5 and semantic search; a live watcher ingests new transcripts |
| OpenClaw | Transcript tables empty | Capture schema present, not active |
| OTel export | None configured | The only telemetry egress is atrib's own log endpoint plus an optional trace-UI connector for atrib records |

Three observations follow. First, the raw-transcript pool (~4.2 GB) is an
order of magnitude larger than the signed-record pool (~155 MB), and the
signed pool is the only one atrib can search today. Second, the operator
already runs a semantic index over Claude Code traces (claude-mem), which
demonstrates the demand
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)
routes to composition; what it lacks is any
verifiable tie between its derived observations and the signed substrate.
Third, none of the transcript surfaces has an active retention policy, so the
durability risk is real but not acute on this machine. The acute gaps are
unification and search.

## 7. Gaps

| # | Gap | Who fills it today | atrib fit |
| --- | --- | --- | --- |
| G1 | Cross-harness inventory and unification of transcripts | Nobody locally; Hugging Face buckets remotely | Adapter surface (Pattern #5 family), not protocol |
| G2 | Durability against retention/purge | Manual archival, buckets | Manifest signed before purge gives survivable commitments even when bodies expire; archive layer ([§2.12](../atrib-spec.md#212-record-body-archive-layer)) can hold opted-in bodies |
| G3 | Verifiable binding: transcript window to signed actions to PR | Nobody | Exactly [D121](../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows); missing only the transcript-format adapter |
| G4 | Search over transcript content | claude-mem (one harness), hosted platforms | Out of scope for signed recall today; a deliberate new decision if ever in scope (see O4) |
| G5 | Semantic mapping / clustering | claude-mem vectors, hosted platforms | Deferred "Layer 2" everywhere in the repo; orthogonal to traces |
| G6 | Trust of shared/published traces | Nobody (HF explicitly silent) | Manifest + counterparty attestation ([D150](../DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first)) are the primitives a trusted-trace-exchange story would use |

## 8. Decision candidates

Proposals for discussion, ordered by fit. None is accepted by this document.

**O2 (recommended, shipped 2026-07-14 as
[D163](../DECISIONS.md#d163-session-transcript-runtime-log-source-binds-harness-transcripts-to-signed-records)
with O3's refs included; see
[packages/integration/examples/session-transcript-runtime-log/](../packages/integration/examples/session-transcript-runtime-log/)):
session-transcript runtime-log source adapter.** A
`RuntimeLogSource` for Claude-Code-style session JSONL (which covers Claude
Code and Codex directly and the Session Traces Format by construction), plus
an integration example that manifests a real session window, binds the signed
records produced inside it via side-effect receipts, and verifies offline.
This is the activegraph-runtime-log shape pointed at the de facto transcript
format. It closes G3, gives G2 its commitment-before-purge answer, and makes
the Hugging Face "PR links to its trace" use case verifiable rather than
aspirational. Small surface: one adapter, one example, no spec change, no new
event_type ([D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
bar untouched).

**O3 (natural extension of O2): manifest refs into archive or bucket.** The
manifest already carries optional archive refs and URIs. Writing the
transcript's storage location (archive-node body, bucket URI) into the
manifest refs, and optionally submitting redacted bodies to the archive layer,
turns "the trace existed" into "the trace is retrievable and its bytes match
the root." No new object; exercises existing fields.

**O4 (hold for an explicit ADR): transcript content as a recall corpus.**
Letting content recall (`recall` shape `content`; legacy `recall_by_content`) search raw transcript content would cross two
standing boundaries at once: the unit of indexing (one signed record's sidecar,
[D086](../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content)) and the
substrate's scope (what the agent signed, not everything the host recorded).
There is a coherent version of it: chunk a manifested window into index-only
entries that carry the manifest hash as provenance, so search results remain
traceable to a verified window. That design deserves its own decision with
privacy analysis (transcripts hold secrets, per the Hugging Face docs'
first-class warning), and should not ride in on O2.

**O4 resolution (2026-07-14, analyzed and parked as
[P052](../DECISIONS.md#p052-transcript-recall-corpus-stays-composition-first-until-attributed-paraphrase-gap-misses-exist)):**
composition stays the posture. The operator's dogfood machine now runs the
two cheap rungs host-side (continuous transcript-window manifests on
SessionEnd, PreCompact, and a two-harness sweep; signed memory-extraction
receipts linking claude-mem batches to manifest records), which delivers the
verifiable-citation property without atrib owning transcript retrieval. The
measured baseline from read-primitive instrumentation: 10% of content-recall
calls return zero results (253 of 2,455), but nothing yet attributes those to
paraphrase gaps over transcript-resident content, which is the evidence the
decision needs. P052 carries the trigger conditions.

**O5 (defer, unchanged): semantic/vector layer.** Already deferred as the
recall "Layer 2" sidecar. The traces question adds demand evidence (the
operator runs claude-mem's vector store today) but no new reason to change
the ordering: lexical recall over signed records first, vectors when the
corpus and eval evidence justify them.

**O1 (posture, keep): no viewer, no storage product.** The
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)
rejection stands. Buckets, trace viewers, and observability dashboards exist
and improve; atrib binds, verifies, and recalls what was signed.

## 9. Sources

External (verified 2026-07-14):

- https://huggingface.co/docs/hub/agent-traces
- https://huggingface.co/changelog/agent-trace-viewer
- https://huggingface.co/blog/huggingface/agent-traces-as-memory
- https://huggingface.co/datasets/trace-commons/agent-traces
- https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-claude-code
- https://code.claude.com/docs/en/monitoring-usage
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/

Internal: [DECISIONS.md](../DECISIONS.md) (the decisions and pending entries
linked inline above), [ARCHITECTURE.md](../ARCHITECTURE.md) (Observability
Boundary, Runtime log boundary), [atrib-spec.md](../atrib-spec.md) (the trace,
chain, archive, and runtime-integration sections linked inline above),
[packages/runtime-log/](../packages/runtime-log/),
[packages/openinference/](../packages/openinference/),
[services/atrib-recall/](../services/atrib-recall/),
[services/atrib-trace/](../services/atrib-trace/),
[spec/conformance/runtime-log/](../spec/conformance/runtime-log/).
