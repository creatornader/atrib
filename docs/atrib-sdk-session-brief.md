# Handoff brief: Python + JS/TS atrib client libraries

Status: brief for a future dedicated session. Written 2026-07-06 by the
redesign-analysis session so the SDK session starts from decisions, not from
archaeology. Read together with
[`redesign-upgrade-path.md`](redesign-upgrade-path.md).

## What to build

Two client libraries exposing the atrib substrate to application code:

1. **JS/TS**: a consolidation, not a greenfield. The record layer already
   exists across `@atrib/mcp` (signing, `resolveChainRoot`, mirror, submit
   queue) and `@atrib/emit`. The SDK effort extracts a clean
   `@atrib/core`-shaped API over it: `attest()` / `recall()` verbs, key/cert
   handling, anchor submission, mirror access — consumable without running an
   MCP server.
2. **Python**: the first non-TypeScript implementation of [§1](../atrib-spec.md#1-attribution-record-format)/[§5](../atrib-spec.md#5-sdk-specification). This is the
   real test of the spec's "two implementations must agree" claims.

## Non-negotiable constraints (from CLAUDE.md invariants)

- **Byte-identical records.** JCS (RFC 8785) canonicalization, Ed25519 over
  32-byte seeds, optional fields omitted-not-null. A record produced by the
  Python SDK and the TS SDK from identical inputs must hash identically.
- **Conformance corpora are the test fixtures, not inspiration.** The Python
  port must pass, unmodified: `spec/conformance/1.2.6/` (provenance_token),
  `1.4/` (signing, incl. adversarial vectors), `1.2.3/multi-producer/`
  (chain-root precedence), `3.2.4/` (edge derivation, if the SDK ships the
  derivation library), `2.6.1/` (submission API). Port failures are spec-bug
  discoveries — file them, don't route around them.
- **Never reimplement chain selection ad hoc.** Python must port
  `resolveChainRoot` (packages/mcp/src/chain-root.ts) bit-for-bit against the
  corpus, per [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)'s corollary.
- **Degradation contract ([§5.8](../atrib-spec.md#58-degradation-contract)).** Catch everything, `atrib:`-prefixed
  logging, never throw to the caller, non-blocking submission ([§5.3.5](../atrib-spec.md#535-log-submission)).
  This applies identically in Python.
- **No `any` (TS) / full typing (Python: pydantic or dataclasses + mypy
  strict). The spec defines exact shapes.**

## Design decisions already made in the redesign discussion

- **Verbs: `attest` (write) / `recall` (read)** — tentatively agreed; final
  naming gated on the impact catalog in
  [`attest-recall-rename-impact.md`](attest-recall-rename-impact.md). If that
  ADR hasn't landed when the SDK session starts, build the API surface with
  the new verbs anyway (greenfield surfaces are exempt from the migration
  sequencing; only existing published names need shims).
- **Target topology: the daemon (`atribd`) is the default peer.** SDKs should
  prefer talking Streamable HTTP to the local primitives runtime and fall back
  to in-process signing (the `emitInProcess` path) when no daemon is present.
  Do not add a third signing implementation.
- **Anchor plurality:** SDK config takes an anchor *set*; default posture ≥2
  once upgrade-path step 1 lands. Until then, log.atrib.dev single-anchor with
  the existing `log_proofs` shape.
- **Summarize is not an SDK verb.** Synthesis belongs to the calling
  harness/model. The SDK returns verified raw material.
- **Evidence attachments** use the [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) tiered envelope; payment/authz
  specifics are profiles, not SDK core.

## Naming / packaging suggestions (to validate in-session)

- npm: `@atrib/attest` is unclaimed as of 2026-07-06 (verified against the
  registry). Candidate: a single `@atrib/sdk` (or promote `@atrib/core`) with
  `attest`/`recall` entry points, rather than one package per verb.
- PyPI: check `atrib` availability first; fall back `atrib-sdk`. Follow
  `docs/publishing-new-npm-package.md` for the npm side; a PyPI equivalent
  runsheet should be written as part of the session (new doc + CLAUDE.md
  structure entry per the doc-sync conventions).

## What the SDK session should NOT do

- Do not fork record semantics "for ergonomics" — no new optional fields, no
  reordered canonicalization, no convenience timestamps.
- Do not embed framework adapters (structural typing / peer-dep discipline
  stays with `@atrib/agent`).
- Do not couple to log-node specifics; anchors are an interface.
- Do not publish until `scripts/check-release-publish-readiness.mjs` passes
  and the Changesets flow from the runsheet is wired.

## Session bootstrap checklist

1. Read CLAUDE.md invariants + [§1](../atrib-spec.md#1-attribution-record-format), [§5](../atrib-spec.md#5-sdk-specification) of atrib-spec.md before any code.
2. Read `redesign-upgrade-path.md` (this repo) for the target topology.
3. Run the existing corpora against a skeleton signer first (red → green).
4. Land TS consolidation before Python (Python then tests against the
   consolidated reference, not against three scattered implementations).
