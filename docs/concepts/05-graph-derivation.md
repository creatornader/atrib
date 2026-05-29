# Graph derivation

> Records + linking primitives → a directed graph with nine deterministic edge types. The same records, derived by two independent implementations, produce the same edges.

**Status**: STUB
**Spec anchors**: [§3 Graph Query Interface](../../atrib-spec.md#3-graph-query-interface) · [§3.2.4 Edge Derivation Rules](../../atrib-spec.md#324-edge-derivation-rules)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md)
**Enables**: [The calculation algorithm](09-calculation-algorithm.md), every consumer of structural relationships

## What this teaches

Why atrib's graph records *structure*, not *causality interpreted from content*, and why determinism in edge derivation is decision-critical for verifiability.

## What to cover when this gets written

- The 9 edge types: CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES
- Why these 9 and not more: each derived from *observable record structure* only — no edge type that requires interpreting tool names or response content
- The determinism property: two implementations on identical input MUST produce identical edge sets
- How each edge derives from which fields:
  - CHAIN_PRECEDES from `chain_root` matches
  - SESSION_* from `context_id` + `timestamp`
  - CONVERGES_ON from non-transaction → transaction in same session
  - CROSS_SESSION from `provenance_token`
  - INFORMED_BY from `informed_by` array
  - ANNOTATES from `annotation` event_type ([D058](../../DECISIONS.md))
  - REVISES from `revision` event_type ([D059](../../DECISIONS.md))
- Why this matters: the graph is a **fact layer**; weighting/distribution decisions live in the policy layer ([§4](../../atrib-spec.md#4-attribution-policy-format)). Pure separation.
- Worked example: same set of records run through two implementations, show byte-identical edge output

## See also

- Spec: [§3](../../atrib-spec.md#3-graph-query-interface), [§3.2.4](../../atrib-spec.md#324-edge-derivation-rules), [§3.6](../../atrib-spec.md#36-implementation-notes) (fact/policy separation)
- Decisions: [D005 Structure not causality](../../DECISIONS.md), [D009 Fact/policy separation](../../DECISIONS.md), [D058 ANNOTATES edge](../../DECISIONS.md), [D059 REVISES edge](../../DECISIONS.md)
- Concepts: [The chain](04-the-chain.md), [The calculation algorithm](09-calculation-algorithm.md)
