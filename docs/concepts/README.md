# Concepts

Plain-English deep-dives on the core ideas behind atrib. The spec ([`atrib-spec.md`](../../atrib-spec.md)) is the normative contract. These docs are the *why* and the *how-it-fits-together* in human-readable form.

Each concept links back to the spec sections that carry the normative detail, and forward to the other concepts it depends on or enables.

## How these docs are written

- Plain English first; jargon defined when introduced
- A worked example in every doc
- Cross-links: every concept references the spec sections it covers AND the other concepts it depends on
- Status frontmatter: `STUB` → `DRAFT` → `REVIEW` → `PUBLISHED`

## Suggested reading order (for someone new to atrib)

The logical layering — foundations first, then structure, then guarantees, then applications.

| # | Concept | Spec anchors | Status |
|---|---|---|---|
| 1 | [Records & signing](01-records-and-signing.md) | §1.2-1.4 | STUB |
| 2 | [The Merkle log](02-the-merkle-log.md) | §2 | STUB |
| 3 | [Identity & the directory](03-identity-and-directory.md) | §6 | STUB |
| 4 | [The chain (causal context)](04-the-chain.md) | §1.2.3, §1.2.6, D041, D044 | STUB |
| 5 | [Graph derivation](05-graph-derivation.md) | §3 | STUB |
| 6 | [The trust model](06-trust-model.md) | §8.7 | STUB |
| 7 | [Privacy postures](07-privacy-postures.md) | §8.3, §2.10, D045 | STUB |
| 8 | [Payments integration](08-payments-integration.md) | §1.7, §1.7.6, D052 | DRAFT |
| 9 | [The calculation algorithm](09-calculation-algorithm.md) | §4.6 | DRAFT |
| 10 | [Integration patterns (runtime adapters)](10-integration-patterns.md) | §9, D069 | STUB |
| 11 | [The six cognitive primitives](11-cognitive-primitives.md) | D079 | STUB |

## Discovery order (how atrib was actually built)

The order above is *learning-friendly*. The order below is *historically accurate*, reconstructed from the git history of this repo. Useful for understanding how atrib crystallized — which is itself instructive: substrate before surface, code before spec, governance after foundations.

| Phase | Window | What landed |
|---|---|---|
| **1. Foundational decisions + SDK skeleton** | Apr 5-6, 2026 | D001-D010 + the initial spec + decisions doc (first commit Apr 5 21:32); `packages/mcp`, `packages/agent`, `packages/verify`, `packages/log-dev` created Apr 6 |
| **2. The big spec crystallization** | Apr 14, 2026 | A single commit drops §0-§5 of `atrib-spec.md` (records, signing, transactions, Merkle log, graph, attribution policy, calculation, SDK); `services/log-node` ships the same day |
| **3. Filling in services + CLI** | Apr 15-19, 2026 | `packages/cli`, `services/graph-node` |
| **4. The governance cluster** | Apr 27-29, 2026 | §6 Key Directory, D041 `informed_by`, D045 privacy postures, §8.3 salted-commitment, D050 cross-log replication, D052 cross-attestation, §1.7.6 transaction cross-attestation requirement, §8.7 adversarial threat model, `packages/directory`, `services/directory-node`, `apps/dashboard` (public explorer) |
| **5. Cognitive primitives ship, one by one** | Apr 30 - May 13, 2026 | `services/atrib-emit` (Apr 30) → D044 `provenance_token` (May 3) → `services/atrib-trace`, `services/atrib-summarize`, `packages/mcp-wrap`, D058 annotation (May 4) → `services/atrib-recall` (May 5) → `packages/openinference` (May 11) → `services/atrib-annotate`, `services/atrib-revise`, **D079** (canonical naming of all six, May 13) |
| **6. Launch** | May 21, 2026 | Public release |

### What the discovery order reveals

- **Code before spec.** The SDK skeleton (`packages/mcp`, `packages/agent`, `packages/verify`) was prototyped in code for 9 days before the consolidated spec landed in a single Apr 14 commit. Most protocols dribble their spec out section-by-section; atrib wrote §0-§5 at once after the code had clarified the shape.
- **Governance arrived in a cluster, not gradually.** The trust model, privacy postures, cross-attestation requirement, identity directory, and public explorer all landed in three days at the end of April. This is the "ok the substrate works, now what guarantees does it actually provide" pass.
- **The chain evolved.** `chain_root` was foundational, but `informed_by` (D041, Apr 28) and `provenance_token` (D044, May 3) — the two things that make the chain *actually causal* — were added weeks later. The causal model wasn't designed up front; it was discovered.
- **The six cognitive primitives were named last.** atrib-emit shipped Apr 30. The full set of six was named canonically on May 13 (D079). The agent-facing surface was the *last* crystallization — the substrate had to work first.

## Status of this directory

Living draft as of 2026-05-22. The two `DRAFT` entries (payments + calculation) were produced in conversation and dropped in as v1 starting points. The rest are stubs awaiting deep-dive treatment.

Once a doc reaches `PUBLISHED`, it becomes source material for the eventual atrib developer docs site.
