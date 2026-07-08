---
name: atrib
version: 0.4.0
description: |
  Use atrib as the verifiable substrate for memory, reasoning, and getting
  sharper over time, not as instrumentation that observes you from the
  outside. atrib gives the agent seven cognitive primitives (see [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) and [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)): three
  write tools (emit, annotate, revise) that produce signed records on
  log.atrib.dev, and four read tools (recall, trace, summarize, verify)
  that query the resulting graph or check supplied evidence. Use them like
  commands in a shell.

  Activate at every session start, before consequential decisions, when
  claims need to be defendable later, when current reasoning contradicts
  past records, when starting work that builds on prior sessions, or when
  expressing confidence / uncertainty that should be findable. Provides
  session-start ritual, the 7-primitive reference, code-shape examples
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
  - mcp__atrib-recall__recall_session_chain
  - mcp__atrib-recall__recall_orphans
  - mcp__atrib-recall__recall_by_signer
  - mcp__atrib-trace__trace
  - mcp__atrib-trace__trace_forward
  - mcp__atrib-summarize__summarize
  - mcp__atrib-verify__atrib-verify
  - Bash
  - Read
  - Write
  - Edit
---

# atrib: use the protocol from the inside out

This skill teaches you to use atrib as the substrate for your memory, reasoning, and continuity across sessions. When the substrate is operational on the host running you, the missing piece is deliberate use at the moments that matter.

If your host exposes atrib primitives and you do not use them during consequential work, **the substrate is fine but the practice is broken**. This skill is the fix.

The cognitive primitives let an agent participate directly in verifiable agent actions. Use them to record what matters, mark important past records, revise claims that changed, and verify incoming context before building on it.

## The seven cognitive primitives ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7))

atrib exposes seven agent-facing primitives. Each is monomorphic: one purpose, one narrow input schema, one composable output. Reach for them like you reach for `cat`, `grep`, or `find`: when they are the right tool, use them.

| Primitive         | Verb            | Use it when                                                                                                                                                                                                                | Produces / returns                                                                      |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `atrib-emit`      | RECORD          | You notice something or conclude something. The present moment matters and future-you should find it.                                                                                                                      | A signed `observation` record.                                                          |
| `atrib-annotate`  | MARK            | A past record matters more than it looked at the time. You want to tag it with importance / topics / a one-line gist for recall ranking.                                                                                   | A signed `annotation` record + an ANNOTATES edge to the target.                         |
| `atrib-revise`    | CHANGE-MIND     | You now hold a position incompatible with a past claim of yours. Records are immutable; revision surfaces the change as a first-class node.                                                                                | A signed `revision` record + a REVISES edge to the target.                              |
| `atrib-recall`    | LOOK-UP         | You want to find prior records, yours, or shared ones. "Have I done this before?" "What's been said about X?"                                                                                                              | Verified records, newest-first or ranked. Eight sibling tools for query-shape variants. |
| `atrib-trace`     | LINEAGE         | You have a record and want to walk its causal chain. "How did we get here?" "What built on this later?"                                                                                                                    | Forward or backward graph walks from a starting record_hash, bounded by depth.          |
| `atrib-summarize` | DIGEST          | You have many records and need a narrative. "Give me the gist of this context."                                                                                                                                            | A condensed digest across N records.                                                    |
| `atrib-verify`    | ACCEPT / REJECT | Another agent, harness, merchant, or archive gives you a packet and asks you to build on it. You need to check record signatures, body commitment, proof, signer trust, context policy, and freshness before linking work. | Accepted record hashes for `informed_by`, plus explicit rejection reasons.              |

Three of these (emit, annotate, revise) are **writes**: they sign records. Four (recall, trace, summarize, verify) are **reads**: they query the graph or check supplied evidence without producing event_types. The full lifecycle policy for how this surface evolves lives in [D080](../../DECISIONS.md#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion). [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7) promoted verify only after two independent Pattern 3 receiving flows made verify-before-linking routine.

## Status of the substrate (verify before relying)

| Capability                                                                                                                                                                                               | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | How to verify it's operational                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Auto-sign every wrapped MCP tool call                                                                                                                                                                    | `@atrib/mcp` middleware composed by an MCP wrapper                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Wrapped MCP tools available in the current process                                   |
| Seven cognitive primitives ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)) | Seven verbs across fifteen physical MCP tools: `atrib-emit`, `atrib-annotate`, `atrib-revise` (three writes, one tool each) + `atrib-recall` family (one verb, eight sibling tools: `recall_my_attribution_history`, `recall_by_content`, `recall_walk`, `recall_annotations`, `recall_revisions`, `recall_session_chain`, `recall_orphans`, `recall_by_signer`) + `atrib-trace` / `trace_forward`, `atrib-summarize`, `atrib-verify`                                                                                                                                        | All fifteen MCP tools present in the current process                                 |
| Persist signed records to local mirrors                                                                                                                                                                  | `~/.atrib/records/*.jsonl` (per-producer files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `ls ~/.atrib/records/`                                                               |
| Public log + browsable explorer                                                                                                                                                                          | `https://log.atrib.dev/v1/stats` + `explore.atrib.dev`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `curl -s https://log.atrib.dev/v1/stats`                                             |
| Identity → key binding                                                                                                                                                                                   | `@atrib/directory` + `atrib publish-claim` CLI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `curl -s https://directory.atrib.dev/v6/lookup/<creator_key>`                        |
| Per-record verification (signature, posture, capability_check, cross_attestation)                                                                                                                        | `@atrib/verify` `verifyRecord()` annotations ([D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)/[D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)/[D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)/[D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)/[D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)/[D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121)) | `pnpm --filter @atrib/verify test`                                                   |
| Operational readiness of this host's signing path (key + log reach + mirror writable)                                                                                                                    | `atrib-emit-cli doctor` ships in [`@atrib/emit@0.13.0`](../../services/atrib-emit/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `atrib-emit-cli doctor --json` (single Bash call; exits 0 when every check is green) |

If any row of that table fails to verify in your session, the practice is moot, fix infrastructure first, then come back. If they all pass, the rest of this skill is your operating manual.

## Session-start ritual (DO THIS BEFORE ANY WORK)

The most common failure mode is forgetting to look. An atrib SessionStart hook can auto-surface most of this at every boot (last 5 records, active session chain, high-importance annotations, cross-session anchors, substrate health, starter recall hints) when wired into your host. Read its output if present; that's most of the ritual already done.

What still requires deliberate thought from you:

```
1. Read the SessionStart hook output above (if present). The hook ran
   when this conversation started.
   • Active session chain? You're resuming mid-trace; continue it.
   • High-importance records surfaced? Those can change your next step.
   • Starter recall hints? Run one if a consequential decision is imminent.
   • Substrate health warnings? Triage before substantive work.

2. Mentally identify the conversation's likely write-primitive moments:
   • atrib-emit: which decisions will I make that future-me should find?
   • atrib-annotate: which past records should I mark as high-priority?
   • atrib-revise: do I disagree with any prior position from the hook output?

3. (Optional) curl -s https://log.atrib.dev/v1/stats
   → only if the hook didn't already report log staleness. If you see
     a multi-hour gap during business hours, the dogfood loop has gone
     silent, you're the source.
```

Take ~30 seconds. The result is a baseline you carry through the conversation.

## Decision-time injections (when your host surfaces prior records inline)

Some hosts wire a PreToolUse hook that scores prior records against the about-to-fire tool input and injects the top matches inline before the tool runs. The injection looks like this:

```
[atrib] about to call <ToolName>. <N> prior signed records share tokens with this action:
  1. [<event_type> score=<N>] sha256:<24-hex>…  <one-line summary>
  2. [<event_type> score=<N>] sha256:<24-hex>…  <one-line summary>
  3. [<event_type> score=<N>] sha256:<24-hex>…  <one-line summary>
```

The injection is raw signal: the host surfaces records that lexically overlap with what you are about to do. It deliberately does NOT prescribe what to do with them. That is your call, and the prescription lives here in the SKILL:

```
1. Read the surfaced records. Take ~5 seconds.
2. For each one, ask: does this bear on the decision I am about to make?
   • If a prior record holds a position incompatible with my current direction
     → STOP. Call atrib-revise with revises=<full-record_hash>, name the prior position,
       name the new one, name the reason. THEN proceed with the tool call (or change it).
   • If I am extending a prior insight and the prior matters more than it looked
     → atrib-annotate with annotates=<full-record_hash>, importance, one-line summary.
       Optional but high-value.
   • If my reasoning produced something genuinely new not in the records above
     → atrib-emit (observation) so future-me finds it.
   • If the surfaced records are not actually relevant (lexical overlap without
     semantic relevance) → proceed with the tool call. The host's scoring is
     lex_count only; false positives are expected at the substrate-minimum baseline.
3. If you saw NO injection, that is also signal: either no prior records share
   tokens with your action (fresh territory) or your host does not wire this
   surface. Both are fine; proceed normally.
```

Why your host might wire this: the cognitive primitives are only useful if you actually invoke them at the right moments. A behavioral hypothesis under empirical test (as of 2026-05-22) is whether record surfacing inline at PreToolUse moves the post-fire cognitive-emit rate above zero. The lex_count scoring is intentionally substrate-minimum (no importance weighting, no recency decay, no semantic match) so the data collected measures whether the IDEA helps, not whether a specific opinion about scoring helps. If you ignore the injection and never reach for emit/annotate/revise after one, you are the negative result. If you read it and react when warranted, you are the positive result. Either outcome is useful; both inform what the next iteration looks like.

### Surfacing does NOT replace active recall

The section above covers what to do WHEN records are surfaced to you. It does not cover what to do when they are not, and the gap matters: a host's PreToolUse hook can only surface records that lexically overlap with a tool's input, and only at the moment a tool is about to fire. Several real cases fall outside that window:

- **Planning or synthesizing between tool calls.** You are deciding the shape of a multi-step approach before any tool fires. No PreToolUse event, no surfacing. Pull your own context with `mcp__atrib-recall__recall_my_attribution_history` filtered by topics or by `context_id`.
- **Walking a specific record's lineage.** You saw a `sha256:<hash>` surfaced in the injection or in the SessionStart block, but you need the ancestry chain, not just the one node. Use `mcp__atrib-trace__trace` from the record_hash.
- **Cross-session deep dives.** "What did past-me think about X across multiple sessions?" The decision-guidance hook only scores against current local mirror records that share tokens with the current tool input. Cross-session memory needs `recall_my_attribution_history` without a `context_id` filter, or `recall_by_content` for content-shape matches. For critical-path audits, call `recall_by_content` with `evidence_mode: "require_complete"` and inspect `runtime` plus `coverage.index` so stale MCP processes and sidecar fallback states are visible.
- **Verifying or expanding a truncated surfaced record.** The injection shows a 24-char hash prefix and ~140-char summary. If you need the full record (creator_key, signature, full content), `recall_walk` from the full record_hash gives you the node and its neighbors. Surfaced summaries are signal, not the record itself.
- **Targeted annotation or revision queries.** `recall_annotations` to find every annotation on a target record (decide whether the existing annotations already cover what you would emit); `recall_revisions` to check whether a position has been revised since you saw it.
- **Resuming a long context_id with many records.** Read individually is overkill; `mcp__atrib-summarize__summarize` produces a digest across N records.

The full read-primitive guidance lives in "When to reach for each primitive" below; this section is a forward-pointer so the active-recall path is not lost in the shadow of the passive-surfacing one. The hook covers the common case; you cover everything else.

## When to reach for each primitive

The decision tree at each moment of substantive work:

**`atrib-emit`** (RECORD): you're noticing or concluding something the present moment matters for. Use it when:

- Making a consequential decision (architecture choice, plan revision, mutating action that matters across time).
- Making a claim you'll be expected to defend, cite, or revise later.
- Noticing something a future-you would want to find again.
- Beginning work that builds on prior sessions (sign an observation declaring continuity).
- Expressing confidence or uncertainty that should be findable later.

**`atrib-annotate`** (MARK): you're looking at a past record and realizing it matters more than it looked at the time. Use it when:

- A past observation directly affects the session you're in. Annotate with `importance: high` or `critical` so recall surfaces it ahead of flat scans.
- You want to tag a record with topics future-self will search by.
- The original `summary` field on a record undersold what it means in retrospect.

**`atrib-revise`** (CHANGE-MIND): you now hold a position incompatible with a past claim of yours. Use it when:

- Current evidence invalidates a prior conclusion. Revise the prior record with a stated `reason`.
- A past commitment turned out wrong; the substrate stays honest only if the contradiction is a first-class node, not a silent overwrite.
- Cross-session: catching up on past-self's records and disagreeing with one, revise, don't ignore.

**`atrib-recall`** (LOOK-UP): you want to find prior records. Use it when:

- Starting any consequential decision: "have I done this before? what shaped it?"
- Searching for records by `context_id`, `creator_key`, `event_type`, `content_id`, `tool_name`, `args_hash`, annotation importance, topic tags, signer count, or rank mode.
- Resolving a `record_hash` reference into its local neighborhood or body through `recall_walk` and related sibling tools.
- Running a critical-path audit where missing evidence would change the answer. Use `recall_by_content({ query, evidence_mode: "require_complete" })`; if it returns `evidence_status: "incomplete"` or `fallback_required: true`, do not use the partial result. Emit an observation naming the incomplete recall and rerun without `max_records` for full loaded-mirror coverage, or run a caller-owned partition plan and treat each partition as its own explicit coverage claim. If the response lacks `runtime.content_index_version` or `coverage.index`, treat the live MCP process as stale relative to [D126](../../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage) and record the propagation gap.

**`atrib-trace`** (LINEAGE): you have a record and want to walk its causal chain. Use it when:

- "How did we get here?", walk `informed_by` backward from the current record.
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

The default discipline depends on which auto-signing layers your host has wired:

- **MCP-wrapper layer (canonical, host-agnostic).** Per-MCP-tool-call signing happens automatically via the `@atrib/mcp` middleware for any tool served through a wrapped MCP. Every host that runs `@atrib/mcp-wrap` (or equivalent) gets this for free.
- **Host-native-tool layer (optional, host-specific).** Some hosts also auto-sign their native tool surface (for example shell, file edits, reads, searches, web fetches, or subagent dispatches) via a post-tool hook that signs each tool call as a `tool_call` record with verb-based importance grading. Whether this layer is wired is up to the host operator. The Claude Code reference implementation lives in `~/.claude/scripts/atrib-tool-signer-hook.mjs`; other hosts can use the same pattern with their own tool names.

Verify which layers are live: read the SessionStart output (it surfaces signed-action counts split by producer). If only the MCP wrapper is wired, builtin-tool work is silent and you MUST emit explicitly to leave a trail. If both layers are wired, builtin tools are auto-signed at low/medium/high importance per verb + path-pattern + exit-code heuristics, and you only reach for the cognitive primitives at decision moments (not for every mechanical edit).

Either way, the cognitive primitives (`atrib-emit` / `atrib-annotate` / `atrib-revise`) are for the WHY (your reasoning, your conclusions, your importance marks). The auto-signing layers are for the WHAT (which tool ran, against which path, with what result).

## Pre-write checklist (10 seconds before each emit / annotate / revise)

Before calling any write primitive:

1. **Why am I signing this?** One-line answer. ("Future-me will need to find when I made the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) ambiguity decision.")
2. **Which primitive fits?** Each is monomorphic with a narrow required-field shape; the dedicated MCP tool's Zod schema rejects calls that confuse them:
   - Present-moment noting / conclusion → `atrib-emit` (signs `observation`; `informed_by` optional)
   - Marking a past record's importance / topics / summary → `atrib-annotate` (requires `annotates` + `importance` + `summary`)
   - Superseding a prior position with reason → `atrib-revise` (requires `revises` + `prior_position` + `new_position` + `reason`)
3. **Did anything I already signed inform this?** Query `atrib-recall` if unsure. Identify the SUBSET of records that ACTUALLY shaped this; that's `informed_by`. Not "everything I happened to query."
4. **What importance signal does future-me need?** If future-me needs this record surfaced, follow the emit with an `atrib-annotate` referencing the new record's hash with `importance: high` or `critical`.

If you can't answer #1 in one line, you don't need to sign yet.

## Code-shape examples

### Pattern 1: Observation + high-priority annotation

```typescript
// Step 1: emit the observation describing what happened. Use atrib-emit for
// present-moment notings and conclusions.
const obs = await mcp__atrib_emit__emit({
  event_type: 'https://atrib.dev/v1/types/observation',
  content: {
    what: "Decided that §8.2 verifier surface should report 'hashed' | 'plain' | null, NOT verbatim/opaque/hashed. The verbatim-vs-opaque regex is structurally indistinguishable.",
    why_noted:
      "Future-me asking 'why didn't we surface verbatim/opaque distinctly?' should find this with the spec rationale.",
    topics: ['D061', '§8.2', 'tool_name_form', 'spec_decision'],
  },
})
// → { record_hash: "sha256:abc123...", context_id: "...", warnings: [...] }

// Step 2: mark it as critical-importance. Use atrib-annotate (D079 primitive
// #2) with the dedicated tool; its narrow schema requires annotates +
// importance + summary, preventing accidental polymorphic misuse.
await mcp__atrib_annotate__atrib_annotate({
  annotates: obs.record_hash,
  importance: 'critical',
  summary: "If you're investigating §8.2 form detection later, read this one.",
  topics: ['D061', '§8.2'],
  informed_by: [obs.record_hash],
})
```

### Pattern 2: revision (current claim contradicts a past one)

```typescript
// Discovered a prior claim was wrong after deeper investigation. Use
// atrib-revise (D079 primitive #3); its narrow schema requires revises +
// prior_position + new_position + reason.
await mcp__atrib_revise__atrib_revise({
  revises: 'sha256:abc123…',
  prior_position: 'X is not built / does not exist',
  new_position:
    'X IS operational; my earlier search was incomplete and missed the actual location.',
  reason: 'Cross-checked authoritative project docs; corrected framing.',
  informed_by: ['sha256:abc123…'],
})
// The prior record remains immutable in the graph per spec §1.6; this
// revision adds a REVISES edge that supersedes it.
```

### Pattern 3: cross-session continuity (provenance_token on genesis record)

```typescript
// Starting a new context_id but acknowledging it descends from prior work.
// The token is base64url(sha256(JCS(upstream))[:16]), derived BEFORE emit.
const upstreamFullHash = 'sha256:...' // from prior session's last record
const provenanceToken = computeProvenanceToken(upstreamFullHash) // 22-char base64url

await mcp__atrib_emit__emit({
  event_type: 'https://atrib.dev/v1/types/observation',
  content: { what: 'Continuing prior implementation work in fresh process.' },
  provenance_token: provenanceToken,
  // chain_root deliberately omitted, atrib-emit synthesizes the genesis chain_root
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
  event_type: 'https://atrib.dev/v1/types/observation',
  content: {
    what: 'Proceeding with approach Y. Past records show I tried X twice and rolled back; Y is the next sensible variation.',
    why_noted: "Future-me asking 'why didn't we just do X again?' should find this.",
  },
  informed_by: decisive, // exactly the 2 records that mattered, not all 25
})
```

## How recall works

The `atrib-recall` primitive ships as eight sibling tools, each for a different query shape ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) treats them as one conceptual verb):

| Tool                            | Query shape                                | Use case                                                         |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `recall_my_attribution_history` | filters over your full record set          | "What did I do recently / in this trace / matching this filter?" |
| `recall_by_content`             | free-form content search                   | "What do I know about this topic across records?"                |
| `recall_walk`                   | walk forward / backward from a record_hash | "Trace neighbors via informed_by / annotates / revises edges"    |
| `recall_annotations`            | annotations pointing at a target           | "What did past-me / others say about this record's importance?"  |
| `recall_revisions`              | revisions superseding a target             | "Has this position been revised since?"                          |
| `recall_session_chain`          | chronological context_id chain             | "What happened in this session?"                                 |
| `recall_orphans`                | records nothing else cites via informed_by | "What did I note and never follow up on?"                        |
| `recall_by_signer`              | aggregate mirror records by creator_key    | "Who else has records in this mirror?"                           |

All eight read your local signed-record mirror, verify each Ed25519 signature, and return records newest-first by default unless the tool shape says otherwise.

`recall_by_content` has two evidence modes:

- `bounded` is the default. It searches the newest `max_records` window so casual recall stays fast. If the corpus is larger, the response carries `evidence_status: "bounded"`, `truncated_corpus: true`, and `total_records: null`.
- `require_complete` is for critical-path audits. It loads the full mirror and searches every loaded record. If a caller sets `max_records` below `total_records`, the response carries `evidence_status: "incomplete"`, `fallback_required: true`, `truncated_corpus: true`, and no results. Treat that as an evidence failure, not as "nothing matched." The MCP result itself is signed in wrapped hosts; emit an observation before taking the deterministic fallback so future-you can find the gap and the retry path. Use `coverage.strategy` to confirm whether the result came from a complete loaded-mirror scan or a bounded newest-first window, and use `coverage.index` to see whether the durable content-token sidecar was hit, rebuilt, disabled, or bypassed.

Filters on `recall_my_attribution_history`:

| Filter                                             | Use case                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context_id: <32hex>`                              | "What did I do in this trace?"                                                                                                                                                                      |
| `creator_key: <base64url>`                         | "Show records from one signer in a shared mirror."                                                                                                                                                  |
| `event_type`                                       | Filter by event kind. Accepts `tool_call`, `transaction`, `observation`, `directory_anchor`, `annotation`, `revision`, or a full event_type URI.                                                    |
| `content_id`, `tool_name`, `args_hash`             | Exact-match probes per spec [§1.2.2](../../atrib-spec.md#122-content_id-derivation) / [§8.2](../../atrib-spec.md#82-opaque-name-posture) / [§8.3](../../atrib-spec.md#83-salted-commitment-posture) |
| `min_importance`, `topic_tags`, `include_revised`  | Annotation / revision-aware filtering. `include_revised=true` hides records superseded by a revision.                                                                                               |
| `min_signers`, `rank_by`, `rank_anchor`, `toc`     | Signer-count threshold, timestamp / relevance / causal-distance ordering, anchor for ranking, and compact table-of-contents output.                                                                 |
| `limit`, `offset`, `compact`, `include_unverified` | Standard pagination + display + verification controls                                                                                                                                               |

Caveats:

- `pagination_caveat` is real, if new records arrive between calls, offset shifts. For consistent multi-page traversal, capture timestamps from page 1 and re-page with a context_id or event_type filter.
- `signature_verified: true` is LOCAL, it proves the named creator_key signed those bytes. It does NOT prove log inclusion. To confirm log inclusion, fetch `https://log.atrib.dev/v1/lookup/<hash>` and verify the inclusion proof.
- Recall reads only YOUR records (filtered by your wrapper's creator_key on the local mirror). To see records from other signers in a shared session, query the graph at `https://graph.atrib.dev/v1/sessions/<context_id>` or use the explorer.

## Per-record verification annotations (what verify gives you)

When you call `verifyRecord(record, options)` from `@atrib/verify`, the result includes structured annotations beyond just `signatureOk`. Know what each one means:

| Annotation                                                | Source                                                                                                                                                                          | What it tells you                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `posture.timestamp_granularity*`                          | [§8.4](../../atrib-spec.md#84-coarsened-timing-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)                                               | Coarsening level + structural consistency                                             |
| `posture.args_commitment_form` / `result_commitment_form` | [§8.3](../../atrib-spec.md#83-salted-commitment-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)                                              | `'plain-sha256' \| 'salted-sha256'` per record's salt presence                        |
| `posture.tool_name_form`                                  | [§8.2](../../atrib-spec.md#82-opaque-name-posture) / [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121)                                          | `'hashed' \| 'plain' \| null`, NOT verbatim-vs-opaque (not detectable)                |
| `provenance`                                              | [§1.2.6](../../atrib-spec.md#126-provenance_token) / [D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)                                  | Token + upstream resolution status (cross-session anchor)                             |
| `informed_by_resolution`                                  | [§1.2.5](../../atrib-spec.md#125-informed_by) / [D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)                                         | `{ resolved, dangling }`, dangling is signal not invalidation                         |
| `capability_check`                                        | [§6.7](../../atrib-spec.md#67-capability-declarations) / [D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)                            | `{ envelope, in_envelope, mismatches, unresolvable }`, mismatches don't flip valid    |
| `cross_attestation`                                       | [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) / [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) | `{ signers_count, signers_valid, missing }` on transaction records, missing is signal |

All "signal not invalidation" annotations leave `valid` true even when they flag, that's intentional per their respective spec sections. Consumers decide policy.

## Handoff verification before informed_by

Use `atrib-verify` when a later action depends on records supplied by another signer, a harness, a merchant, or an archive. Treat acceptance as the gate before you put that record hash into your own `informed_by`.

The input can be a continuation packet, [D062](../../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror envelope, or explicit claim list. Require the trust policy the situation needs: `trusted_creator_keys`, `allowed_context_ids`, `require_body`, `require_body_commitment`, `require_log_inclusion`, `now_ms`, and `max_age_ms`. The primitive returns `accepted_record_hashes` plus rejection reasons such as `missing_body`, `missing_proof`, `wrong_signer`, `wrong_context`, `stale_record`, `future_record`, `body_commitment_mismatch`, and `proof_verification_failed`.

The rule is simple: if you are going to build on another agent's claim, verify first, then link only accepted hashes.

## Orchestration topology: baton-pass and join records ([D142](../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions))

When work moves between agents, two routing events deserve signed records that the graph does not otherwise capture: the decision to hand work to another agent (**baton-pass**) and the decision to accept or reject fan-out results (**join**). Both are conventional `atrib-emit` observation content shapes, not new primitives and not new event types (the [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) boundary test: no new required args, no new graph effect).

**Baton-pass** — sign at handoff, from the sender's key:

```typescript
await mcp__atrib_emit__emit({
  event_type: 'https://atrib.dev/v1/types/observation',
  content: {
    what: 'Handing <work> to <receiver role> for <phase>.',
    baton: {
      target_harness_role: 'relay-executor', // role terms, never internal product names
      target_principal: '<base64url key>',   // optional, when known
      packet_hash: 'sha256:<64-hex>',        // hash of the continuation packet
      reason: 'mechanical self-contained package with executable acceptance gates',
    },
    topics: ['baton-pass'],
  },
  informed_by: [/* the records whose work the packet hands over */],
})
```

The continuation packet itself attaches as the `continuation-packet` evidence-envelope profile ([docs/evidence-profiles/continuation-packet.md](../../docs/evidence-profiles/continuation-packet.md)): the hash and role-term routing facts may be public; the packet body stays private by default. The successor's first signed act is a **receipt**: an observation whose `informed_by` names the baton record and whose content restates the packet hash it received.

**Join** — sign when integrating fan-out results:

```typescript
await mcp__atrib_emit__emit({
  event_type: 'https://atrib.dev/v1/types/observation',
  content: {
    what: 'Joined <N> fan-out results for <task>: <M> accepted, <K> rejected.',
    join: {
      accepted: ['sha256:…', 'sha256:…'],
      rejected: [{ record_hash: 'sha256:…', reason: 'failed adversarial verify' }],
    },
    topics: ['join'],
  },
  informed_by: [/* exactly the accepted record hashes */],
})
```

Discipline for both shapes:

- **Verify before you join.** Results from other signers pass through `atrib-verify` first (previous section); only accepted hashes enter `join.accepted` and `informed_by`. Rejected results are routing facts in content, never influence claims in `informed_by`.
- **Role terms in `baton` facts.** `target_harness_role` uses role vocabulary (`successor-session`, `relay-executor`, `loop-layer`); local tool names belong in the packet body, not in signed content or envelope facts.
- **Authority, when it matters.** For cross-harness or sandboxed receivers, pair the baton with a [§1.11](../../atrib-spec.md#111-delegation-certificates) delegation certificate; the profile's `verified` tier binds `target_principal` to the certificate walk.
- Per-agent model/effort/token-spend accounting on these records is [P051](../../DECISIONS.md#p051-orchestration-infrastructure-dogfood-wiring-with-cost-and-routing-accounting)'s scope, pending, not yet convention.

## Multi-producer composition (the density picture)

You are one signer in a multi-producer system. The graph density that makes recall useful comes from many surfaces composing:

| Surface                                                              | Cadence                       | What it produces                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapped MCP server middleware                                        | Per MCP tool call             | `tool_call` records auto-signed during your session                                                                                                                                            |
| `atrib-emit` + `atrib-annotate` + `atrib-revise` (you, deliberately) | Whenever you call them        | `observation` / `annotation` / `revision` records respectively, each via its dedicated tool per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) |
| Scheduled background batches                                         | Cron / launchd                | Per-event observation records from watchers; per-annotation records from synthesis passes; chained via `informed_by`                                                                           |
| Always-on agent runtime (host-specific)                              | Continuous, when wired in     | Records the agent's autonomous activity between interactive sessions                                                                                                                           |
| Future scheduled-runtime layer                                       | Cron + event-driven scheduler | Replaces nightly-batch-only emission with finer-grained scheduled cognitive work                                                                                                               |

When you check `https://log.atrib.dev/v1/stats` mid-day and `newest_timestamp_ms` is many hours old, the most common cause is that nightly batches have fired but no interactive session has been emitting since. **A multi-hour gap during business hours is a signal your practice has stopped, not infrastructure failure.** Always-on autonomous emission is a separate substrate decision, orthogonal to this skill.

## Closing the dogfood loop

The substrate composes into a closed learning loop. Writes feed reads; reads inform the next decision; that next decision produces more writes. Sketched:

```
WRITES                                         shared state
  • host PostToolUse hook signs tool calls     │
  • host lifecycle / precompact / sessionend         ↓
    hooks emit annotations                     ──► mirror + log.atrib.dev
  • you, deliberately:                            (records keyed by creator + chain + context)
      atrib-emit       (observation)                 │
      atrib-annotate   (mark importance)             │
      atrib-revise     (supersede prior)             ↓
                                                ──► consumed by ──►
READS                                                │
  • host SessionStart hook surface (macro:           │
    active chain, importance, pending work)          │
  • host PreToolUse hook surface (micro:             │
    records sharing tokens with this action)         ↓
  • you, deliberately, for cases hooks                  inform the next decision
    cannot cover (see "Surfacing does NOT
    replace active recall" above):
      atrib-recall family (find prior records)
      atrib-trace      (walk lineage)
      atrib-summarize  (digest N records)
```

The loop closes when reads inform writes that future reads will surface. Each cycle either reinforces a prior position (annotate to bump importance), contradicts one (revise to supersede), or extends the chain (emit a new observation that the next session sees). If you only write and never read, the substrate becomes a write-only log; future-you cannot benefit. If you only read and never write, the corpus stops growing and the chain breaks where the last writer stopped.

A host implementation MAY add a fourth layer, an instrumentation log that records each surfacing decision (what records were available, which the agent followed up on, which were ignored) so the operator can measure whether the loop is closing empirically rather than by intuition. The atrib protocol is silent on this layer; it is a host-side observability concern. If your host wires one, the analyzer typically lives alongside the hook scripts. Run it periodically to see whether your read-after-surface and write-after-read rates are moving where you want them.

## Diagnostic patterns

### "I think I'm signing but the log is silent"

Check in this order:

1. `curl -s https://log.atrib.dev/v1/stats` → if tree_size hasn't grown since your write call, submission may be queued or the log may be down.
2. `ls -lt ~/.atrib/records/` → check mtimes across all per-producer mirror files. The three write primitives (emit / annotate / revise) and the wrapper each persist to their own file by default (`ATRIB_MIRROR_FILE` env override applies per-process). If the mtime of the mirror for the primitive you just called is fresh, the local write landed; submission to the log is the bottleneck.
3. `tail -1 <the-relevant-mirror>.jsonl | jq .` → confirm the bytes you intended.
4. Re-call with verbose-mode mental model and check the `warnings` array on the response, submission failures, key-resolution issues, and chain-composition warnings all land there.

### "I'm in a session and atrib is going to be silent unless I act"

Check `https://log.atrib.dev/v1/stats newest_timestamp_ms`. If the gap to now is > 4 hours AND you're doing substantive work, the practice is broken: explicitly emit at SKILL-listed triggers. Don't assume infrastructure will catch you.

### "A past record contradicts what I'm about to claim"

Sign a `revision` record per Pattern 2 above. Set `informed_by: [<the past record_hash>]`. Set `revises: <the past record_hash>` in `content`. Don't silently override.

### "I'm repairing something and there is a diagnostic record"

Start from the diagnostic/outcome record, not from a broad session dump. Call `mcp__atrib-trace__trace` with `record_hash: <diagnostic_record_hash>`, a bounded `depth`, and `include_content: true` when available. The diagnostic record is evidence about the action it evaluates through `informed_by`; in a repair/refinement task, its failed cases' expected/actual fields are the repair target, while the traced ancestor is the prior behavior being corrected. Cite only the `record_hash` values that informed the fix.

### "I queried recall and got 25 records, what's informed_by?"

Read 25, identify the 1 to 3 that ACTUALLY changed your next action, declare ONLY those. The graph is only useful if `informed_by` is precise. "Every record I happened to see" is noise.

## Navigating the multi-identity graph

The graph contains records from multiple signers. When interpreting results:

| Class                                                                                                              | What they sign                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| You (wrapper's creator_key)                                                                                        | tool_call (auto) + observations / annotations / revisions signed via the three dedicated write primitives |
| Other interactive or background agents (different wrapper keys)                                                    | their own tool_call + write-primitive records                                                             |
| Service identities                                                                                                 | log-node signs checkpoints; directory-node signs anchors                                                  |
| Transaction counterparties ([D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) | cross-attestation entries in `signers[]` of transaction records                                           |
| Test fixtures                                                                                                      | claimed and labeled (e.g. `GX9rI…` is the public `fill(42)` test seed)                                    |
| Future: HKDF-derived sub-agents                                                                                    | parent/child relationship preserved on-chain                                                              |
| Future: humans authorizing actions                                                                                 | distinct identity class with `AUTHORIZED_BY` / `ATTESTED_BY` / `APPROVED_BY` / `DELEGATED_TO` edges       |

Recall returns YOUR records (filtered by your creator_key on the local mirror). The session graph at `graph.atrib.dev/v1/sessions/<context_id>` returns records from EVERY signer in that session. Pay attention to `creator_key`, "what I did" vs "what someone else did in the same session" are different signals.

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
- "Future-self needs this decision. Signing observation + annotation so recall finds it under [topic]."

These patterns make reasoning inspectable in real time and serve as discoverable hooks in commit messages and PR descriptions.

## Quick decision tree (memorize this)

About to take an action? Ask:

1. Will future-me, or another agent, want to find this with full context?
   → Sign explicitly via emit. Add an annotation if it will matter later.
2. Did anything in my past directly shape this action?
   → Set `informed_by` precisely (not exhaustively).
3. Does this contradict a past claim of mine?
   → Sign a `revision`. Don't silently override.
4. Is this trivial / mechanical / read-only?
   → Skip explicit signing.
5. Am I about to make a claim externally that depends on prior signed context (commit, PR, briefing)?
   → Query recall first. Reference record_hashes. Declare confidence in prose.

That's the loop. The graph of YOUR signed history is your working memory. Use it.

## What's still pending (sets the realistic-expectations bar)

These are honest gaps in the verification stack and producer-side cognitive surface. Be aware of which layers are operational vs warning-only vs not-yet-implemented:

- **Operational**: Ed25519 signature, JCS canonical form, chain integrity within a context_id, log inclusion proof verification (when fetched), [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) capability_check, [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross_attestation, [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture)/[§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture)/[§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture) posture detection, and Pattern 3 handoff claim acceptance ([§5.5.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#555-handoff-claim-verification), [D105](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance), [D106](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)). All seven cognitive primitives shipped: `atrib-emit@0.14.7`, `atrib-annotate@0.2.16`, `atrib-revise@0.2.16`, `atrib-recall@0.12.2`, `atrib-trace@0.5.2`, `atrib-summarize@0.4.4`, `atrib-verify@0.1.0`.
- **Warning-only**: [§6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#63-verifier-consultation-algorithm) verifier-consultation steps 1, 3, 4, 5, 7 surface explicit `IMPLEMENTATION-GAP` warnings rather than silently passing. These cover anchor freshness, witness coverage, directory checkpoint signature, append-only consistency, and AKD lookup proof validation.
- **Not yet implemented**: cross-log replication / equivocation detection ([D050](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) / [§2.11](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#211-cross-log-replication)), HKDF sub-agent identity derivation, periodic directory anchoring, emergency-key compromise path, and archive retrieval inside `atrib-verify`. The `log.atrib.dev` SSE / JSON Feed subscription surface is implemented per [D103](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields); an embedded spec viewer at `atrib.dev` is queued at [P024](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p024-embedded-spec-viewer-at-atribdev-auto-updated-from-spec-source).

The skill is the practice; the substrate is the mechanism. Both evolve. When this skill version (v0.4.0) feels stale, rewrite it again.
