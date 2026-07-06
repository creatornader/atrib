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
- **Build stateless-MCP-native (spec final 2026-07-28).** Target the
  post-stateless `@modelcontextprotocol/sdk` (no `initialize` handshake, no
  `Mcp-Session-Id`; per-request `_meta` carries version/identity/capabilities
  and W3C trace context). Never model MCP protocol sessions in the SDK:
  `context_id` and chain tokens are explicit per-request values (tool args or
  `_meta` per [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)), and
  anything resumable (recall pagination, pending approvals) is an explicit
  opaque handle the caller passes back, mirroring the spec's
  `requestState` / explicit-handle pattern. See the MCP-stateless section of
  [`redesign-upgrade-path.md`](redesign-upgrade-path.md).

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

## Session spawn prompt (paste as the first message of the SDK session)

> ultracode — You are starting the dedicated atrib SDK session planned by the
> redesign-analysis session on 2026-07-06. Mission: build the consolidated
> JS/TS client SDK and the first Python SDK.
> 1. `git fetch origin claude/atrib-redesign-analysis-4g0r9v && git checkout
>    claude/atrib-redesign-analysis-4g0r9v && git pull`, then work on a new
>    branch `claude/atrib-sdk-bootstrap` (never push to the redesign branch).
> 2. Read in order: `docs/atrib-sdk-session-brief.md` (your charter),
>    `docs/redesign-upgrade-path.md`, `docs/attest-recall-rename-impact.md`,
>    the CLAUDE.md invariants, and atrib-spec.md [§1](../atrib-spec.md#1-attribution-record-format) + [§5](../atrib-spec.md#5-sdk-specification).
> 3. Check `docs/adr-draft-p04x-*.md` and DECISIONS.md pending entries
>    P042-P049 — they refine this brief and take precedence over it.
> Then execute the bootstrap checklist: conformance corpora (1.2.6, 1.4,
> 1.2.3/multi-producer, 2.6.1) red-to-green against a skeleton signer first;
> TS consolidation before Python; Python ports `resolveChainRoot` bit-for-bit
> and produces byte-identical records. Respect the "What the SDK session
> should NOT do" list; publish nothing. Orchestrate with workflows where
> warranted (parallel corpus porters with adversarial byte-equality
> verifiers; TS/Python implementers with a cross-implementation determinism
> judge). Commit and push to `claude/atrib-sdk-bootstrap` per phase.

## Post-spawn addenda from the redesign session (2026-07-06, after P042-P050 landed)

Message to the SDK session — read this on your next pull of the upstream
branch. The P042-P050 candidate set landed at commit `2fe8b29` AFTER your
spawn prompt was written. Corrections and refinements that supersede the text
above where they conflict:

1. **Path correction:** the drafts are flat files `docs/adr-draft-p042-*.md`
   through `p049`, not a `docs/adr-drafts/` directory.
2. **Evidence types ([D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)):** model SDK evidence attachments on the envelope
   schema `{envelope, profile (type URI), profile_version, tier, payload
   hash/reference, facts, result, verifier}`. The legacy `protocol` string set
   freezes at today's five values; new evidence kinds are envelope profiles.
3. **Anchor API ([D138](../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture)):** `log_proofs` elements gain an optional
   `anchor_type` discriminator (absent = atrib-log; existing bundles parse
   unchanged). Design config as an anchor *set* with `allow_single_anchor:
   true` as the explicit escape hatch. Critical crypto note: Rekor/TSA
   anchoring uses a fresh anchoring signature over a reconstructible
   anchor-claim artifact — it can NOT reuse the record's own signature
   (record_hash covers the signature; Pure Ed25519 cannot sign digests). Do
   not design the anchor interface assuming signature reuse.
4. **Checkpoints ([D139](../DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized)):** treat `session_checkpoint` as an extension-URI
   event type for now (`https://atrib.dev/v1/types/session_checkpoint` under
   0xFF; normative byte 0x08 comes later — 0x07 stays reserved for handoff).
   Checkpoint object: `{session_root, tree_size, first_index,
   prior_checkpoint?, retroactive?}`; leaf rule reuses [§2.3.2](../atrib-spec.md#232-leaf-hash-computation) verbatim.
5. **Key API headroom ([D140](../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys)):** do NOT implement delegation certificates yet,
   but do not paint the API into a corner: signer construction should accept
   an optional certificate parameter later (depth-0 = today's behavior), and
   canonicalization code must tolerate a future OPTIONAL `delegation_cert_hash`
   genesis field (lex-slots between `creator_key` and `event_type`) as
   omitted-not-null.
6. **Rename mechanics ([P047](../DECISIONS.md#p047-attestrecall-verb-rename-and-primitive-surface-collapse)):** `content_id` derives from the frozen synthetic
   constant `mcp://atrib-emit` plus the event-type URI leaf — never derive
   content_id from the new verb names. `@atrib/recall` keeps its npm name;
   its `verification` parameter loads `@atrib/verify` as an optional peer
   dependency (lazy, typed unavailable-result when absent per [§5.8](../atrib-spec.md#58-degradation-contract)) — mirror
   that pattern.
7. **Payments boundary ([P048](../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core)):** payment detection must be an injectable
   detector set; a core-only SDK never classifies transactions and never
   blocks. Do not hard-wire the six protocol detectors into SDK core.
8. **Extension receipts ([D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)):** behind an opt-in flag, the SDK client should
   parse `dev.atrib/attribution` attestation receipts from `result._meta`
   (record hash/token + `log_submission` queue status).
9. **Coordination protocol:** the redesign session watches every push to
   `claude/atrib-sdk-bootstrap` and reviews each one; feedback arrives via
   the operator. Do not rebase away pushed history mid-review, and never
   push to `claude/atrib-redesign-analysis-4g0r9v`.

