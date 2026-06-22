# The chain (causal context)

> Records aren't islands. Three primitives link records into a causal history: `chain_root`, `informed_by`, and `provenance_token`. Together they let an agent reason from a past it can prove.

**Status**: STUB
**Spec anchors**: [§1.2.3 chain_root](../../atrib-spec.md#123-chain_root-for-genesis-records) · [§1.2.6 provenance_token](../../atrib-spec.md#126-provenance_token) · [D041 informed_by](../../DECISIONS.md) · [D044 provenance_token](../../DECISIONS.md)
**Builds on**: [Records & signing](01-records-and-signing.md)
**Enables**: [Graph derivation](05-graph-derivation.md), every consumer of the causal graph

## What this teaches

The three different "linking primitives" atrib uses, why each exists, and what each is good (and bad) at. `chain_root` was foundational (Apr 14), `informed_by` was added later ([D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), Apr 28), and `provenance_token` came after that ([D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), May 3). The chain _evolved_; it wasn't designed up front.

## What to cover when this gets written

- `chain_root`: deterministic per-context anchor; same context_id → same chain_root forever
- The genesis chain_root formula: `"sha256:" + hex(SHA-256(UTF-8(context_id)))`
- `informed_by`: multi-valued, per-record array of full hashes. "This record was informed by these specific prior records."
- `provenance_token`: single-valued, genesis-only, truncated to 16 bytes. Cross-session causal anchoring suitable for the W3C tracestate header.
- Why `informed_by` and `provenance_token` are different things (design decision: [D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) vs [D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), and why the split was needed)
- Multi-producer chain composition: [§1.2.3.1](../../atrib-spec.md#1231-multi-producer-chain-composition) + [D067](../../DECISIONS.md) precedence contract (inbound token > within-process tail > env var > mirror file > synthetic genesis)
- The corollary: never reimplement chain selection in a new producer. Use `resolveChainRoot` from `@atrib/mcp` or replicate it bit-for-bit
- Worked example: a session with three tool calls, show how the three linking primitives compose

## See also

- Spec: [§1.2.3](../../atrib-spec.md#123-chain_root-for-genesis-records), [§1.2.6](../../atrib-spec.md#126-provenance_token), [§1.2.3.1](../../atrib-spec.md#1231-multi-producer-chain-composition)
- Decisions: [D041 informed_by](../../DECISIONS.md), [D044 provenance_token](../../DECISIONS.md), [D067 Multi-producer chain composition](../../DECISIONS.md)
- Concepts: [Graph derivation](05-graph-derivation.md) (where the chain becomes edges)
