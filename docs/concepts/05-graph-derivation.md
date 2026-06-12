# Graph derivation

> Records + linking primitives → a directed graph with nine deterministic edge types. The same records, derived by two independent implementations, produce the same edges.

**Status**: Draft
**Spec anchors**: [§3 Graph Query Interface](../../atrib-spec.md#3-graph-query-interface) · [§3.2.4 Edge Derivation Rules](../../atrib-spec.md#324-edge-derivation-rules)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md)
**Enables**: [The calculation algorithm](09-calculation-algorithm.md), every consumer of structural relationships

## What this teaches

Why atrib's graph records _structure and signed relationship claims_, not _causality interpreted from content_, and why verifiability requires deterministic edge derivation.

## One Graph, Two Planes

The atrib graph is one directed property multigraph. It has two useful reading planes:

1. **Chronology plane**: faithful event history. `CHAIN_PRECEDES`, `SESSION_PRECEDES`, `SESSION_PARALLEL`, `CROSS_SESSION`, and `CONVERGES_ON` preserve ordering, continuity, and transaction convergence. This is the "what happened before what" layer.
2. **Declared-relationship plane**: signed relationship claims. `INFORMED_BY`, `PROVENANCE_OF`, `ANNOTATES`, and `REVISES` preserve what the signer says a record was informed by, anchored to, commenting on, or superseding. This is semantic only in the signed-declaration sense.

The two planes are not competing graph models. They are both part of the graph. `/v1/chain/{record_hash}` projects the chronology plane by walking `CHAIN_PRECEDES`. `/v1/trace/{record_hash}` projects the declared-relationship plane by walking producer-declared ancestry. `/v1/graph/{context_id}` exposes the derived graph for a scope.

The protocol never reads tool names, natural-language content, or responses and invents an edge. If a relationship matters, the producer signs it through a field, a typed record, or evidence that a verifier can inspect.

## What to cover when this gets written

- The 9 edge types: CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES
- Why these 9 and not more: each derived from _observable record structure_ only. No edge type requires interpreting tool names or response content.
- The determinism property: two implementations on identical input MUST produce identical edge sets
- How each edge derives from which fields:
  - CHAIN_PRECEDES from `chain_root` matches
  - SESSION\_\* from `context_id` + `timestamp`
  - CONVERGES_ON from non-transaction → transaction in same session
  - CROSS_SESSION from `session_token`
  - INFORMED_BY from `informed_by` array
  - PROVENANCE_OF from `provenance_token`
  - ANNOTATES from `annotation` event_type ([D058](../../DECISIONS.md))
  - REVISES from `revision` event_type ([D059](../../DECISIONS.md))
- Why this matters: the graph is a **fact layer**; weighting/distribution decisions live in the policy layer ([§4](../../atrib-spec.md#4-attribution-policy-format)). Pure separation.
- Worked example: same set of records run through two implementations, show byte-identical edge output

## See also

- Spec: [§3](../../atrib-spec.md#3-graph-query-interface), [§3.2.4](../../atrib-spec.md#324-edge-derivation-rules), [§3.6](../../atrib-spec.md#36-implementation-notes) (fact/policy separation)
- Decisions: [D005 Structure not causality](../../DECISIONS.md), [D009 Fact/policy separation](../../DECISIONS.md), [D058 ANNOTATES edge](../../DECISIONS.md), [D059 REVISES edge](../../DECISIONS.md)
- Concepts: [The chain](04-the-chain.md), [The calculation algorithm](09-calculation-algorithm.md)
