# The cognitive primitives: two verbs, seven permanent aliases

> atrib's agent-facing surface is two cognitive verbs, `attest` (write) and `recall` (read), per the attest/recall rename ([D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)). The seven original primitives (three writes, four reads) stay mounted as permanent aliases over the same handlers, so nothing that already calls them by name breaks.

**Status**: STUB
**Spec anchors**: [D079](../../DECISIONS.md) · [D106](../../DECISIONS.md) · [D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse) · `skills/atrib/SKILL.md`
**Builds on**: every prior concept (this is the surface where agents interact with all of them)
**Enables**: agent-facing reasoning over signed history; "agents that reason from a past they can prove"

## What this teaches

Why the agent-facing surface collapsed to two verbs, what the seven legacy names now alias, and why verify was promoted after [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) closed the original six before the rename folded it into `recall`. This is the part of atrib agents actually call when they record, look up, verify, revise, or carry context forward.

## What to cover when this gets written

### The two-verb surface (current)

- `attest`: the write verb. Signs an observation by default. `ref: { kind: "annotates", target }` signs an annotation; `ref: { kind: "revises", target, reason }` signs a revision. One handler, byte-identical output to the legacy names.
- `recall`: the read verb. Absorbs the eight legacy `recall_*` tools under a `shape` argument, absorbs `trace`/`trace_forward` as `shape: "walk"` with a `direction`, and absorbs `atrib-verify` as a `verification` parameter. Results are JSON-identical to the legacy tools.

### The seven legacy primitives (permanent aliases)

**Writes (sign new records), now aliases of `attest`:**

- `atrib-emit`: RECORD. Present-moment noting / conclusion. Signs an observation.
- `atrib-annotate`: MARK. Tag a past record's importance + topics + summary. Signs an annotation.
- `atrib-revise`: CHANGE-MIND. Supersede a prior position with stated reason. Signs a revision.

**Reads (query the graph, no signing), now aliases of `recall`:**

- `atrib-recall` (the eight `recall_*` tools): LOOK-UP. Find prior records by creator, context, time window, event_type.
- `atrib-trace` / `trace_forward`: LINEAGE. Walk `informed_by` backward or forward from a record_hash.
- `atrib-summarize`: DIGEST. Condense N records into a narrative. Has no successor shape in `recall`; `recall` returns verified material, the caller synthesizes.
- `atrib-verify`: CHECK. Verify counterparty handoff evidence before citing accepted hashes.

To cover:

- Why the collapse to two verbs: agent-facing tool-call ergonomics favor a narrow discovery surface, while the boundary-drawing test that produced the original seven (different cognitive purpose, different required args, different graph effect) still explains what each `ref`/`shape` value does underneath
- Why monomorphic and not polymorphic dispatch was the original bar (per [D079](../../DECISIONS.md)), and why `ref`/`shape` dispatch on `attest`/`recall` does not violate that bar: one physical tool per verb, but the alias layer keeps the monomorphic legacy names live
- When to reach for each (the decision tree), now framed as `attest` vs `recall` first, then which `ref`/`shape` value
- New write primitives require promotion of a new event_type per [D036](../../DECISIONS.md); new read primitives require the extension-first lifecycle gate per [D080](../../DECISIONS.md)
- How the cognitive primitives compose: attest (observation) → attest with `ref.kind="annotates"` (mark it important) → attest with `ref.kind="revises"` (later change mind about it)
- The reads as graph-traversal verbs over the substrate
- Distribution shape per [D081](../../DECISIONS.md) + [D082](../../DECISIONS.md): the write primitives ship as both an MCP server (`atrib-attest`, long-lived stdio child for MCP-aware harnesses) and a CLI binary (`atrib-attest-cli`, short-lived spawn-per-call for hook-class producers like Claude Code's PostToolUse hooks). Records are byte-identical; only the integration shape differs. The legacy `atrib-emit` / `atrib-emit-cli` bins keep forwarding.
- Worked example: an agent reasoning about a past failure: uses recall (`shape: "history"`) to find prior records, recall (`shape: "walk"`) to walk the signed relationship path, summarize to condense the relevant context, then attest to sign a new observation reflecting what was learned

## See also

- Decisions: [D079 The six core cognitive primitives](../../DECISIONS.md), [D106 Verify is promoted to cognitive primitive 7](../../DECISIONS.md), [D164 attest/recall verb rename and primitive surface collapse](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse), [D036 Bar for promoting event_type](../../DECISIONS.md), [D058 ANNOTATES edge](../../DECISIONS.md), [D059 REVISES edge](../../DECISIONS.md), [D081 In-process emit for hook-class producers](../../DECISIONS.md), [D082 atrib-emit-cli binary distribution](../../DECISIONS.md)
- Concepts: [Graph derivation](05-graph-derivation.md) (the read primitives traverse the graph), [The chain](04-the-chain.md) (the write primitives extend it)
- Services: `services/atrib-attest` (write verb; ships `atrib-attest` MCP server + `atrib-attest-cli` per [D082](../../DECISIONS.md)), `services/atrib-recall` (read verb, absorbs trace and verify), `services/atrib-summarize`, plus the legacy re-export shims `services/atrib-emit`, `services/atrib-annotate`, `services/atrib-revise`, `services/atrib-trace`, `services/atrib-verify`, and `services/atrib-primitives`
- Skill: `skills/atrib/SKILL.md` (canonical agent-facing teaching doc)
