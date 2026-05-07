---
name: atrib
version: 0.2.0
description: |
  Use atrib as your literal substrate for memory, reasoning, and getting
  smarter over time — not as instrumentation that observes you from the
  outside. Activate at every session start, before consequential decisions,
  when claims need to be defendable later, when current reasoning
  contradicts past records, when starting work that builds on prior
  sessions, or when expressing confidence/uncertainty that should be
  findable. Provides session-start ritual, pre-emit checklist, recall
  patterns, informed_by discipline, code-shape examples for emit
  (annotation / revision / observation), worked decision examples,
  diagnostic patterns for catching practice gaps, and the multi-producer
  composition story (wrapper + emit + nightly batch).
allowed-tools:
  - mcp__atrib-recall__recall_my_attribution_history
  - mcp__atrib-emit__emit
  - Bash
  - Read
  - Write
  - Edit
---

# atrib: use the protocol from the inside out

This skill teaches you to use atrib as substrate for your memory, reasoning, and the way you get smarter across sessions. When the substrate is operational on the host running you, what's missing is YOU using it deliberately at the moments that matter.

If you're invoked in a Claude Code session and you're not emitting records during consequential work, **the substrate is fine but the practice is broken**. This skill is the fix.

## Status of the substrate (verify before relying)

| Capability | Mechanism | How to verify it's operational |
|---|---|---|
| Auto-sign every wrapped MCP tool call | `@atrib/mcp` middleware composed by an MCP wrapper | Wrapped MCP tools available in the current process |
| Sign explicit cognitive events (observation, annotation, revision) | `mcp__atrib-emit__emit` MCP tool, wired in `~/.claude.json` | Tool present in the current process |
| Query own past with local Ed25519 verification | `mcp__atrib-recall__recall_my_attribution_history` | Tool present in the current process |
| Persist signed records to local mirrors | `~/.atrib/records/*.jsonl` (per-producer files) | `ls ~/.atrib/records/` |
| Public log + browsable explorer | `https://log.atrib.dev/v1/stats` + `explore.atrib.dev` | `curl -s https://log.atrib.dev/v1/stats` |
| Identity → key binding | `@atrib/directory` + `atrib publish-claim` CLI | `curl -s https://directory.atrib.dev/v6/lookup/<creator_key>` |
| Per-record verification (signature, posture, capability_check, cross_attestation) | `@atrib/verify` `verifyRecord()` annotations ([D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)/[D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)/[D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)/[D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)/[D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)/[D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121)) | `pnpm --filter @atrib/verify test` |

If any row of that table fails to verify in your session, the practice is moot — fix infrastructure first, then come back. If they all pass, the rest of this skill is your operating manual.

## Session-start ritual (DO THIS BEFORE ANY WORK)

The most common failure mode is forgetting to look. Before you do anything else in a Claude Code session in a repo connected to atrib:

```
1. mcp__atrib-recall__recall_my_attribution_history({ limit: 5 })
   → orient: what did past-me do most recently? what context_id are
     we continuing? are signatures verifying?

2. curl -s https://log.atrib.dev/v1/stats
   → orient: when did the last record land on the public log?
     If hours/days ago AND your session is about substantive work,
     the dogfood loop is silent — you'll need to be the source.

3. Mentally identify your session's likely emit moments:
   • What decision will I make in the current process that future-me should find?
   • What claim will I publish (commit message, PR, briefing)?
   • What might I revise from a past claim?
```

Take ~30 seconds. The result of this ritual is a baseline you carry through the session.

## When to invoke `mcp__atrib-emit__emit`

YES — sign explicitly when:

- Making a consequential decision (architecture choice, plan revision, mutating action whose effect matters across time)
- Making a claim you'll be expected to defend, cite, or revise later
- Noticing something a future-you would want to find again
- Encountering a contradiction between current intent and a past record (sign a `revision`, not a silent override)
- Beginning work that builds on prior sessions (sign an observation declaring continuity)
- Expressing confidence or uncertainty that should be findable later
- Discovering a session-spanning pattern (annotation with `importance: high` and topics)

NO — skip explicit signing when:

- Reading docs or grepping for known strings
- Running mechanical operations (tests, type-checks, formatters)
- Making trivial edits (typos, format-only changes, code style sweeps)
- Doing pure computation (rendering, parsing, sweeping a known-good rule across many files)

The default discipline: per-MCP-tool-call signing happens automatically via the wrapper for tools served through wrapped MCPs. **Claude Code builtin tools (Read, Edit, Bash, Write, Grep, Glob) bypass MCP entirely and are NOT auto-signed.** This is the single biggest practice trap. If your work consists mostly of builtin calls — code edits, file reads, bash — atrib will be silent on you UNLESS you explicitly emit.

## Pre-emit checklist (10 seconds before each emit)

Before calling `mcp__atrib-emit__emit`, ask:

1. **Why am I signing this?** One-line answer. ("Future-me will need to find when I made the [§8.2](../../atrib-spec.md#82-opaque-name-posture) ambiguity decision.")
2. **Did anything I already signed inform this?** Query `recall` if unsure. Identify the SUBSET of records that ACTUALLY shaped this decision; that's `informed_by`. Not "everything I happened to query."
3. **Does this contradict a past claim of mine?** If yes, this is a `revision`, not an `observation`.
4. **What importance signal does future-me need?** If this is one of the load-bearing records of the session, follow the emit with an `annotation` referencing it.

If you can't answer #1 in one line, you don't need to sign yet.

## Code-shape examples

### Pattern 1: load-bearing observation + annotation

```typescript
// Step 1: emit the observation describing what happened
const obs = await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/observation",
  content: {
    what: "Decided that §8.2 verifier surface should report 'hashed' | 'plain' | null, NOT verbatim/opaque/hashed. The verbatim-vs-opaque regex is structurally indistinguishable.",
    why_noted: "Future-me asking 'why didn't we surface verbatim/opaque distinctly?' should find this with the spec rationale.",
    topics: ["D061", "§8.2", "tool_name_form", "spec_decision"]
  }
})
// → { record_hash: "sha256:abc123...", context_id: "...", warnings: [...] }

// Step 2: annotate it as critical-importance for future retrieval
await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/annotation",
  content: {
    annotates: obs.record_hash,
    importance: "critical",
    summary: "If you're investigating §8.2 form detection later, read this one.",
    topics: ["D061", "§8.2"]
  },
  informed_by: [obs.record_hash]
})
```

### Pattern 2: revision (current claim contradicts a past one)

```typescript
// Discovered a prior claim was wrong after deeper investigation.
await mcp__atrib_emit__emit({
  event_type: "https://atrib.dev/v1/types/revision",
  content: {
    revises: "sha256:abc123…",
    prior_position: "X is not built / does not exist",
    new_position: "X IS operational; my earlier search was incomplete and missed the actual location.",
    reason: "Cross-checked authoritative project docs; corrected framing."
  },
  informed_by: ["sha256:abc123…"]
})
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

`mcp__atrib-recall__recall_my_attribution_history` reads your local signed-record mirror, verifies each Ed25519 signature, and returns records newest-first.

| Filter | Use case |
|---|---|
| `context_id: <32hex>` | "What did I do in this trace?" |
| `event_type: 'transaction'` | "My recent transactions" (only `tool_call` and `transaction` are filterable in v0.2 of recall) |
| no filters | "Everything I've ever signed" |
| `compact: false` | Need full bytes for re-verification |
| `include_unverified: true` | Investigating tampered or partial mirror state |

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
| `mcp__atrib-emit__emit` (you, deliberately) | Whenever you call it | `observation` / `annotation` / `revision` records |
| Scheduled background batches | Cron / launchd | Per-event observation records from watchers; per-annotation records from synthesis passes; chained via `informed_by` |
| Always-on agent runtime (host-specific) | Continuous, when wired in | Records the agent's autonomous activity between interactive sessions |
| Future scheduled-runtime layer | Cron + event-driven scheduler | Replaces nightly-batch-only emission with finer-grained scheduled cognitive work |

When you check `https://log.atrib.dev/v1/stats` mid-day and `newest_timestamp_ms` is many hours old, the most common cause is that nightly batches have fired but no interactive session has been emitting since. **A multi-hour gap during business hours is a signal your practice has stopped, not infrastructure failure.** Always-on autonomous emission is a separate substrate decision, orthogonal to this skill.

## Diagnostic patterns

### "I think I'm signing but the log is silent"

Check in this order:
1. `curl -s https://log.atrib.dev/v1/stats` → if tree_size hasn't grown since your emit, submission may be queued or the log may be down.
2. `ls -lt ~/.atrib/records/atrib-emit-claude-code.jsonl` → if mtime updated, the local mirror has it; submission is the bottleneck.
3. `tail -1 ~/.atrib/records/atrib-emit-claude-code.jsonl | jq .` → confirm the bytes you intended.
4. Re-emit with `--verbose` mental model and check the `warnings` array on the response — submission failures land there.

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
| You (wrapper's creator_key) | tool_call + emitted observations / annotations / revisions in your sessions |
| Other Claude Code agents (different wrapper keys) | their own tool_call + emit records |
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

- **Operational**: Ed25519 signature, JCS canonical form, chain integrity within a context_id, log inclusion proof verification (when fetched), [§6.7](../../atrib-spec.md#67-capability-declarations) capability_check, [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross_attestation, [§8.2](../../atrib-spec.md#82-opaque-name-posture)/[§8.3](../../atrib-spec.md#83-salted-commitment-posture)/[§8.4](../../atrib-spec.md#84-coarsened-timing-posture) posture detection.
- **Warning-only (per `project_phase3_followup_gaps`)**: [§6.3](../../atrib-spec.md#63-verifier-consultation-algorithm) verifier-consultation steps 1, 3, 4, 5, 7 surface explicit `IMPLEMENTATION-GAP` warnings rather than silently passing. These cover anchor freshness, witness coverage, directory checkpoint signature, append-only consistency, and AKD lookup proof validation.
- **Not yet implemented**: cross-log replication / equivocation detection ([D050](../../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) / [§2.11](../../atrib-spec.md#211-cross-log-replication)), HKDF sub-agent identity derivation, periodic directory anchoring, emergency-key compromise path, `atrib-summarize` and `atrib-trace` MCP tools (would close the consumer side of the cognitive loop).

The skill is the practice; the substrate is the mechanism. Both evolve. When this skill version (v0.2.0) feels stale, rewrite it again.
