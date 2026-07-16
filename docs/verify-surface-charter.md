# Executor charter: verify-surface package (punch-list remainder + payments step one)

Branch: `feat/verify-surface-completion` (cut from `main` after PR #502 lands;
main tail [D162](../DECISIONS.md#d162-factual-values-never-truncate-in-rendered-memory)).
Owner: the orchestrating session reviews every diff before push.
Executor boundary: local work only. No network operations beyond what pnpm
needs locally, no pushes, no ledger (`DECISIONS.md`) or top-level README edits.

## Why now

Three branches serialized on `packages/verify` for four days. All are merged:
[D143](../DECISIONS.md#d143-authority-propagation-is-verifier-side-policy-over-informed_by)-[D145](../DECISIONS.md#d145-action-bound-single-use-authorization-tokens) (authority), [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core) (payments spin-out, step-one packaging deferred),
[D149](../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)-[D150](../DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first) (trust-set composition and the attestation extension). The verify
surface is now single-writer. This package finishes everything that queued
behind that lock, in one pass, so the lock never reforms.

## Deliverable A: verifier punch-list remainder

The last four categories of `docs/redesign-upgrade-path.md` "Verifier punch
list" (the section is authoritative where this summary drifts):

1. Real anchor transports: Rekor, RFC 3161, and OpenTimestamps HTTP adapters
   behind the existing `AnchorTransport` interface (stubs today). Offline
   fixtures for tests; live calls stay opt-in behind explicit config per the
   [§5.8](../atrib-spec.md#58-degradation-contract) posture. The OTS pending-upgrade loop ownership question goes in the
   report as an open question for the orchestrating session, not a decision
   you make.
2. `verifyRecord` anchor wiring: an `anchorTrust` / `proofBundle` option
   surfacing `anchor_plurality` on results, composing with (not duplicating)
   the shipped envelope and delegation blocks, plus the P005 README
   reconciliation pass (README claims match the actual exported surface,
   including the new trust-set and attestation fields from [D149](../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)/[D150](../DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first)).
3. Corpus pins for unit-covered behaviors, per corpus: hash-mismatch and
   sanitization families (evidence-envelope); per-anchor-type negatives and
   the malformed-vs-unknown precedence corner (anchors); consistency
   negatives and foreign-context_id leaf fault (session-checkpoint);
   malformed-key, ambiguity `candidates[]`, and depth-limit vectors
   (delegation); legacy-initialize gating vector (mcp-extension). Pattern:
   extend the generator, regenerate, extend the reference test, same commit.
4. [§6.3](../atrib-spec.md#63-verifier-consultation-algorithm) directory-walk step for principal resolution and the [§1.11.4](../atrib-spec.md#1114-verifier-walk) step-4
   `run_key_in_directory` fact.

## Deliverable B: payments step-one packaging (deferred from [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core))

Per the [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core) entry and `docs/adr-draft-p048-payments-spinout.md` package
surface section, semver-minor only:

1. `@atrib/agent`: detection moves to subpath export `@atrib/agent/payments`;
   root re-exports retained with deprecation JSDoc.
2. `@atrib/verify`: `verifySettlementRecommendation`, the calculation module,
   and the AP2/VI check module move to `@atrib/verify/payments`; root
   re-exports retained. `verifyRecord`, cross-attestation, envelope dispatch,
   handoff, authority, attestation, and the OAuth/AAuth/x401 modules stay at
   the root.
3. The injectable `detectTransaction?: TransactionDetector[]` middleware
   option with the documented precedence (caller-supplied > profile default
   set when installed > none), degradation per [§5.8](../atrib-spec.md#58-degradation-contract).
4. Verify-side consumption of the two payments envelope corpus families
   (fixtures and manifest entries already landed with [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core); wire the
   reference tests).

## Both-implementations clause (hard rule)

Before finishing, run the full Python suite. If any corpus you extend or any
[§1](../atrib-spec.md#1-attribution-record-format)/[§5](../atrib-spec.md#5-sdk-specification)-surface behavior you change has a consumer under `python/`, update it
in the same commit (the [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk-python-atrib-in-repo-byte-identical-corpus-tested) rule; PR #494 is the precedent for what happens
when this is skipped).

## Non-goals

- The P047 rename (own charter; landed as [D164](../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse), and the atribd npm-seed gate has since lifted).
- New decisions: everything here implements decided things ([D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)-[D140](../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys), [D143](../DECISIONS.md#d143-authority-propagation-is-verifier-side-policy-over-informed_by),
  [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core), [D149](../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)-[D150](../DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first)). If you find yourself needing a new decision, stop and
  write it in the report as an open question.
- Dependency additions beyond what the anchor transports strictly need; if
  a new dependency is unavoidable, isolate it in one commit and name it in
  the report (lockfile churn is a merge-surface cost).

## Acceptance gates (all must pass)

```
pnpm -r build && pnpm -r test   # single Vitest worker acceptable for the
                                # known @atrib/emit host-timing flake
pnpm doc-sync                   # 14 checks
python -m pytest python/tests -q
```

Plus: every touched corpus's reference test green; changeset(s) added
(minor @atrib/agent, minor @atrib/verify; anything else you touch).

## Report

EXECUTOR-REPORT.md (uncommitted, repo root): per-deliverable changes, the
OTS ownership open question, any dependency added, consumer sweep results,
and full gate output tails.
