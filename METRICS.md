# atrib metrics

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
| Distinct creator_keys | scan `/v1/tile/entries/*` for unique creator_key bytes | growing slowly toward >1 | Cumulative signer diversity across the log. It is not an active actor count |
| Active creator_keys in last 24h / 7d | `/v1/stats` or scan `/v1/tile/entries/*` by timestamp | non-zero and not dominated by one-off proofs | Current signer activity without confusing old demo keys for live actors |
| Chain depth distribution (median, p95, max) | persisted record JSONLs grouped by context_id | median > 1 means chains form | The "agents reason from a past" claim is empirical |
| `tool_call` vs `transaction` ratio | scan entries for `event_type` byte | non-zero transactions | Economic events flow through, not just chatter |
| Active wrappers | count atrib-wrapped MCP-client jsonl mirror files (operator-local convention; default `~/.atrib/records/*.jsonl`) | growing toward >1 | More than one consumer is wired to atrib at any time |
| Active framework adapters in use | grep wrapper logs by adapter name | growing toward >1 of the 5 adapters from [D018](DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)-[D024](DECISIONS.md#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private) | Cross-framework dogfood, not just one |

Cadence: review every Sunday. Hand-collected for now (`pnpm verify-log` then look at the printed entries). When this set stabilizes, automate via a `pnpm metrics` script that emits a JSON dashboard.

A Tier 1 alarm is *"this is becoming a science project."* It's not paged, but it's the signal that the system is built but unused.

## Tier 1b: dogfood behavior quality (weekly review)

Does signed evidence change later agent behavior, or do we only have a busy log?

| Metric | Source | Direction | What it tells us |
|---|---|---|---|
| Diagnostic traces with signed closure | local mirror plus `informed_by` walk | growing | Failures become replayable repair material |
| Proof-backed diagnostic records | log proof lookup plus local mirror rows | growing | Live evidence has inclusion proof, not only local presence |
| Body-commitment pass rate | `args_hash` / `result_hash` replay against local content | high | Future agents can check that the body they read matches the signed record |
| Stale-evidence rejection cases | harness or dogfood packet reports | non-zero when stale evidence exists | The system avoids outdated prior work instead of amplifying it |
| Replay gain | paired task or dogfood follow-up | positive | Prior signed evidence improves a future attempt |
| Repeated-failure recurrence | dogfood macro-eval report | falling | The substrate helps stop the same mistake from recurring |

Cadence: review with Tier 1. These metrics graduate a pattern from "signed
activity" to "behavior impact." Keep them separate from the public graph and
calculation layers. A prior-work packet, suspect report, or macro-eval label is
derived evidence, not a new protocol edge.

## Tier 2: ecosystem signals (monthly review)

Is anyone outside the operator interacting with atrib at all?

| Metric | Source | Direction | Notes |
|---|---|---|---|
| `@atrib/mcp` weekly downloads | npm registry | growing | Collected by `pnpm metrics:npm-downloads` into `metrics/npm-downloads-<date>.json` |
| `@atrib/agent` weekly downloads | npm registry | growing | Same |
| `@atrib/verify` weekly downloads | npm registry | growing | The merchant verifier is the ecosystem-shaped audience |
| `atrib` (PyPI) weekly downloads | pypistats | growing | Same collector, `pypi` row of the snapshot |
| GitHub stars / forks | `creatornader/atrib` | trend | Soft signal; matters less than downloads |
| Open issues from non-operator contributors | GitHub | non-zero | Someone external cares enough to file |
| Spec citations / external references | manual web search | trend | Are people writing about atrib? |
| Distinct deployments of `log-node` running real traffic | manual; survey known operators | toward >1 | One log = single point of trust. >1 logs = federated possibility |

Cadence: first of every month. Run `pnpm metrics:npm-downloads`, commit the snapshot, and pull GH numbers; look for new issues, citations, and forks.

A Tier 2 alarm is *"the ecosystem isn't picking this up."* If after 6 months of Tier 1 health we have zero Tier 2 signal, the thesis isn't reaching anyone.

## Tier 3: thesis validation (quarterly review)

Has the protocol produced anything irreversible, a real attribution payment, a witnessed checkpoint, a settlement someone acted on?

| Metric | Source | Direction | Notes |
|---|---|---|---|
| Witnesses cosigning `log.atrib.dev` checkpoints | parse `/v1/checkpoint` for additional `—` lines | toward ≥1 | First witness is the moment [§2.9](atrib-spec.md#29-witnessing-and-cosignatures) stops being theoretical |
| Witness diversity (signers, infra, jurisdictions) | manual; track per-witness metadata | three axes ([D032](DECISIONS.md#d032-witnessing-posture-for-v1-spec-defined-no-implementation)) | Single-axis diversity is weaker than spec acknowledges |
| Non-operator verifiers running `verify-loop` against the live log | server-access logs filtered by user-agent / IP, with operator privacy in mind | toward >0 | Are people actually checking? |
| Settlement documents ([§4.7](atrib-spec.md#47-settlement-recommendation-document)) generated for real economic events | manual; survey | toward >0 | The point of the protocol |
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

2. Tier 1 needs a `scripts/metrics.mjs` that runs against `log.atrib.dev` and emits weekly JSON: tree size delta, cumulative and active creator_keys, chain depth distribution, tx ratio. Estimate: 1-2 hours. Output committed to `metrics/` directory weekly.

3. Tier 2 started with the first npm publishes. `pnpm metrics:npm-downloads` collects the download cells (npm + PyPI) into dated `metrics/npm-downloads-*.json` snapshots.

4. Tier 3 starts when the first non-operator party touches atrib. Until then, the cell is "0, no external interaction."

5. Tier 4 thresholds are pre-committed responses. They're checked but only acted on at cadence.

## Recording

Weekly Tier 1 snapshots commit to `metrics/YYYY-MM-DD.json` (auto-generated by `pnpm --filter @atrib/log-node metrics`). Monthly Tier 2 reviews append a paragraph to `metrics/REVIEWS.md`. Quarterly Tier 3 reviews append a longer paragraph to the same file with named decisions. Tier 0 lives only in CI output and Fly dashboards; nothing committed.

## Metric lifecycle

A metric does not stay in the set forever. Each metric has a status that records how much weight it carries in decisions:

| Status | Meaning | Promotion / demotion criteria |
|---|---|---|
| `provisional` | Newly added; we suspect it might predict something useful, but we don't know yet. Tracked but not weighted in decisions. | After two quarterly reviews, promote to `tracked` if it has informed at least one decision; otherwise demote to `retired`. |
| `tracked` | A metric we watch and use to color discussions, but no decision is mechanically tied to it. | Promote to `decision-tied` once it gets named in a Tier 4 trigger or a tier-review decision. Demote to `retired` if a quarterly review finds it never moved a discussion. |
| `decision-tied` | A metric that decisions are explicitly pegged to. Changes here change behavior. | Demote to `tracked` (or directly to `retired`) only with a written explanation of why the metric no longer changes behavior. |
| `retired` | No longer collected (or collected but ignored). The script may still emit it for historical compatibility; nothing depends on it. | One-way transition. |

Each metric in this document and in the `METRICS` array of `services/log-node/scripts/metrics.mjs` carries a `status` field. Both must agree. When you change one, change the other in the same commit.

## Evolution review process

Metrics that were chosen at an early stage often turn out to measure the wrong thing. Metrics that are obvious in hindsight often weren't obvious at the time. This is normal. The point of having an explicit review is to make adjustment cheap and continuous instead of expensive and rare.

### Quarterly metric review (every 3 months)

For each metric currently in the set, answer **one** question:

> *Did this metric inform a decision in the last quarter?*

Decision categories that count:
- A Tier 4 trigger fired or was avoided because of this metric.
- A tier-review meeting changed direction (build / hold / pivot) using this metric as evidence.
- A new metric was proposed in response to a gap this metric exposed.
- An assumption was retired because this metric falsified it.

Things that do *not* count as "informed a decision":
- "Number went up." (Did anyone act?)
- "Number went down." (Same.)
- "I felt good / bad seeing the number." (Vibes are not decisions.)

For each metric, record the answer in `metrics/REVIEWS.md`. Then act:

| Answer | Action |
|---|---|
| Yes, decision was tied to this number | Promote to `decision-tied` if not already. Document the decision. |
| Yes, but only in the loose sense (it was on the dashboard) | Keep as `tracked`. |
| No, but it might next quarter | Keep as `provisional` (or `tracked`); but only allow this answer twice in a row. |
| No, and we can't articulate when it would | Demote one rung. After two consecutive No answers, `retired`. |

### Add new metrics from the gaps

The same review asks: **what decision did we want to make this quarter that no metric helped with?** If the answer is non-empty, add a new metric (status `provisional`) for next quarter. The metric goes into the script (one entry in `METRICS`) and into the relevant tier table here.

### Annual meta-review (every 12 months)

The evolution process itself is a thing that can rot. Once a year, re-read this section and answer:

> *Is the quarterly review actually changing the metric set, or has it become ceremony?*

Concrete tests:
- Have any metrics moved status in the last year? If zero, the review is performative.
- Has the size of the metric set stayed exactly the same? If yes, suspect.
- Is `metrics/REVIEWS.md` actually getting read at decision time, or does it accumulate without being referenced?

If the review process is performative, change it. If decisions are getting made without reference to metrics, that's either a metric problem (we measure the wrong things) or a discipline problem (we ignore the right things). Both are worth naming explicitly.

The annual meta-review is the only thing in this document that critiques the document itself. That recursion is intentional: any system of measurement that can't measure its own usefulness will calcify.

### Versioning

`METRICS.md` is committed; changes are visible in git history. Each commit that promotes/demotes a metric or adds/removes one should reference the review that produced the change. The `metrics/` snapshot directory is append-only; changing how a metric is computed without bumping `schema_version` in `services/log-node/scripts/metrics.mjs` is a bug.

## Why "recursive evolution" instead of "fixed dashboard"

A fixed dashboard answers questions you decided were important on the day you built it. A recursively evolving metric set lets the questions themselves be wrong, lets the answers expose better questions, and treats the scaffolding around all of it as a thing that decays unless renewed.

If three quarters from now this entire document is unrecognizable from the v1 above, that is a sign the review process worked, not that the original was bad. If it is identical to v1, that is the alarm.

## What this document is not

This is not a product roadmap. It does not say "build feature X by date Y." It says: *here is how we'll know whether what we already built is being used, by whom, for what.* The dogfood experiment's purpose was always to produce a measuring instrument, not a ship-it-and-hope.

A successful Tier 0+1 with no Tier 2+3 means *the protocol works and nobody wants it.* That outcome is acceptable as long as we're clear about it. A Tier 0 collapse means we don't even have a substrate to measure. Everything in between is signal.
