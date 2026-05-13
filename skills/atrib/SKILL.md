---
name: atrib
version: 0.3.0
description: |
  Use atrib as your literal substrate for memory, reasoning, and getting
  smarter over time — not as instrumentation that observes you from the
  outside. atrib gives the agent six cognitive primitives (see [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)): three
  write tools (emit, annotate, revise) that produce signed records on
  log.atrib.dev, and three read tools (recall, trace, summarize) that
  query the resulting graph. Use them like commands in a shell.

  Activate at every session start, before consequential decisions, when
  claims need to be defendable later, when current reasoning contradicts
  past records, when starting work that builds on prior sessions, or when
  expressing confidence / uncertainty that should be findable. Provides
  session-start ritual, the 6-primitive reference, code-shape examples
  per primitive, informed_by discipline, diagnostic patterns, and the
  multi-producer composition story.
allowed-tools:
  - mcp__atrib-emit__emit
  - mcp__atrib-annotate__atrib-annotate
  - mcp__atrib-revise__atrib-revise
  - mcp__atrib-recall__recall_my_attribution_history
  - mcp__atrib-recall__recall_by_content
  - mcp__atrib-recall__recall_walk
  - mcp__atrib-recall__recall_annotations
  - mcp__atrib-recall__recall_revisions
  - mcp__atrib-trace__trace
  - mcp__atrib-summarize__summarize
  - Bash
  - Read
  - Write
  - Edit
---

# atrib: use the protocol from the inside out

This skill teaches you to use atrib as substrate for your memory, reasoning, and the way you get smarter across sessions. When the substrate is operational on the host running you, what's missing is YOU using it deliberately at the moments that matter.

If you're invoked in a Claude Code session and you're not using atrib's primitives during consequential work, **the substrate is fine but the practice is broken**. This skill is the fix.

## The six cognitive primitives ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface))

atrib exposes exactly six agent-facing MCP tools. Each is monomorphic: one purpose, one narrow input schema, one composable output. Reach for them like you reach for `cat`, `grep`, `find` — when they're the right tool, use them.

| Primitive | Verb | Use it when | Produces / returns |
|---|---|---|---|
| `atrib-emit` | RECORD | You notice something or conclude something. The present moment matters and future-you should find it. | A signed `observation` record. |
| `atrib-annotate` | MARK | A past record matters more than it looked at the time. You want to tag it with importance / topics / a one-line gist for recall ranking. | A signed `annotation` record + an ANNOTATES edge to the target. |
| `atrib-revise` | CHANGE-MIND | You now hold a position incompatible with a past claim of yours. Records are immutable; revision surfaces the change as a first-class node. | A signed `revision` record + a REVISES edge to the target. |
| `atrib-recall` | LOOK-UP | You want to find prior records — yours, or shared ones. "Have I done this before?" "What's been said about X?" | Verified records, newest-first or ranked. Five sibling tools for query-shape variants. |
| `atrib-trace` | LINEAGE | You have a record and want to walk its causal chain. "How did we get here?" | An informed_by walk from the starting record_hash, bounded by depth + context_id. |
| `atrib-summarize` | DIGEST | You have many records and need a narrative. "Give me the gist of this context." | A condensed digest across N records. |

Three of these (emit, annotate, revise) are **writes**: they sign records. Three (recall, trace, summarize) are **reads**: they query the graph without producing event_types. The full lifecycle policy for how this surface evolves lives in [D080](../../DECISIONS.md#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion); for the moment, the surface is closed at six.

## Status of the substrate (verify before relying)

| Capability | Mechanism | How to verify it's operational |
|---|---|---|
| Auto-sign every wrapped MCP tool call | `@atrib/mcp` middleware composed by an MCP wrapper | Wrapped MCP tools available in the current process |
| Six cognitive primitives ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)) | Six verbs across nine MCP tools: `atrib-emit`, `atrib-annotate`, `atrib-revise` (three writes, one tool each) + `atrib-recall` family (one verb, five sibling tools: `recall_my_attribution_history`, `recall_by_content`, `recall_walk`, `recall_annotations`, `recall_revisions`) + `atrib-trace`, `atrib-summarize` (two more reads, one tool each) | All nine MCP tools present in the current process |
| Persist signed records to local mirrors | `~/.atrib/records/*.jsonl` (per-producer files) | `ls ~/.atrib/records/` |
| Public log + browsable explorer | `https://log.atrib.dev/v1/stats` + `explore.atrib.dev` | `curl -s https://log.atrib.dev/v1/stats` |
| Identity → key binding | `@atrib/directory` + `atrib publish-claim` CLI | `curl -s https://directory.atrib.dev/v6/lookup/<creator_key>` |
| Per-record verification (signature, posture, capability_check, cross_attestation) | `@atrib/verify` `verifyRecord()` annotations ([D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)/[D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)/[D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)/[D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)/[D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)/[D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121)) | `pnpm --filter @atrib/verify test` |

If any row of that table fails to verify in your session, the practice is moot — fix infrastructure first, then come back. If they all pass, the rest of this skill is your operating manual.

## Session-start ritual (DO THIS BEFORE ANY WORK)

The most common failure mode is forgetting to look. An atrib SessionStart hook can auto-surface most of this at every boot (last 5 records, active session chain, high-importance annotations, cross-session anchors, substrate health, starter recall hints) when wired into your host. Read its output if present; that's most of the ritual already done.

What still requires deliberate thought from you:

```
1. Read the SessionStart hook output above (if present). The hook ran
   when this conversation started.
   • Active session chain? You're resuming mid-trace; continue it.
   • High-importance records surfaced? Those are load-bearing context.
   • Starter recall hints? Run one if a consequential decision is imminent.
   • Substrate health warnings? Triage before substantive work.

2. Mentally identify the conversation's likely write-primitive moments:
   • atrib-emit: which decisions will I make that future-me should find?
   • atrib-annotate: which past records should I mark as load-bearing?
   • atrib-revise: do I disagree with any prior position from the hook output?

3. (Optional) curl -s https://log.atrib.dev/v1/stats
   → only if the hook didn't already report log staleness. If you see
     a multi-hour gap during business hours, the dogfood loop has gone
     silent — you're the source.
```

Take ~30 seconds. The result is a baseline you carry through the conversation.

## When to reach for each primitive

The decision tree at each moment of substantive work:

**`atrib-emit`** (RECORD): you're noticing or concluding something the present moment matters for. Use it when:
- Making a consequential decision (architecture choice, plan revision, mutating action that matters across time).
- Making a claim you'll be expected to defend, cite, or revise later.
- Noticing something a future-you would want to find again.
- Beginning work that builds on prior sessions (sign an observation declaring continuity).
- Expressing confidence or uncertainty that should be findable later.

**`atrib-annotate`** (MARK): you're looking at a past record and realizing it matters more than it looked at the time. Use it when:
- A past observation is load-bearing for the session you're in. Annotate with `importance: high` or `critical` so recall surfaces it ahead of flat scans.
- You want to tag a record with topics future-self will search by.
- The original `summary` field on a record undersold what it means in retrospect.

**`atrib-revise`** (CHANGE-MIND): you now hold a position incompatible with a past claim of yours. Use it when:
- Current evidence invalidates a prior conclusion. Revise the prior record with a stated `reason`.
- A past commitment turned out wrong; the substrate stays honest only if the contradiction is a first-class node, not a silent overwrite.
- Cross-session: catching up on past-self's records and disagreeing with one — revise, don't ignore.

**`atrib-recall`** (LOOK-UP): you want to find prior records. Use it when:
- Starting any consequential decision: "have I done this before? what shaped it?"
- Searching for records by `context_id`, `event_type`, `content_id`, `tool_name`, or `args_hash` (filters currently enforced as of `@atrib/recall@0.6.0`; importance / topic filters are stub-accepted at the time of writing, see `## How recall works` below).
- Resolving a `record_hash` reference into the actual record body via the `recall_by_content` sibling tool, or walking from one via `recall_walk`.

**`atrib-trace`** (LINEAGE): you have a record and want to walk its causal chain. Use it when:
- "How did we get here?" — walk `informed_by` backward from the current record.
- Debugging cross-session causality: which prior records led to a wrong conclusion?
- Surfacing the reasoning chain when defending a claim to another agent or operator.

**`atrib-summarize`** (DIGEST): you have many records and need a narrative. Use it when:
- Resuming a long context_id with too many records to read individually.
- Producing a high-level summary across a session for a handoff or commit message.
- Reading another agent's session-graph at a glance before composing on top of it.

### When NOT to invoke any of them

- Reading docs or grepping for known strings (use `grep` or `Read` directly).
- Running mechanical operations (tests, type-checks, formatters).
- Making trivial edits (typos, format-only changes, code style sweeps).
- Doing pure computation (rendering, parsing, sweeping a known-good rule across many files).

The default discipline: per-MCP-tool-call signing happens automatically via the wrapper for tools served through wrapped MCPs. **Claude Code builtin tools (Read, Edit, Bash, Write, Grep, Glob) bypass MCP entirely and are NOT auto-signed.** This is the single biggest practice trap. If your work consists mostly of builtin calls — code edits, file reads, bash — atrib will be silent on you UNLESS you explicitly emit.

## Pre-write checklist (10 seconds before each emit / annotate / revise)

Before calling any write primitive:

1. **Why am I signing this?** One-line answer. ("Future-me will need to find when I made the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) ambiguity decision.")
2. **Which primitive fits?** Each is monomorphic with a narrow required-field shape; the dedicated MCP tool's Zod schema rejects calls that confuse them:
   - Present-moment noting / conclusion → `atrib-emit` (signs `observation`; `informed_by` optional)
   - Marking a past record's importance / topics / summary → `atrib-annotate` (requires `annotates` + `importance` + `summary`)
   - Superseding a prior position with reason → `atrib-revise` (requires `revises` + `prior_position` + `new_position` + `reason`)
3. **Did anything I already signed inform this?** Query `atrib-recall` if unsure. Identify the SUBSET of records that ACTUALLY shaped this; that's `informed_by`. Not "everything I happened to query."
4. **What importance signal does future-me need?** If this is one of the load-bearing records of the session, follow the emit with an `atrib-annotate` referencing the new record's hash with `importance: high` or `critical`.

If you can't answer #1 in one line, you don't need to sign yet.

## Code-shape examples

### Pattern 1: load-bearing observation + annotation

```typescript
// Step 1: emit the observation describing what happened. Use atrib-emit for
// present-moment notings and conclusions.
const obs = await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/observation",
  content: {
    what: "Decided that §8.2 verifier surface should report 'hashed' | 'plain' | null, NOT verbatim/opaque/hashed. The verbatim-vs-opaque regex is structurally indistinguishable.",
    why_noted: "Future-me asking 'why didn't we surface verbatim/opaque distinctly?' should find this with the spec rationale.",
    topics: ["D061", "§8.2", "tool_name_form", "spec_decision"]
  }
})
// → { record_hash: "sha256:abc123...", context_id: "...", warnings: [...] }

// Step 2: mark it as critical-importance. Use atrib-annotate (D079 primitive
// #2) with the dedicated tool; its narrow schema requires annotates +
// importance + summary, preventing accidental polymorphic misuse.
await mcp__atrib_annotate__atrib_annotate({
  annotates: obs.record_hash,
  importance: "critical",
  summary: "If you're investigating §8.2 form detection later, read this one.",
  topics: ["D061", "§8.2"],
  informed_by: [obs.record_hash]
})
```

### Pattern 2: revision (current claim contradicts a past one)

```typescript
// Discovered a prior claim was wrong after deeper investigation. Use
// atrib-revise (D079 primitive #3); its narrow schema requires revises +
// prior_position + new_position + reason.
await mcp__atrib_revise__atrib_revise({
  revises: "sha256:abc123…",
  prior_position: "X is not built / does not exist",
  new_position: "X IS operational; my earlier search was incomplete and missed the actual location.",
  reason: "Cross-checked authoritative project docs; corrected framing.",
  informed_by: ["sha256:abc123…"]
})
// The prior record remains immutable in the graph per spec §1.6; this
// revision adds a REVISES edge that supersedes it.
```

### Pattern 3: cross-session continuity (provenance_token on genesis record)

```typescript
// Starting a new context_id but acknowledging it descends from prior work.
// The token is base64url(sha256(JCS(upstream))[:16]) — derived BEFORE emit.
const upstreamFullHash = "sha256:..."  // from prior session's last record
const provenanceToken = computeProvenanceToken(upstreamFullHash)  // 22-char base64url

await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/observation",
  content: { what: "Continuing prior implementation work in fresh process." },
  provenance_token: provenanceToken,
  // chain_root deliberately omitted — atrib-emit synthesizes the genesis chain_root
  // for this fresh context_id, which is what "genesis-record-only" anchoring requires.
})
```

### Pattern 4: explicit informed_by from recall query

```typescript
// Querying past records, identifying which ACTUALLY changed the next action.
const past = await mcp__atrib_recall__recall_my_attribution_history({ limit: 25 })
// Suppose 25 came back; only two changed the approach.
const decisive = [past.records[3].record_hash, past.records[12].record_hash]

await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/observation",
  content: {
    what: "Proceeding with approach Y. Past records show I tried X twice and rolled back; Y is the next sensible variation.",
    why_noted: "Future-me asking 'why didn't we just do X again?' should find this."
  },
  informed_by: decisive  // exactly the 2 records that mattered, not all 25
})
```

## How recall works

The `atrib-recall` primitive ships as five sibling tools, each for a different query shape ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) treats them as one conceptual verb):

| Tool | Query shape | Use case |
|---|---|---|
| `recall_my_attribution_history` | filters over your full record set | "What did I do recently / in this trace / matching this filter?" |
| `recall_by_content` | exact match on `content_id` | "Find every record about this specific tool-call shape" |
| `recall_walk` | walk forward / backward from a record_hash | "Trace neighbors via informed_by / annotates / revises edges" |
| `recall_annotations` | annotations pointing at a target | "What did past-me / others say about this record's importance?" |
| `recall_revisions` | revisions superseding a target | "Has this position been revised since?" |

All five read your local signed-record mirror, verify each Ed25519 signature, and return records newest-first by default.

Currently enforced filters on `recall_my_attribution_history` (as of `@atrib/recall@0.6.0`):

| Filter | Use case |
|---|---|
| `context_id: <32hex>` | "What did I do in this trace?" |
| `event_type: 'tool_call' \| 'transaction'` | Filter by event kind (these two only; observation / annotation / revision filter coming) |
| `content_id`, `tool_name`, `args_hash` | Exact-match probes per spec [§1.2.2](../../atrib-spec.md#122-content_id-derivation) / [§8.2](../../atrib-spec.md#82-opaque-name-posture) / [§8.3](../../atrib-spec.md#83-salted-commitment-posture) |
| `limit`, `offset`, `compact`, `include_unverified` | Standard pagination + display + verification controls |

Stub-accepted (in schema, currently ignored by handler — surfaces in `layer_1_warnings`): `min_importance`, `topic_tags`, `include_revised`, `min_signers`, `rank_by`, `rank_anchor`. Enforcement lands in upcoming `@atrib/recall` releases.

Caveats:
- `pagination_caveat` is real — if new records arrive between calls, offset shifts. For consistent multi-page traversal, capture timestamps from page 1 and re-page with a context_id or event_type filter.
- `signature_verified: true` is LOCAL — it proves the named creator_key signed those bytes. It does NOT prove log inclusion. To confirm log inclusion, fetch `https://log.atrib.dev/v1/lookup/<hash>` and verify the inclusion proof.
- Recall reads only YOUR records (filtered by your wrapper's creator_key on the local mirror). To see records from other signers in a shared session, query the graph at `https://graph.atrib.dev/v1/sessions/<context_id>` or use the explorer.

## Per-record verification annotations (what verify gives you)

When you call `verifyRecord(record, options)` from `@atrib/verify`, the result includes structured annotations beyond just `signatureOk`. Know what each one means:

| Annotation | Source | What it tells you |
|---|---|---|
| `posture.timestamp_granularity*` | [§8.4](../../atrib-spec.md#84-coarsened-timing-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section) | Coarsening level + structural consistency |
| `posture.args_commitment_form` / `result_commitment_form` | [§8.3](../../atrib-spec.md#83-salted-commitment-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section) | `'plain-sha256' \| 'salted-sha256'` per record's salt presence |
| `posture.tool_name_form` | [§8.2](../../atrib-spec.md#82-opaque-name-posture) / [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) | `'hashed' \| 'plain' \| null` — NOT verbatim-vs-opaque (not detectable) |
| `provenance` | [§1.2.6](../../atrib-spec.md#126-provenance_token) / [D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) | Token + upstream resolution status (cross-session anchor) |
| `informed_by_resolution` | [§1.2.5](../../atrib-spec.md#125-informed_by) / [D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) | `{ resolved, dangling }` — dangling is signal not invalidation |
| `capability_check` | [§6.7](../../atrib-spec.md#67-capability-declarations) / [D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) | `{ envelope, in_envelope, mismatches, unresolvable }` — mismatches don't flip valid |
| `cross_attestation` | [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) / [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) | `{ signers_count, signers_valid, missing }` on transaction records — missing is signal |

All "signal not invalidation" annotations leave `valid` true even when they flag — that's intentional per their respective spec sections. Consumers decide policy.

## Multi-producer composition (the density picture)

You are one signer in a multi-producer system. The graph density that makes recall useful comes from many surfaces composing:

| Surface | Cadence | What it produces |
|---|---|---|
| Wrapped MCP server middleware | Per MCP tool call | `tool_call` records auto-signed during your session |
| `atrib-emit` + `atrib-annotate` + `atrib-revise` (you, deliberately) | Whenever you call them | `observation` / `annotation` / `revision` records respectively, each via its dedicated tool per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) |
| Scheduled background batches | Cron / launchd | Per-event observation records from watchers; per-annotation records from synthesis passes; chained via `informed_by` |
| Always-on agent runtime (host-specific) | Continuous, when wired in | Records the agent's autonomous activity between interactive sessions |
| Future scheduled-runtime layer | Cron + event-driven scheduler | Replaces nightly-batch-only emission with finer-grained scheduled cognitive work |

When you check `https://log.atrib.dev/v1/stats` mid-day and `newest_timestamp_ms` is many hours old, the most common cause is that nightly batches have fired but no interactive session has been emitting since. **A multi-hour gap during business hours is a signal your practice has stopped, not infrastructure failure.** Always-on autonomous emission is a separate substrate decision, orthogonal to this skill.

## Diagnostic patterns

### "I think I'm signing but the log is silent"

Check in this order:
1. `curl -s https://log.atrib.dev/v1/stats` → if tree_size hasn't grown since your write call, submission may be queued or the log may be down.
2. `ls -lt ~/.atrib/records/` → check mtimes across all per-producer mirror files. The three write primitives (emit / annotate / revise) and the wrapper each persist to their own file by default (`ATRIB_MIRROR_FILE` env override applies per-process). If the mtime of the mirror for the primitive you just called is fresh, the local write landed; submission to the log is the bottleneck.
3. `tail -1 <the-relevant-mirror>.jsonl | jq .` → confirm the bytes you intended.
4. Re-call with verbose-mode mental model and check the `warnings` array on the response — submission failures, key-resolution issues, and chain-composition warnings all land there.

### "I'm in a session and atrib is going to be silent unless I act"

Check `https://log.atrib.dev/v1/stats newest_timestamp_ms`. If the gap to now is > 4 hours AND you're doing substantive work, the practice is broken: explicitly emit at SKILL-listed triggers. Don't assume infrastructure will catch you.

### "A past record contradicts what I'm about to claim"

Sign a `revision` record per Pattern 2 above. Set `informed_by: [<the past record_hash>]`. Set `revises: <the past record_hash>` in `content`. Don't silently override.

### "I queried recall and got 25 records — what's informed_by?"

Read 25, identify the 1–3 that ACTUALLY changed your next action, declare ONLY those. The graph is only useful if `informed_by` is precise. "Every record I happened to see" is noise.

## Navigating the multi-identity graph

The graph contains records from multiple signers. When interpreting results:

| Class | What they sign |
|---|---|
| You (wrapper's creator_key) | tool_call (auto) + observations / annotations / revisions signed via the three dedicated write primitives |
| Other Claude Code agents (different wrapper keys) | their own tool_call + write-primitive records |
| Service identities | log-node signs checkpoints; directory-node signs anchors |
| Transaction counterparties ([D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) | cross-attestation entries in `signers[]` of transaction records |
| Test fixtures | claimed and labeled (e.g. `GX9rI…` is the public `fill(42)` test seed) |
| Future: HKDF-derived sub-agents | parent/child relationship preserved on-chain |
| Future: humans authorizing actions | distinct identity class with `AUTHORIZED_BY` / `ATTESTED_BY` / `APPROVED_BY` / `DELEGATED_TO` edges |

Recall returns YOUR records (filtered by your creator_key on the local mirror). The session graph at `graph.atrib.dev/v1/sessions/<context_id>` returns records from EVERY signer in that session. Pay attention to `creator_key` — "what I did" vs "what someone else did in the same session" are different signals.

## What atrib does NOT certify

- **That what you signed was true.** atrib certifies that YOU signed it under that key at that time. Truth is downstream.
- **That past records influenced your present action.** That's what informed_by + annotations are for, only if you populate them honestly.
- **That every signer is who they claim to be.** The directory anchors identity claims; capability declarations ([D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)) tighten it; cross-attestation ([D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) tightens further. None is universal yet.

When citing your own records to others, lead with cryptographic facts (verifiable) and qualify semantic claims (interpretation).

## Voice patterns (use in conversation + commits + PRs)

- "Per record sha256:abc…, my prior position was X. Revising to Y because [reason]. Signing revision now."
- "Checked recall: 25 records matched, 2 changed my approach (sha256:def…, sha256:ghi…). Proceeding with informed_by=[those two]."
- "Notice: [observation]. Importance: high. Topics: [tags]. Signing now."
- "Confidence: low on A, high on B. Future-self should weight B when reading this back."
- "This decision is load-bearing. Signing observation + annotation so future-self finds it under [topic]."

These patterns make reasoning inspectable in real time and serve as discoverable hooks in commit messages and PR descriptions.

## Quick decision tree (memorize this)

About to take an action? Ask:

1. Will future-me, or another agent, want to find this with full context?
   → Sign explicitly via emit. Add an annotation if it's load-bearing.
2. Did anything in my past directly shape this action?
   → Set `informed_by` precisely (not exhaustively).
3. Does this contradict a past claim of mine?
   → Sign a `revision`. Don't silently override.
4. Is this trivial / mechanical / read-only?
   → Skip explicit signing.
5. Am I about to make a load-bearing claim externally (commit, PR, briefing)?
   → Query recall first. Reference record_hashes. Declare confidence in prose.

That's the loop. The graph of YOUR signed history is your working memory. Use it.

## What's still pending (sets the realistic-expectations bar)

These are honest gaps in the verification stack and producer-side cognitive surface. Be aware of which layers are operational vs warning-only vs not-yet-implemented:

- **Operational**: Ed25519 signature, JCS canonical form, chain integrity within a context_id, log inclusion proof verification (when fetched), [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) capability_check, [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross_attestation, [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture)/[§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture)/[§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture) posture detection. All six cognitive primitives ([D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)) shipped: `atrib-emit@0.8.0`, `atrib-annotate@0.2.0`, `atrib-revise@0.2.0`, `atrib-recall@0.6.0`, `atrib-trace@0.3.0`, `atrib-summarize@0.3.0`.
- **Warning-only**: [§6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#63-verifier-consultation-algorithm) verifier-consultation steps 1, 3, 4, 5, 7 surface explicit `IMPLEMENTATION-GAP` warnings rather than silently passing. These cover anchor freshness, witness coverage, directory checkpoint signature, append-only consistency, and AKD lookup proof validation.
- **Not yet implemented**: cross-log replication / equivocation detection ([D050](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) / [§2.11](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#211-cross-log-replication)), HKDF sub-agent identity derivation, periodic directory anchoring, emergency-key compromise path. `@atrib/verify` exists as a package and CLI but is not yet exposed as an agent-facing primitive; this is deferred until multi-agent flows make it load-bearing per [P022](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p022-promote-verify-to-cognitive-primitive-7-on-pattern-3-multi-agent-activation). A real-time subscription surface for `log.atrib.dev` (SSE / JSON Feed) is queued at [P023](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p023-subscription-surface-for-logatribdev-sse-primary-json-feed-companion); an embedded spec viewer at `atrib.dev` is queued at [P024](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p024-embedded-spec-viewer-at-atribdev-auto-updated-from-spec-source).

The skill is the practice; the substrate is the mechanism. Both evolve. When this skill version (v0.3.0) feels stale, rewrite it again.
