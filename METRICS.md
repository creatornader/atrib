# Atrib Metrics

How we measure whether the dogfood experiment is working.

The dogfood experiment's goal is to prove the thesis: *"agents that reason from a past they can prove."* This document defines what success and failure look like, in numbers we can collect, on cadences we can sustain.

The metrics are tiered. Each tier answers a different question, runs on a different cadence, and decides a different thing. Lower tiers must hold before higher tiers matter; a Tier 0 failure makes Tier 3 numbers irrelevant.

## Tier 0: substrate health (continuous)

These are the dial-tones. If any of them goes red, nothing else on this page is true.

| Metric | Source | Healthy value | What it tells us |
|---|---|---|---|
| `verify-loop` daily CI status | `.github/workflows/verify-log.yml` | green | The deployed log is structurally sound under independent verification |
| `verify-loop` gate pass count | CI run output | 13/13 (or current count if more gates added) | No gate has silently regressed |
| `log.atrib.dev` /v1/checkpoint HTTP status | external probe | 200 (or 404 if intentionally empty) | The log is reachable |
| `log.atrib.dev` machine state | `fly machines list -a atrib-log` | started | Operator infrastructure is alive |
| Persistence file size | inside the Fly VM | non-decreasing across redeploys | Tree state survives operational changes |
| Time since last successful verify | CI run history | < 24 hours | The verifier itself is not broken |

A Tier 0 alarm is paged. Anything else can wait.

## Tier 1: dogfood activity (weekly review)

Is the substrate being used in non-trivial ways, or is it sitting idle on a server?

| Metric | Source | Direction | What it tells us |
|---|---|---|---|
| Records on log | `/v1/checkpoint` tree size | should grow | Real attribution events happen |
| Records per day (rolling 7-day avg) | derived from successive checkpoint size | not collapsing to 0 | Use is sustained, not a one-time burst |
| Distinct creator_keys | scan `/v1/tile/entries/*` for unique creator_key bytes | growing slowly toward >1 | More than one signer means an actual ecosystem, not just the operator |
| Chain depth distribution (median, p95, max) | persisted record JSONLs grouped by context_id | median > 1 means chains form | The "agents reason from a past" claim is empirical |
| `tool_call` vs `transaction` ratio | scan entries for `event_type` byte | non-zero transactions | Economic events flow through, not just chatter |
| Active wrappers | count `atrib-wrapper-*.jsonl` files in `~/.atrib/records/` (operator-local) | growing toward >1 | More than one consumer is wired to atrib at any time |
| Active framework adapters in use | grep wrapper logs by adapter name | growing toward >1 of the 5 adapters from D018-D024 | Cross-framework dogfood, not just one |

Cadence: review every Sunday. Hand-collected for now (`pnpm verify-log` then look at the printed entries). When this set stabilizes, automate via a `pnpm metrics` script that emits a JSON dashboard.

A Tier 1 alarm is *"this is becoming a science project."* It's not paged, but it's the signal that the system is built but unused.

## Tier 2: ecosystem signals (monthly review)

Is anyone outside the operator interacting with atrib at all?

| Metric | Source | Direction | Notes |
|---|---|---|---|
| `@atrib/mcp` weekly downloads | npm registry (once published) | growing | Currently not published; first publish enables this metric |
| `@atrib/agent` weekly downloads | npm registry | growing | Same |
| `@atrib/verify` weekly downloads | npm registry | growing | The merchant verifier is the ecosystem-shaped audience |
| GitHub stars / forks | `creatornader/atrib` | trend | Soft signal; matters less than downloads |
| Open issues from non-operator contributors | GitHub | non-zero | Someone external cares enough to file |
| Spec citations / external references | manual web search | trend | Are people writing about atrib? |
| Distinct deployments of `log-node` running real traffic | manual; survey known operators | toward >1 | One log = single point of trust. >1 logs = federated possibility |

Cadence: first of every month. Pull npm and GH numbers; look for new issues, citations, and forks.

A Tier 2 alarm is *"the ecosystem isn't picking this up."* If after 6 months of Tier 1 health we have zero Tier 2 signal, the thesis isn't reaching anyone.

## Tier 3: thesis validation (quarterly review)

Has the protocol produced anything irreversible, a real attribution payment, a witnessed checkpoint, a settlement someone acted on?

| Metric | Source | Direction | Notes |
|---|---|---|---|
| Witnesses cosigning `log.atrib.dev` checkpoints | parse `/v1/checkpoint` for additional `—` lines | toward ≥1 | First witness is the moment §2.9 stops being theoretical |
| Witness diversity (signers, infra, jurisdictions) | manual; track per-witness metadata | three axes (D032) | Single-axis diversity is weaker than spec acknowledges |
| Non-operator verifiers running `verify-loop` against the live log | server-access logs filtered by user-agent / IP, with operator privacy in mind | toward >0 | Are people actually checking? |
| Settlement documents (§4.7) generated for real economic events | manual; survey | toward >0 | The point of the protocol |
| Total economic value attributed | sum of transaction record amounts × distribution share | toward >$0 | Calc-algorithm output meets reality |
| First commercial integration | survey | named or unnamed | The thesis converts to demand |

Cadence: end of each quarter. These are the numbers that decide whether atrib is a real protocol or a beautiful demo.

A Tier 3 alarm is *"the thesis isn't converting."* A quarter of green Tier 0 + Tier 1 + zero Tier 3 means the protocol works fine but nobody needs it for what we thought they would.

## Tier 4: kill / pivot criteria (continuous review)

Numbers we'd act on, not just observe. Each has a threshold; if we cross one, the response is named.

| Trigger | Threshold | Response |
|---|---|---|
| Infrastructure cost | > $50/month with no Tier 3 signal | reduce: kill graph-node, run log on a cheaper tier, accept worse latency |
| Hours invested per week (operator) | > 10 hrs/week with no Tier 2 signal | reduce: switch to maintenance-only; stop building |
| Months since substrate complete with zero non-operator users | > 6 months | pivot: revisit the framing; the thesis is reaching nobody |
| Alternative protocol announces strict superset | observed | evaluate: can atrib become a profile of the alternative, or is it redundant? |
| Cosignature gate stays SKIP | > 9 months | pivot: witnessing isn't happening; design works under single-operator trust or admit it's the only model |
| Daily CI verify failures | > 3 in a row | reduce: fix or accept that operator infrastructure isn't reliable; consumers can't depend on what operator can't keep up |

Cadence: re-read at the same review meetings as the higher tiers. The point is to make pivot decisions explicit and pre-committed, not feeling-based.

## What to start collecting *today*

1. Tier 0 is already automated via the daily `verify-log` workflow. Nothing to add.

2. Tier 1 needs a `scripts/metrics.mjs` that runs against `log.atrib.dev` and emits weekly JSON: tree size delta, distinct creator_keys, chain depth distribution, tx ratio. Estimate: 1-2 hours. Output committed to `metrics/` directory weekly.

3. Tier 2 starts when the first npm package gets published. Until then, the cell is "n/a, packages not published."

4. Tier 3 starts when the first non-operator party touches atrib. Until then, the cell is "0, no external interaction."

5. Tier 4 thresholds are pre-committed responses. They're checked but only acted on at cadence.

## Recording

Weekly Tier 1 snapshots commit to `metrics/YYYY-MM-DD.json` (auto-generated). Monthly Tier 2 reviews append a paragraph to `metrics/REVIEWS.md`. Quarterly Tier 3 reviews append a longer paragraph to the same file with named decisions. Tier 0 lives only in CI output and Fly dashboards; nothing committed.

## What this document is not

This is not a product roadmap. It does not say "build feature X by date Y." It says: *here is how we'll know whether what we already built is being used, by whom, for what.* The dogfood experiment's purpose was always to produce a measuring instrument, not a ship-it-and-hope.

A successful Tier 0+1 with no Tier 2+3 means *the protocol works and nobody wants it.* That outcome is acceptable as long as we're clear about it. A Tier 0 collapse means we don't even have a substrate to measure. Everything in between is signal.
