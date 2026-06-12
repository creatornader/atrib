# The seven cognitive primitives

> atrib's agent-facing surface is exactly seven cognitive primitives. Each meets the bash standard: one purpose, narrow input, composable output, stable API. Three are writes, four are reads.

**Status**: STUB
**Spec anchors**: [D079](../../DECISIONS.md) · [D106](../../DECISIONS.md) · `skills/atrib/SKILL.md`
**Builds on**: every prior concept (this is the surface where agents interact with all of them)
**Enables**: agent-facing reasoning over signed history; "agents that reason from a past they can prove"

## What this teaches

Why the agent-facing surface is seven primitives, what each one is for, and why verify was promoted after [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) closed the original six. This is the part of atrib agents actually call.

## What to cover when this gets written

The seven primitives:

**Writes (sign new records):**

- `atrib-emit` — RECORD. Present-moment noting / conclusion. Signs an observation.
- `atrib-annotate` — MARK. Tag a past record's importance + topics + summary. Signs an annotation.
- `atrib-revise` — CHANGE-MIND. Supersede a prior position with stated reason. Signs a revision.

**Reads (query the graph, no signing):**

- `atrib-recall` — LOOK-UP. Find prior records by creator, context, time window, event_type.
- `atrib-trace` — LINEAGE. Walk `informed_by` backward from a record_hash.
- `atrib-summarize` — DIGEST. Condense N records into a narrative.
- `atrib-verify`: CHECK. Verify counterparty handoff evidence before citing accepted hashes.

To cover:

- Why exactly seven: the boundary-drawing test (different cognitive purpose, different required args, different graph effect) plus [D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)'s verify-before-linking use case
- Why monomorphic and not polymorphic dispatch (per [D079](../../DECISIONS.md)): one tool, one job — the bash standard
- When to reach for each (the decision tree)
- New write primitives require promotion of a new event_type per [D036](../../DECISIONS.md); new read primitives require the extension-first lifecycle gate per [D080](../../DECISIONS.md)
- How the cognitive primitives compose: emit → annotate (mark the emit as important) → revise (later change mind about the emit)
- The reads as graph-traversal verbs over the substrate
- Distribution shape per [D081](../../DECISIONS.md) + [D082](../../DECISIONS.md): the WRITE primitives ship as both an MCP server (`atrib-emit`, long-lived stdio child for MCP-aware harnesses) and a CLI binary (`atrib-emit-cli`, short-lived spawn-per-call for hook-class producers like Claude Code's PostToolUse hooks). Records are byte-identical; only the integration shape differs.
- Worked example: an agent reasoning about a past failure: uses recall to find prior records, trace to walk the signed relationship path, summarize to condense the relevant context, then emit a new observation reflecting what was learned

## See also

- Decisions: [D079 The six core cognitive primitives](../../DECISIONS.md), [D106 Verify is promoted to cognitive primitive 7](../../DECISIONS.md), [D036 Bar for promoting event_type](../../DECISIONS.md), [D058 ANNOTATES edge](../../DECISIONS.md), [D059 REVISES edge](../../DECISIONS.md), [D081 In-process emit for hook-class producers](../../DECISIONS.md), [D082 atrib-emit-cli binary distribution](../../DECISIONS.md)
- Concepts: [Graph derivation](05-graph-derivation.md) (the read primitives traverse the graph), [The chain](04-the-chain.md) (the write primitives extend it)
- Services: `services/atrib-emit` (ships two binaries: `atrib-emit` MCP server + `atrib-emit-cli` per [D082](../../DECISIONS.md)), `services/atrib-annotate`, `services/atrib-revise`, `services/atrib-recall`, `services/atrib-trace`, `services/atrib-summarize`, `services/atrib-verify`, `services/atrib-primitives`
- Skill: `skills/atrib/SKILL.md` (canonical agent-facing teaching doc)
