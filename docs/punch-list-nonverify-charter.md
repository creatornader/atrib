# Executor charter: graph-derivation corpus addition and producer conveniences

Branch: `chore/punch-list-nonverify` (cut from `main` after PR #493 lands).
Owner: the orchestrating session reviews every diff on this branch before push.
Executor boundary: local work only. No network operations, no repository pushes,
no ledger (`DECISIONS.md`) or top-level README edits, and no `packages/verify`
edits of any kind: three branches share that surface and it is locked.

## Source

These are the two non-verify categories of the redesign verifier punch list
(`docs/redesign-upgrade-path.md`, "Verifier punch list" section). That section
is authoritative where this summary drifts.

## Deliverable A: [§3.2.4](../atrib-spec.md#324-edge-derivation-rules) graph-derivation corpus addition

Pin `session_checkpoint` nodes as chain-spine-only: they participate in
CHAIN_PRECEDES continuity but earn no CONVERGES_ON edge and never participate
in calculation. Extend `spec/conformance/3.2.4/` with vectors for a session
containing checkpoint records (positive: chain edges present; negative: no
CONVERGES_ON, absent from calculation-input projections). Follow the corpus's
existing generator-plus-reference-test pattern: extend the generator,
regenerate, extend the reference test, same commit. Identify every consumer of
this corpus before editing (the graph service tests consume it; check whether
anything under `python/tests/` does too, and if so update it in the same
commit: the [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested) both-implementations rule, learned the hard way in PR #494).

## Deliverable B: producer conveniences (four items)

1. Middleware `delegationCert` config on `@atrib/mcp`: accept a delegation
   certificate at init, carry it to `_local.delegation_cert` in the mirror
   sidecar. Signed bytes unchanged; sidecar metadata only.
2. `atrib delegate` CLI subcommand in `@atrib/cli`: issue a delegation
   certificate for an ephemeral run key per [§1.11](../atrib-spec.md#111-delegation-certificates) ([D140](../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys)), Keychain-first key
   handling per the existing `@atrib/cli` conventions.
3. Signer-proxy capability advert gains a `creator_key` field (see the [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)
   signer-proxy example and its adapter surface).
4. Receipt-logic dedup: `@atrib/agent` re-implements receipt parsing that
   `@atrib/mcp` now exports; collapse onto the exported symbols with no
   behavior change (the exports already exist; this is deletion plus imports).

## Non-goals

- Anything in `packages/verify` (anchor transports, verifyRecord wiring,
  [§6.3](../atrib-spec.md#63-verifier-consultation-algorithm) walk): locked behind two unmerged branches, separately chartered.
- Dependency changes. No package.json dependency edits, no lockfile churn:
  an open PR adds a new workspace package and owns the next lockfile change.
- Signed-byte changes. Certificates ride sidecars and CLI output only.

## Acceptance gates (all must pass)

```
pnpm -r build && pnpm -r test   # build first; single Vitest worker is
                                # acceptable if the known @atrib/emit timing
                                # flakes appear under parallel load
pnpm doc-sync
```

Plus: the extended [§3.2.4](../atrib-spec.md#324-edge-derivation-rules) reference test passes; if `python/tests/` consumes
anything you touched, the Python suite passes too
(`python -m pytest python/tests -q`).

## Constraints

- [§5.8](../atrib-spec.md#58-degradation-contract) degradation contract: no new throw path reaches a caller.
- TypeScript strict, no `any`.
- Commit locally in logical units; imperative subjects, conventional-commit
  prefixes, 72 chars max, no AI attribution trailers.
- Write EXECUTOR-REPORT.md (uncommitted, repo root): what changed per
  deliverable, consumers identified for the corpus, and full gate output
  tails.
