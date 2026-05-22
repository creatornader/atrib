# The calculation algorithm

> A pure function from (graph, policy) to a creator → share distribution summing to 1.0. Any party with the inputs gets bit-identical output. This is what turns "we have evidence of what happened" into "and here's the math for who gets what."

**Status**: DRAFT (v1, 2026-05-22 — produced in conversation; needs operator hand-review before promotion to REVIEW)
**Spec anchors**: [§4.6](../../atrib-spec.md#46-the-calculation-algorithm) · [§4.7 Settlement Recommendation Document](../../atrib-spec.md#47-settlement-recommendation-document)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md), [Graph derivation](05-graph-derivation.md), [Payments integration](08-payments-integration.md)
**Enables**: settlement adjudication, multi-creator value distribution, dispute resolution

## What the algorithm does

Given two inputs:
- **`G`**: the attribution graph for a session (every signed record + every derived edge)
- **`P`**: the agreed policy document for that session

It produces a distribution: a map from creator public keys to share fractions summing to exactly `1.0`. That's it. No money moves at this step. The algorithm just produces the math that says *"creator A gets 30%, creator B gets 50%, creator C gets 20%."*

## Two non-obvious design choices that drive everything

**1. It's a pure function.** Same inputs → same outputs, on any machine, run by any party. The merchant runs it, the creators run it, an auditor runs it — bit-for-bit identical results. The atrib hosted endpoint at `resolve.atrib.dev/v1/calculate` is a *convenience copy* of the same algorithm; its output has zero special authority over a local run.

**2. The protocol provides the math; the policy provides the values.** atrib does not decide what a contribution is worth. The merchant publishes a policy doc ([§4](../../atrib-spec.md#4-attribution-policy-format)) saying *"CHAIN_PRECEDES edges to the transaction are worth 0.6, gap nodes are worth 0.1, apply temporal decay with a 24-hour half-life, minimum share 1%, maximum 40%."* The algorithm applies those numbers. Two merchants can hold completely different policies and atrib does not care which is "right."

## When it runs, when it refuses

It runs **iff** the graph contains at least one transaction node. No transaction = no closed session = the algorithm MUST NOT proceed. And the transaction MUST carry ≥2 verified signatures per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) — strict consumer policies MAY reject the calculation entirely when `cross_attestation_missing: true`; the default behavior is to compute, return, and surface the flag.

## The six steps in plain English

| Step | What happens |
|---|---|
| **1. Identify contributors** | Walk the graph. A node counts as a contributor if it has at least one edge on a path to the transaction node AND it's a `tool_call` or a `gap_node`. Observations skip (they are witnesses, not actions). Extension URIs skip by default. Transactions themselves skip (they're the receiver). |
| **2. Compute raw scores** | For each contributor, collect every edge type on a path to the transaction. Look up each edge type's weight in the policy. Take the **max** of those weights, not the sum (load-bearing — see below). Apply modifiers in order: temporal decay (older = scaled down by `2^(-Δt / half_life)`), chain depth penalty (more hops = lower), call count boost (same content_id retrieved multiple times = small boost up to a cap). |
| **3. Apply constraints** | `minimum_share` floor first (anyone below the floor gets bumped up to it; everyone else scales down proportionally), then `maximum_share` cap (anyone above the cap is capped; excess redistributes to everyone below). Order is normatively pinned. |
| **4. Normalize** | Divide everything by the sum so shares total exactly 1.0 (corrects any floating-point drift from step 3). |
| **5. Aggregate by creator** | A creator who appears on multiple nodes (multiple tool calls, multiple tools) gets the sum of their nodes' shares. Gap nodes aggregate under a sentinel `__unsigned__` key. |
| **6. Apply creator floors** | Per-creator minimums negotiated during session negotiation ([§4.5](../../atrib-spec.md#45-session-negotiation)) — "this creator's floor is 5% no matter what." Bump up below-floor creators, scale others down, renormalize. |

### Why `max()` not `sum()` on edge weights

Every contributing node ends up with a CONVERGES_ON edge to the transaction *plus* some "primary" edge (CHAIN_PRECEDES, SESSION_PRECEDES, CROSS_SESSION, etc.). If you summed edge weights, CONVERGES_ON would inflate every contributor equally, because every contributor has it. Taking `max` picks the strongest claim the node has on the transaction. The structural edges that are universal don't dominate the structural edges that actually mean something.

## A concrete worked example

Three tool calls into one purchase.

**Session timeline**:
- t=0s: tool A (search) — creator α
- t=10s: tool B (compare) — creator β, `informed_by` A
- t=20s: tool C (spec lookup) — creator γ, `informed_by` B
- t=30s: transaction via x402, signed by agent + merchant

**Policy**:
```jsonc
{
  "edge_weights": { "CHAIN_PRECEDES": 0.5, "CONVERGES_ON": 0.1, "unsigned": 0.0 },
  "modifiers": [],
  "constraints": { "minimum_share": 0.05 }
}
```

**Step-by-step**:
1. **Contributors**: A, B, C (transaction excluded; observations and extensions skip).
2. **Raw scores**: Each of A, B, C has both a CHAIN_PRECEDES path to the transaction (through `informed_by`) AND a CONVERGES_ON edge. `max(0.5, 0.1) = 0.5`. All three score 0.5.
3. **Constraints**: Normalize first — total = 1.5, so shares = 0.333 each. All above the 0.05 floor; no cap. Pass through unchanged.
4. **Normalize**: Already sum to 1.0.
5. **Aggregate by creator**: α = 0.333, β = 0.333, γ = 0.333.
6. **Creator floors**: None defined → pass through.

**Output**: `{α: 0.333, β: 0.333, γ: 0.333}`. Each creator gets a third.

**Now flip one knob**: add a temporal-decay modifier with a 30-second half-life.

| Node | Δ from transaction | Decay factor | Score |
|---|---|---|---|
| A (t=0) | 30s = 1 half-life | 0.500 | 0.5 × 0.500 = 0.250 |
| B (t=10) | 20s = 0.67 half-lives | 0.630 | 0.5 × 0.630 = 0.315 |
| C (t=20) | 10s = 0.33 half-lives | 0.794 | 0.5 × 0.794 = 0.397 |

Total = 0.962. Normalized: **α = 26%, β = 33%, γ = 41%**.

C (most recent) now gets the biggest share. The merchant configured the policy to value recency — the algorithm just applied that configuration deterministically.

## Where the calculation sits in the full flow

Steps 10-12 of the end-to-end transaction flow (the rest is in [Payments integration](08-payments-integration.md)):

- Step 10: calculation runs on (graph, policy) → distribution map
- Step 11: settlement recommendation document constructed from the distribution ([§4.7](../../atrib-spec.md#47-settlement-recommendation-document)); optionally signed
- Step 12: merchant (or settlement service) actually pays out using whatever rail/treasury they prefer — atrib's job ends at step 11

## Why this structure matters

| Design choice | What it buys you |
|---|---|
| Pure function, no network, no clocks | Settlement disputes resolve on bit-identical recomputation, not on operator-self-report |
| `max()` on edge weights, not sum | Structural edges that are universal (CONVERGES_ON) don't double-count |
| Normatively pinned modifier order + constraint order | Two implementations on the same inputs produce identical outputs (no implementation-defined behavior) |
| Cross-attestation gating (≥2 signers on transaction) | The math is only as strong as the input; a single-signer transaction means "trust me" — the gate forces multi-party agreement before the math runs |
| Policy is publishable and negotiable, not protocol-baked | Different verticals can encode different values; atrib doesn't impose what "fair attribution" means |

## See also

- Spec: [§4.6](../../atrib-spec.md#46-the-calculation-algorithm), [§4.7](../../atrib-spec.md#47-settlement-recommendation-document), [§4.2](../../atrib-spec.md#42-policy-document-format) (policy format), [§4.5](../../atrib-spec.md#45-session-negotiation)
- Decisions: [D009 Fact/policy separation](../../DECISIONS.md), [D010 Default policy](../../DECISIONS.md)
- Concepts: [Graph derivation](05-graph-derivation.md), [Payments integration](08-payments-integration.md)
