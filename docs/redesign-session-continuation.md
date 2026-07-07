# Continuation packet: redesign-analysis session → local successor

Status: session-handoff document. Written 2026-07-06 by the cloud
redesign-analysis session at handoff to a local Desktop session; the cloud
session is retired after this commit — do not run both against this branch.
This packet replaces a raw transcript dump: it carries the decisions,
corrections, and state; the repo carries everything else.

## How to use this packet

Read this file, then: CLAUDE.md (invariants + "Orchestration cost policy" +
the decision-log line through [D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)),
[`redesign-upgrade-path.md`](redesign-upgrade-path.md) (plan + verifier punch
list), the [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested)-[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)
entries and [P046](../DECISIONS.md#p046-atribd-a-public-stateless-native-local-daemon-as-the-default-primitive-topology)-[P051](../DECISIONS.md#p051-orchestration-infrastructure-dogfood-wiring-with-cost-and-routing-accounting)
pending entries in DECISIONS.md, the coordination contract at the end of
[`atrib-sdk-session-brief.md`](atrib-sdk-session-brief.md), and
[`website-redesign-relay.md`](website-redesign-relay.md).

## Session arc (one day, 2026-07-06, branch `claude/atrib-redesign-analysis-4g0r9v`)

1. Clean-room redesign analysis → upgrade-path plan → operator approved the
   whole candidate set (P042-P050).
2. Workflow fleet drafted eight candidate ADRs (research → draft →
   adversarial judge → revise); landed as P042-P049 + hand-written P050.
3. MCP 2026-07-28 stateless release analyzed; folded in as a forcing
   function (see the upgrade-path doc's stateless section).
4. Tranche 1: conformance corpora + spec sections for five ADRs (two
   credit-wall interruptions; recovered via workflow resume). Promoted:
   P042→[D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) (evidence envelope, spec [§5.5.7](../atrib-spec.md#557-universal-evidence-envelope)), P043→[D138](../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture) (anchor plurality,
   [§2.11.7](../atrib-spec.md#2117-anchors-generalizing-the-replication-target)-13), P044→[D139](../DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized) (session_checkpoint, [§1.2.10](../atrib-spec.md#1210-checkpoint), extension-URI
   staged, byte 0x08 reserved), P045→[D140](../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys) (delegation certificates, [§1.11](../atrib-spec.md#111-delegation-certificates)),
   P049→[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133) (dev.atrib/attribution extension, [§1.5.4.1](../atrib-spec.md#1541-negotiated-extension-carriage-devatribattribution) +
   `docs/extensions/dev.atrib-attribution/v0.1.md`).
5. Tranche 2 (commit `414b40d`): producer/verifier source surfaces for all
   five in `@atrib/{mcp,verify,emit,agent,mcp-wrap}` — all opt-in,
   byte-identical behavior unconfigured. 1657 tests green across the five
   packages at integration time.
6. SDK sibling session (branch `claude/atrib-sdk-bootstrap-jsvs7y`) built
   `@atrib/sdk` + the Python `atrib` package ([D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested), its own ADR), aligned to
   the accepted schemas, added CI + docs + runnable example; merged into this
   branch repeatedly, last at `aed1d92`. It is now in the activation phase
   per the coordination contract: envelope production, multi-anchor config,
   receipt consumption, Python parity — its exclusive write scope is
   `packages/sdk/` + `python/`; the five protocol packages are this
   session-line's scope.
7. Cost reckoning: ~6.2M subagent tokens in one day, effectively all on the
   top tier at max effort → binding Orchestration cost policy in CLAUDE.md,
   pinned cheap agent types in `.claude/agents/`
   (`mechanical-builder` sonnet/low, `mechanical-sweeper` haiku/low), and
   P051 queued (see Corrections below for its final framing).

## Corrections ledger (do NOT re-derive; these were settled the hard way)

- The operator's "harness handoff/routing infra" = the **codex-plugin-cc
  relay** (premium-tier orchestrator/planner and judge; GPT-5.5 xhigh
  executor legs — a separate budget pool). "Agent-loop infra" = the
  operator's own **`agent-loop` command** infrastructure. NOT the legacy
  agent-bridge (that misreading is corrected in P051's entry; agent-bridge is
  only a candidate transport if ever revived per P002).
- Cross-harness offload is routing tier 2 in the cost policy: package
  mechanical self-contained work for the codex-plugin-cc executor
  (charter + executable acceptance gates + branch) instead of spawning
  fleets. Fleets cannot cross the harness boundary; the relay can.
- In-harness fleets: never let mechanical agents inherit a premium session
  model; use the pinned agent types. Judges/design drafters are the only
  upshifts. Fable leaves the operator's subscription the night of
  2026-07-07 — everything remaining was deliberately shaped to be executable
  by smaller models against executable gates (corpora, tests, doc-sync).
- Cloud sessions cannot load plugins or reach local infra; that is why this
  packet exists. The successor session is LOCAL: codex-plugin-cc and
  agent-loop are actually invocable — use them per the policy.
- doc-sync (`node scripts/check-doc-sync.mjs`) gates every commit here:
  inline-link all bare §/Dxxx/Pxxx refs, corpus manifests must match flat
  `cases/*.json`, and public-boundary wording rules apply. Its failures
  masked by pipes bit this session twice — run it bare before committing.

## Current state (all pushed)

- Branch `claude/atrib-redesign-analysis-4g0r9v` is the integration trunk;
  the SDK branch merges FROM it, never into it; final PR to main happens
  from the trunk when both workstreams land. No PR exists yet.
- Suites at last full run: `@atrib/mcp` 695, `@atrib/verify` 605,
  `@atrib/agent` 195, `@atrib/emit` 107, `@atrib/mcp-wrap` 55,
  `@atrib/sdk` 120 (+1 skip), Python 255 (+6 documented skips). doc-sync
  8/8.
- Website session is bound by `website-redesign-relay.md` (tense rules:
  [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)-[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133) present tense, P046-P048 roadmap tense, atribd embargo until
  2026-10-06).

## Remaining work, with routing tier per the cost policy

1. **Tranche 3 — P047 alias mounting + P048 payments relocation.**
   Mechanical against the impact catalog + existing suites → tier 2
   (codex-plugin-cc executor packages) or `mechanical-builder`. Design
   calls already made in the ADR drafts.
2. **Punch-list corpus closure** (see the upgrade-path doc's punch list) —
   pure generator-extend-regenerate-test loops → tier 2.
3. **P050 convention write-up** (atrib skill section + envelope profile
   entry) — small, judgment-light; warm-context solo.
4. **P051 promotion + implementation** — wires baton/join records + cost
   accounting into the codex-plugin-cc relay and agent-loop layers; needs
   operator input on the relay's receipt surfaces; judgment work.
5. **Gated:** P046 atribd rebuild (stateless MCP TS SDK, review
   2026-10-06); npm/PyPI publishes (`@atrib/sdk` has a live consumer
   waiting: atrib-cloud); `dev.atrib/attribution` v0.1 public publication
   timing (before 2026-07-28, after the P047 naming is re-confirmed —
   already satisfied since the extension uses the rename-proof noun).

## Open operator decisions

- Second default anchor for the [D138](../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture) SDK default set (Rekor vs OTS) and the
  `requiredAnchors` default flip release.
- `@atrib/sdk` npm publish timing (unblocks atrib-cloud migration).
- Extension v0.1 publication venue/timing before 2026-07-28.
- P051 acceptance once P050's conventions land.
