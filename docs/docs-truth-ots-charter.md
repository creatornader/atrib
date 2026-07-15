# Executor charter: docs-truth sweep and OTS upgrade worker

Branch: `chore/docs-truth-and-ots-worker` (cut from current `main`).
Owner: the orchestrating session reviews every diff before push.
Executor boundary: local only; no pushes, no network beyond local pnpm; no
`DECISIONS.md` entries (flag ledger-worthy findings in the report instead).

## Deliverable A: docs-truth sweep

The repo shipped D143-D164 in five days and the docs lag reality. Verify
every checkable claim in the doc tree against the current state and fix
drift. The reality anchors, all verifiable in-repo or via `npm view`:

- Ledger tail is D164; the redesign plan is fully executed. In
  `docs/redesign-upgrade-path.md`, every step now has a landed D-number
  (D137-D141, D142, D146-D148 renamed daemon, D147 payments, D164 rename):
  mark the plan executed with per-step pointers; same for the status lines
  of any other docs/ plan or relay document that still reads future tense.
- `docs/website-redesign-relay.md`: the atribd embargo condition (daemon
  merged AND live on npm) is now MET (@atrib/daemon 0.2.0). Mark the
  embargo lifted with the date; do not otherwise rewrite website guidance.
- npm surface: @atrib/attest 0.1.0 and @atrib/recall 1.0.0 are the verbs;
  six legacy packages carry 1.0.0 re-export shims with deprecated older
  ranges; @atrib/summarize is deprecated at 0.4.23 (mounted through the
  window); @atrib/daemon 0.2.0 (binary atribd). Fix any doc that names
  stale versions, missing deprecations, or the unscoped daemon name.
- Operator cutover is COMPLETE: all three profiles run @atrib/daemon;
  fix claims like "keeps the legacy session-based host until the operator
  cutover" (CLAUDE.md services tree, atribd README migration section,
  ARCHITECTURE).
- Alias window is OPEN: fifteen legacy tool names plus the two verbs, per
  D164. Docs must describe aliases as permanent for tool names and the
  window as governing package/mount retirement only.

Sweep scope: README.md, CLAUDE.md, ARCHITECTURE.md, DESIGN.md,
PRIOR-ART.md, METRICS.md, DOC-SYNC-TRIGGERS.md, docs/ (including concepts/
and evidence-profiles/), skills/atrib/SKILL.md, every packages/*/README.md
and services/*/README.md. Method: verify against reality, fix only what is
WRONG or stale; do not restyle accurate prose. Writing rules apply to
every edited line (no em dashes, banned-vocabulary list).

## Deliverable B: OTS pending-receipt upgrade worker

Decision (signed, operator-approved): a host-owned local worker owns
persistence and upgrade of OpenTimestamps pending receipts; producers
record pending receipts in `_local` sidecars at anchor time; the transport
stays stateless. Build the reference worker:

- `scripts/upgrade-ots-receipts.mjs` (host-side, like the other D128-class
  scripts): scan a mirror directory's sidecars for pending OTS receipts,
  attempt upgrade through the existing OTS transport in @atrib/verify,
  write upgraded proofs back to the sidecar (envelope-level, never inside
  the signed record), idempotent, §5.8 silent-fail with `atrib:` logging.
- Offline-fixture tests (pending receipt, upgradeable receipt, malformed
  sidecar skipped, already-upgraded no-op). No live network in tests.
- A short README section or docs/ note documenting the worker and a
  sample launchd schedule (do NOT install any LaunchAgent).

## Gates

pnpm -r build && pnpm -r test (single worker acceptable for the known emit
flake), pnpm doc-sync, focused tests for the new worker. Report:
EXECUTOR-REPORT.md (uncommitted), including a table of every doc claim
fixed (file, stale claim, corrected claim) and any ledger-worthy findings.
