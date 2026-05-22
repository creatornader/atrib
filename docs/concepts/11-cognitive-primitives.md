# The six cognitive primitives

> atrib's agent-facing surface is exactly six monomorphic MCP tools. Each meets the bash standard: one purpose, narrow input, composable output, stable API. Three are writes, three are reads.

**Status**: STUB
**Spec anchors**: [D079](../../DECISIONS.md) · `skills/atrib/SKILL.md`
**Builds on**: every prior concept (this is the surface where agents interact with all of them)
**Enables**: agent-facing reasoning over signed history; "agents that reason from a past they can prove"

## What this teaches

Why the agent-facing surface is six tools (not five, not seven), what each one is for, and why the set is closed for v1. This is the part of atrib agents actually call.

## What to cover when this gets written

The six primitives:

**Writes (sign new records):**
- `atrib-emit` — RECORD. Present-moment noting / conclusion. Signs an observation.
- `atrib-annotate` — MARK. Tag a past record's importance + topics + summary. Signs an annotation.
- `atrib-revise` — CHANGE-MIND. Supersede a prior position with stated reason. Signs a revision.

**Reads (query the graph, no signing):**
- `atrib-recall` — LOOK-UP. Find prior records by creator, context, time window, event_type.
- `atrib-trace` — LINEAGE. Walk `informed_by` backward from a record_hash.
- `atrib-summarize` — DIGEST. Condense N records into a narrative.

To cover:
- Why exactly six: the boundary-drawing test (different cognitive purpose, different required args, different graph effect)
- Why monomorphic and not polymorphic dispatch (per [D079](../../DECISIONS.md)): one tool, one job — the bash standard
- When to reach for each (the decision tree)
- The set is closed at six for v1; a seventh requires promotion of a new event_type per [D036](../../DECISIONS.md)
- How the cognitive primitives compose: emit → annotate (mark the emit as important) → revise (later change mind about the emit)
- The reads as graph-traversal verbs over the substrate
- Worked example: an agent reasoning about a past failure — uses recall to find prior records, trace to walk the causal chain, summarize to condense the relevant context, then emit a new observation reflecting what was learned

## See also

- Decisions: [D079 The six core cognitive primitives](../../DECISIONS.md), [D036 Bar for promoting event_type](../../DECISIONS.md), [D058 ANNOTATES edge](../../DECISIONS.md), [D059 REVISES edge](../../DECISIONS.md)
- Concepts: [Graph derivation](05-graph-derivation.md) (the read primitives traverse the graph), [The chain](04-the-chain.md) (the write primitives extend it)
- Services: `services/atrib-emit`, `services/atrib-annotate`, `services/atrib-revise`, `services/atrib-recall`, `services/atrib-trace`, `services/atrib-summarize`
- Skill: `skills/atrib/SKILL.md` (canonical agent-facing teaching doc)
