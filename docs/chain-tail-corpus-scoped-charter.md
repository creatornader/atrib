# Executor charter: corpus-scoped mirror-tail resolution

Branch: `fix/chain-tail-corpus-scoped` (cut from `main` at `f97b0db5`).
Owner: the orchestrating session reviews every diff on this branch before push.
Executor boundary: local work only. No network operations, no repository pushes,
no external service calls, no ledger (`DECISIONS.md`) or top-level README edits.

## Problem

Analysis of a live mirror corpus (2026-07-10) found 1,001 chain forks under the
mirror directory. Of 21 forks whose losing side died at the inheritance step, 20
had their sibling record in a different mirror file, and 105 of 3,190 contexts
span more than one file. The write side and the read side disagree about what
the mirror is:

- Write-side tail lookup reads exactly one file.
  [`readMirrorTail`](../packages/mcp/src/mirror.ts) streams the single
  configured mirror file, filters by `context_id`, newest wins.
  [`inheritChainContext`](../packages/mcp/src/mirror.ts) inherits from that one
  file only.
- Read-side consumers (recall, SessionStart aggregation, audit tooling)
  aggregate every `*.jsonl` in the mirror directory.

So a context whose records land in two files (different producers, or the same
producer under a different `ATRIB_AGENT`) resolves a stale tail and forks the
chain, even with zero write concurrency.

A second, independent defect: the `atrib-emit` autochain read default does not
match the storage write default. [`index.ts`](../services/atrib-emit/src/index.ts)
(around lines 59-65) falls back to `~/.atrib/records/<agent>.jsonl`, while
[`storage.ts`](../services/atrib-emit/src/storage.ts) (around lines 58-63)
writes `~/.atrib/records/atrib-emit-<agent>.jsonl`. The read fallback names a
file no producer writes.

## Deliverables

1. **Corpus-scoped tail resolution in `@atrib/mcp`.** When the mirror-file
   inheritance step of [`resolveChainRoot`](../packages/mcp/src/chain-root.ts)
   runs, resolve the tail across the mirror corpus: every `*.jsonl` in the
   directory containing the effective mirror file (after env resolution),
   filtered by `context_id`, newest record wins across files. The
   [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)
   precedence order is unchanged. Only the mirror-inheritance step widens from
   one file to the corpus. Every producer that uses `resolveChainRoot` inherits
   the fix.
2. **Read-default fix in `atrib-emit`.** The autochain source fallback must
   name the same file the storage layer writes.
3. **Measure before indexing.** Benchmark the corpus scan on a synthetic
   corpus of 100 files / 100k total lines. If the filtered scan resolves in
   under 50ms, ship the plain scan and record the measurement in the PR notes.
   Only add an index if the measurement fails, and then: advisory cache only,
   atomic tmp-plus-rename writes, full-scan fallback on any inconsistency,
   safe to delete at any time.
4. **Conformance vectors.** Extend
   [`spec/conformance/1.2.3/multi-producer/`](../spec/conformance/1.2.3/multi-producer/)
   with cross-file cases: a context spanning two mirror files where the correct
   tail lives in the file the signing producer does not own, plus a
   single-file case proving existing behavior is preserved. Wire them into the
   corpus's existing reference test so two implementations must agree.
5. **Tests.** In `packages/mcp/test/`:
   - a repro that fails on current `main`: two mirror files, same
     `context_id`, newer tail in the sibling file; assert `resolveChainRoot`
     picks it (verify the failure by stashing the src change, note the result);
   - degradation per [§5.8](../atrib-spec.md#58-degradation-contract): an
     unreadable or malformed sibling file is skipped silently and resolution
     continues;
   - determinism: two runs over the same corpus give the same tail.

## Non-goals

- Serializing concurrent writers. The genesis race (read-tail, sign, append
  with no locking) is real and measured, and it belongs to the local daemon
  track (P046, landed as [D148](../DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime)), not this change.
- Cross-harness chain-signal threading (the
  [D115](../DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle)
  env bundle). Separate package.
- Any signed-byte change. Record format, JCS canonical form, and signatures
  are untouched. This change only affects which prior record the resolver
  selects.

## Acceptance gates (all must pass)

```
pnpm -r build && pnpm -r test   # build first; tests run against dist/
pnpm doc-sync
```

Plus: the new conformance reference test passes, and the repro test from
deliverable 5 fails with the mirror change reverted.

## Constraints

- The degradation contract is absolute: no new throw path reaches a caller.
  Catch everything, log with the `atrib:` prefix, continue.
- TypeScript strict mode, no `any`.
- Commit locally in logical units on this branch. Subject lines: imperative,
  conventional-commit prefix, 72 chars max.

## Provenance

Two signed records on the operator substrate anchor this charter's findings:

- `sha256:12ed584c8e9341fdbaf3be1bdd63c9e3bf990ed52510f1907e4f5dfa88148ff3`
  (fork-count measurement)
- `sha256:8d6a3d3d16d50cbf153f8add51822baa8d317e89cac400cbc7b2b747180be6c7`
  (two-defect split: genesis race vs cross-file blindness)

Follow-up records about this work should reference them via `informed_by`.
