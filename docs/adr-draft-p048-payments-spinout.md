# P048 candidate ADR draft: Payments profile spin-out from protocol core

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P048](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

Candidate set (cross-references between drafts resolve via this table):

| Pending | Key | Draft |
|---|---|---|
| P042 | evidence-envelope | [docs/adr-draft-p042-evidence-envelope.md](adr-draft-p042-evidence-envelope.md) |
| P043 | anchor-plurality | [docs/adr-draft-p043-anchor-plurality.md](adr-draft-p043-anchor-plurality.md) |
| P044 | session-checkpoint | [docs/adr-draft-p044-session-checkpoint.md](adr-draft-p044-session-checkpoint.md) |
| P045 | delegation-certificates | [docs/adr-draft-p045-delegation-certificates.md](adr-draft-p045-delegation-certificates.md) |
| P046 | atribd-daemon | [docs/adr-draft-p046-atribd-daemon.md](adr-draft-p046-atribd-daemon.md) |
| P047 | attest-recall-rename | [docs/adr-draft-p047-attest-recall-rename.md](adr-draft-p047-attest-recall-rename.md) |
| P048 | payments-spinout | [docs/adr-draft-p048-payments-spinout.md](adr-draft-p048-payments-spinout.md) |
| P049 | mcp-extension | [docs/adr-draft-p049-mcp-extension.md](adr-draft-p049-mcp-extension.md) |

---

# ADR draft: Payments profile spin-out from protocol core

**Status:** Draft (pre-ADR; promoted from the redesign-upgrade-path step 7 when acted on)

**Depends on:** the universal evidence envelope ADR (redesign step 4) landing first. This draft assumes the envelope is normative in core, and treats that ADR's envelope schema, tier enum, and profile-registration rule as the single normative source — this draft defines no evidence schema of its own.

**Extends:** [D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) (protocol-specific machinery lives outside the spec body), [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes) (cross-attestation stays core), [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) / [D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side) / [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence) (tiered evidence-block shape; authorization-evidence profiles that stay core).

## Context

atrib's spec body currently carries three bodies of payment-rail-specific material:

1. **Detection hooks.** [§1.7.1–§1.7.5](../atrib-spec.md#17-transaction-event-hooks) define, per rail, what byte pattern in a response constitutes a payment completion: ACP `status === "completed"` with an embedded order, UCP's `ucp.version` envelope discrimination, x402's `PAYMENT-RESPONSE` / legacy `X-PAYMENT-RESPONSE` headers, MPP's `Payment-Receipt`, AP2's successful CheckoutReceipt / PaymentReceipt ([D088](../DECISIONS.md#d088-ap2-v02-transaction-hook-is-the-successful-receipt)) and the a2a-x402 success-receipt rule. [§5.4.5](../atrib-spec.md#545-transaction-detection) specifies the SDK-side detection contract.
2. **Policy and calculation.** [§4](../atrib-spec.md#4-attribution-policy-format) in full: policy document format, default policy, publication/discovery, session negotiation, the [§4.6](../atrib-spec.md#46-the-calculation-algorithm) calculation algorithm, and the [§4.7](../atrib-spec.md#47-settlement-recommendation-document) settlement recommendation document.
3. **Payment-side verifier surface.** [§5.5.2](../atrib-spec.md#552-verifying-a-settlement-recommendation) settlement verification and the [§5.5.4](../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks) AP2 / Verifiable Intent check catalog.

This material churns on external schedules the protocol does not control. The record format, log format, and graph derivation have been byte-stable for months; meanwhile the x402 v1→v2 header rename, the AP2 v0.1→v0.2 hook change ([D088](../DECISIONS.md#d088-ap2-v02-transaction-hook-is-the-successful-receipt)), the UCP fork of ACP's wire shape, and a corrected MPP header misattribution each required edits to the core spec. Every such edit spends core-spec credibility on rail plumbing.

The 2026-07-06 clean-room redesign ([`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md), step 7) proposes moving all three bodies out of core into an independently versioned **atrib Payments Profile**, attached back through the step-4 universal evidence envelope. This is the only subtractive step in that plan — a subtraction of scope, not of bytes.

**The operator's constraint, made precise.** The core protocol must still *accommodate* payments. It does, through exactly three retained core elements, and the claim is structural:

- **The `transaction` event type stays core.** The URI and the 0x02 log-entry byte are normative vocabulary. Any rail, present or future, produces the same core record shape; the log entry format never learns rail names.
- **Cross-attestation stays core.** The ≥2-distinct-verified-signer-keys rule over the same canonical bytes ([D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)) is trust semantics about what makes a high-stakes multi-party record believable. It mentions no rail. It is the reason a transaction record means something without atrib certifying truth.
- **The evidence envelope stays core.** Receipts, mandates, JWTs, VCs, and verifier facts for any rail travel as envelope profiles ([§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks)-shaped blocks per [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)). The protocol accommodates payments precisely by knowing nothing specific about any payment protocol.

A payments-capable deployment is therefore "core + payments profile," and rail churn lands in the profile's version history, not the spec's.

**Why the spin-out is reversible.** The [§4.6](../atrib-spec.md#46-the-calculation-algorithm) calculation is a pure function: graph + policy → distribution, no network, no clock, no randomness (critical invariant 3). Its only input from the protocol is the [§3](../atrib-spec.md#3-graph-query-interface) fact layer, which does not move and — per the absolute fact/policy separation of [§3.6](../atrib-spec.md#36-implementation-notes) — has never returned weighted data. Moving [§4](../atrib-spec.md#4-attribution-policy-format) therefore moves a *consumer* of the graph, never a producer of facts. Re-attaching settlement later (or merging the profile back) requires zero change to any signed record, log entry, edge derivation rule, or deployed service. That reversibility is the proof that the original layering (invariant 6) was right; the spin-out is the layering made physical.

## Decision

Split the payment-rail material out of protocol core into an independently versioned **atrib Payments Profile**, consisting of a profile document, evidence-profile registrations that follow the evidence-envelope ADR's registration rule exactly, and a subpath package surface. Core retains the `transaction` event type, the cross-attestation rule, and the evidence envelope. No signed byte, log entry, or canonicalization rule changes.

## Mechanism

### Document split

Create `docs/payments-profile.md` (in-repo pending the P024 spec-hosting decision), versioned as `payments-profile vMAJOR.MINOR.PATCH` independently of the core spec. This is the relocated spec material — a profile *document*, distinct from the per-evidence-profile docs below, which follow the envelope ADR's `docs/evidence-profiles/<name>.md` convention.

**Moves into the profile document (content relocation, verbatim on first cut):**

| Leaves core | Content |
| --- | --- |
| [§1.7.1](../atrib-spec.md#171-acp-agentic-commerce-protocol)–[§1.7.5](../atrib-spec.md#175-ap2-and-a2a-x402) | Per-rail detection hooks (ACP, UCP, x402, MPP, AP2/a2a-x402) |
| [§4.2](../atrib-spec.md#42-policy-document-format)–[§4.5](../atrib-spec.md#45-session-negotiation) | Policy document format, default policy, publication/discovery, session negotiation |
| [§4.6](../atrib-spec.md#46-the-calculation-algorithm) | Calculation algorithm (invariants 3 and 7 travel with it, verbatim and still binding) |
| [§4.7](../atrib-spec.md#47-settlement-recommendation-document) | Settlement recommendation document |
| [§5.4.5](../atrib-spec.md#545-transaction-detection) | SDK transaction-detection contract |
| [§5.5.2](../atrib-spec.md#552-verifying-a-settlement-recommendation) | Settlement recommendation verification |
| [§5.5.4](../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks) | AP2 / VI evidence-check catalog (already an envelope profile post-step-4; ownership transfers to the payments profile, see below) |

**Stays in core:** the [§1.7](../atrib-spec.md#17-transaction-event-hooks) preamble and [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records); the `transaction` event type URI and 0x02 byte; [§4.1](../atrib-spec.md#41-purpose-and-position-in-the-protocol) (rewritten as a one-page "position of policy relative to the protocol" statement pointing at the profile); the evidence envelope; all of [§3](../atrib-spec.md#3-graph-query-interface); [§4.8](../atrib-spec.md#48-scope-boundaries)/[§1.8](../atrib-spec.md#18-scope-boundaries) with settlement-specific deferrals moved to the profile's own scope-boundaries section.

**Anchor stability rule:** moved sections are not renumbered away. Each vacated section number keeps a one-paragraph tombstone ("moved to payments-profile §N; this anchor is stable") so every published `atrib-spec.md#...` link in DECISIONS.md, READMEs, and external material keeps resolving.

### Envelope attachment

The envelope ADR (step 4) owns the envelope schema, the four-tier enum (`declared` | `shape` | `attested` | `verified`), and the registration rule for atrib-maintained profiles: flat URIs `https://atrib.dev/v1/evidence/<name>`, a profile doc at `docs/evidence-profiles/<name>.md`, and a conformance corpus at `spec/conformance/evidence-envelope/<name>/`, all landing in the same commit as the registration. This ADR registers two new evidence profiles under that rule, unamended:

- `https://atrib.dev/v1/evidence/payments-detection` — detection facts for a transaction record: which rail, which hook matched, receipt identity source (the [D095](../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) ladder outputs).
- `https://atrib.dev/v1/evidence/payments-settlement` — a [§4.7](../atrib-spec.md#47-settlement-recommendation-document) settlement recommendation document attached as evidence, by hash or archive reference.

**Profile boundary with authorization evidence (explicit):** the AP2 / VI evidence profile that the envelope ADR registers changes *ownership* to the payments profile — its URI, doc path, and corpus path are unchanged; only its normative owner becomes the payments-profile document (which absorbs [§5.5.4](../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks)). The OAuth/MCP, AAuth, and x401 evidence profiles are **not** payments evidence and do **not** move: they are authorization evidence per [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) / [D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side) / [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence) and remain core-registered standalone profiles. This matches the phase-1 package split below, which keeps them at the `@atrib/verify` root.

Example block on a transaction record's evidence, conforming to the envelope ADR's normative schema (that ADR is the source of truth for field names and the tier enum; only the two payments URIs are new here):

```json
{
  "profile": "https://atrib.dev/v1/evidence/payments-detection",
  "profile_version": "1.0.0",
  "tier": "verified",
  "facts": {
    "protocol": "AP2",
    "hook": "checkout_receipt",
    "receipt_identity_source": "ap2_receipt"
  },
  "payload": {
    "hash": "sha256:9f2c...",
    "ref": { "kind": "archive", "uri": "https://archive.atrib.dev/v1/evidence/9f2c..." }
  }
}
```

**Tier assignment (exact):** a producer attaching detection facts writes `tier: "declared"`. A verifier that shape-validates the block against the registered profile schema may raise it to `shape`. Only a verifier with the payments-detection profile loaded, re-running the hook match against retrievable payload material, reports `verified`. Note the distinction from [§8.7](../atrib-spec.md#87-adversarial-threat-model): "external evidence" there names a trust-stack *layer*, not a tier value; envelope blocks always carry one of the four enum tiers.

**Verifier precedence rule (exact):** for any record, `@atrib/verify` core runs, in order: (1) signature verification; (2) chain/context checks; (3) for `event_type = transaction`, the distinct-verified-signer count with `cross_attestation_missing` flagging per [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records); (4) per evidence block, if the block's `profile` URI is registered by a loaded profile module, run that profile's checks and emit typed facts with the tier it earns; otherwise report the block with `profile_unrecognized: true`, cap its tier at `declared` (the producer's claim, nothing more), and continue. An unrecognized profile MUST NOT invalidate the record or lower the signature/cross-attestation verdicts — signal, not block, exactly the [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) posture.

### Producer-side split

`signTransactionRecord()` and the `signers[]` mechanics stay in core packages ([D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation)/[D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes) are core because cross-attestation is core). What moves is the *classifier*: the six-rail detector set becomes an injectable option on the middleware init (`detectTransaction?: TransactionDetector[]`), with the payments profile package supplying the canonical set. Precedence: explicit caller-supplied detectors > profile default set (when the profile package is installed) > none. With no detectors installed, the SDK signs `tool_call` records only, never classifies, and never blocks — [§5.8](../atrib-spec.md#58-degradation-contract) applies unchanged: detector exceptions are caught, logged with the `atrib:` prefix, and the primary response is never affected. Log submission for transaction records remains non-blocking per [§5.3.5](../atrib-spec.md#535-log-submission) (critical invariant 4) regardless of where detection lives.

### Package surface

**Phase 1 (minor versions, this ADR):**

- `@atrib/agent`: detection moves to subpath export `@atrib/agent/payments`; root re-exports retained with deprecation JSDoc. No breaking change.
- `@atrib/verify`: `verifySettlementRecommendation`, the [§4.6](../atrib-spec.md#46-the-calculation-algorithm) calculation, and the AP2/VI check module move to `@atrib/verify/payments`; root re-exports retained. `verifyRecord`, cross-attestation counting, envelope dispatch, handoff, and the OAuth/AAuth/x401 evidence modules stay at the root (they are authorization evidence per [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence), not payments — the same boundary the envelope-attachment section draws for profile registration).

**Phase 2 (major versions, separately gated, not part of this ADR):** a standalone `@atrib/payments` package absorbs the two subpaths; root re-exports removed; `@atrib/agent` takes the detector set as an optional peer. Phase 2 follows [`docs/publishing-new-npm-package.md`](publishing-new-npm-package.md) and its own decision entry.

[D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) protocol adapters (registry/scanner/attribution, e.g. the x402 ecosystem scanner) are untouched and remain the *retrospective* surface; this ADR moves the *runtime* detection and settlement layer to sit beside them, outside core, completing the pattern [D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) started.

## Compatibility and migration

- **Existing signed records:** zero change. Every transaction record, `signers[]` array, `informed_by` reference, and 0x02 log entry verifies byte-identically. The JCS canonical form, token format, and genesis `chain_root` rules are untouched. No re-signing, no migration of the public log, no archive change.
- **Log entry format:** untouched; 0x02 remains `transaction` in the normative byte map. The [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) gate is not exercised — no event type is added or removed.
- **Published packages:** phase 1 is semver-minor for `@atrib/agent` and `@atrib/verify`; all existing imports keep working through root re-exports for at least one deprecation cycle. Changesets release notes name the subpath moves. `check-release-publish-readiness.mjs` needs no change until phase 2 introduces a new package.
- **Deployed services:** log-node, graph-node, directory-node, archive-node change nothing. Graph-node has never returned weighted data (invariant 6), so it has no payments coupling to remove. Explorer keeps rendering transaction records as actions; no view is settlement-shaped today, so DESIGN.md impact is limited to copy if a rail badge references spec section numbers.
- **Operator machines / dogfood substrate:** none of the seven cognitive primitives, the primitives runtime, SessionStart surfaces, or the mirror/sidecar conventions touch payments. No LaunchAgent, wrapper config, or `~/.atrib` state changes.
- **Old verifiers:** a pre-split verifier still verifies post-split records fully (nothing about record production changes). A post-split core-only verifier sees payments evidence blocks as `profile_unrecognized` at tier `declared` and still returns valid signature + cross-attestation verdicts — degraded facts, not broken verification, mirroring the `cross_attestation_missing` and anchor-count-1 tier-flag patterns.
- **Reversal path:** because [§3](../atrib-spec.md#3-graph-query-interface) facts and [§4](../atrib-spec.md#4-attribution-policy-format)-as-pure-function never interleave, merging the profile back into the spec body (or re-normativizing settlement) is a documentation and packaging change with no byte, corpus-vector, or service migration.

## Conformance-corpus plan

Two homes, matching the two kinds of conformance at play, plus ownership annotations on existing corpora:

**Envelope-registration corpora (per the envelope ADR's registration rule, same commit as registration):**

- **`spec/conformance/evidence-envelope/payments-detection/`:** (a) envelope blocks with the payments-detection profile loaded — hook facts re-verified against payload material, tier raised to `verified`, tampered payloads rejected; (b) *degradation family:* the same records verified with no payments profile loaded — signature valid, distinct-signer count and `cross_attestation_missing` semantics identical to today, each block reported `profile_unrecognized` at tier `declared` without invalidating the record; includes a duplicate-signer vector to re-pin the [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) no-inflation rule across the split.
- **`spec/conformance/evidence-envelope/payments-settlement/`:** a settlement-recommendation-as-evidence round trip — produce [§4.7](../atrib-spec.md#47-settlement-recommendation-document) doc → attach by hash → verify via profile → reject on tampered payload — plus tier-assignment and payload-reference cases.

**Payments-profile document corpus (rail detection is SDK behavior, not an envelope profile; this directory does not claim envelope registration):**

- **`spec/conformance/payments-profile/detection/`:** per-rail positive and negative vectors lifted from the current [§1.7](../atrib-spec.md#17-transaction-event-hooks) examples and `packages/agent` tests — ACP completed-with-order vs completed-without-order; UCP `ucp.version` discrimination against the ACP-identical body; x402 v2 `PAYMENT-RESPONSE` and legacy v1 header, case-insensitivity; MPP `Payment-Receipt` (and an x402/MPP header cross-contamination negative, pinning the corrected misattribution); AP2 v0.2 receipt hook with the v0.1 PaymentMandate fallback ([D088](../DECISIONS.md#d088-ap2-v02-transaction-hook-is-the-successful-receipt)); a2a-x402 requiring both `payment-completed` and a `success: true` receipt.

**Existing corpora, stable paths:**

- **`spec/conformance/4.6/` stays at its path** — corpus paths are stable identifiers referenced across DECISIONS and package tests. Its README gains an ownership header: vectors unchanged, normative owner is now the payments-profile calculation section. The determinism requirement (two runs, identical input, identical output) continues to be exercised from `@atrib/verify/payments` tests.
- **`spec/conformance/ap2-vi-crypto/`** ([D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus)-owned) is referenced by the profile, not moved — same stable-path rule as 4.6, and consistent with the AP2/VI ownership transfer keeping its registered corpus path unchanged.

Same-commit rule from the redesign doc applies: the ADR lands with the new corpus directories populated.

## Alternatives rejected

1. **Delete [§4](../atrib-spec.md#4-attribution-policy-format) and settlement outright.** Rejected. It forecloses settlement instead of relocating it, breaks the "protocol accommodates payments" position, and discards a working, conformance-tested pure function. Subtraction of scope must stay reversible; deletion is not.
2. **Keep everything in core, downgrade payments sections to informative.** Rejected. It changes the sections' authority without stopping the churn: every rail rename still edits the core spec document, and "informative" normative-looking detection rules invite divergent implementations with no profile version to pin against.
3. **Spin out the `transaction` event type and cross-attestation too.** Rejected. 0x02 is burned into every existing log entry's normative meaning, and the ≥2-distinct-signers rule is rail-agnostic trust semantics (any high-stakes bilateral action, e.g. the OpenETR transfer proofs, uses it). Moving them would change what existing commitments *mean* — the one thing this ADR must not do.
4. **Six per-rail profiles immediately.** Rejected as premature. The envelope's flat registry supports per-rail profile names already; splitting the *document and package* per rail multiplies release surfaces before any consumer asks for one rail without the others. Start with one profile document and two evidence profiles; per-rail splitting is a later, cheap refactor inside the profile.
5. **Pull the OAuth/AAuth/x401 authorization profiles into the payments profile for symmetry.** Rejected. [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence) (and [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)/[D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side)) classify them as authorization evidence — they gate *whether an action was authorized*, not *whether a payment completed* — and x401 explicitly is not payment detection. Grouping them under payments would re-couple authorization semantics to rail churn, the exact coupling this ADR removes.
6. **Amend the envelope ADR's registration rule to allow nested payments URIs and a payments-owned corpus tree.** Rejected. A single flat registry with one doc convention and one corpus home is the envelope's discoverability guarantee; nesting would make the payments profile a special case in the first commit after the rule lands. The profile *document* is the right place for payments-internal structure, not the registry namespace.
7. **Fold runtime detection into the [D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) protocol adapters.** Rejected. [D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters)'s layers (registry/scanner/attribution) are retrospective ecosystem observability with bulk-analytical access patterns; runtime detection sits on the hot path under the [§5.8](../atrib-spec.md#58-degradation-contract) latency and failure budget. Same reasoning [D027](../DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) itself used to keep them apart, in the other direction.
8. **Separate repo and governance for the profile now.** Rejected for sequencing. Repo/hosting questions belong to P024; moving files across repos before the envelope ADR and phase-1 packaging settle would churn every link twice.

## Doc-sync impact

- **`atrib-spec.md`:** tombstones at [§1.7.1](../atrib-spec.md#171-acp-agentic-commerce-protocol)–[§1.7.5](../atrib-spec.md#175-ap2-and-a2a-x402), [§4.2](../atrib-spec.md#42-policy-document-format)–[§4.7](../atrib-spec.md#47-settlement-recommendation-document), [§5.4.5](../atrib-spec.md#545-transaction-detection), [§5.5.2](../atrib-spec.md#552-verifying-a-settlement-recommendation), [§5.5.4](../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks); rewritten [§4.1](../atrib-spec.md#41-purpose-and-position-in-the-protocol); abstract untouched (protocol identity rule in CLAUDE.md: no commercial/payments framing changes in the abstract; "sits between identity and payment rails" remains true under core + profile).
- **New `docs/payments-profile.md`:** added to the repository-structure tree and the authoritative-docs table in CLAUDE.md.
- **New `docs/evidence-profiles/payments-detection.md` and `docs/evidence-profiles/payments-settlement.md`:** per the envelope ADR's registration rule; listed wherever that ADR indexes registered profiles.
- **`CLAUDE.md`:** "What this is" paragraph's "six payment protocols detected" claim re-sourced to the profile; critical invariants 3 and 7 annotated as traveling with the profile while remaining binding (or relocated — operator call, see open questions); key-technical-decisions rows for [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)/[D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes) unchanged; V2 deferrals list moves settlement webhook format, dispute mechanism, and multi-transaction session handling to the profile's deferrals. **Same-commit fix:** the sync-triggers quick-reference paragraph still says DOC-SYNC-TRIGGERS.md has "(52 rows)" while the file has ~64 data rows today; since this ADR adds a row there, correct the count (recount at integration) in the same commit.
- **`README.md`:** packages table (subpath exports noted; new package only at phase 2); any "six payment protocols" wording synced.
- **`ARCHITECTURE.md`:** payment-integration section rewritten as "core accommodates, profile implements".
- **`PRIOR-ART.md`:** payment-rails layer rows point at the profile document.
- **`DOC-SYNC-TRIGGERS.md`:** new row — "payments-profile document changed → profile version bump + README/ARCHITECTURE sync".
- **`scripts/check-doc-sync.mjs`:** extend `checkConformanceCorpusConsistency` for `spec/conformance/payments-profile/` and the two new `spec/conformance/evidence-envelope/` directories; extend the number-word checks with a "six payment protocols" check whose canonical source becomes the profile's rail enumeration; add a DOC-SYNC-TRIGGERS row-count check so the CLAUDE.md "(N rows)" claim can never drift again (per the repo's own extend-the-script guidance); `checkWorkspacePackages` / `checkPublishedPackageCount` unchanged until phase 2.
- **`DESIGN.md`:** only if explorer copy referencing spec section numbers for rails changes; state "no contract change" otherwise per the design-system rule.
- **`METRICS.md`:** no tier changes expected; settlement-related metrics (if any are added later) would be profile-scoped.

## Open questions (operator decisions)

- Do critical invariants 3 (pure-function calculation) and 7 (no thumb on the scale) stay listed in CLAUDE.md's core invariants with a 'travels with the payments profile' annotation, or relocate wholly into the payments-profile document?
- Should the payments-profile document live at docs/payments-profile.md now, or wait for the P024 spec-hosting decision and land directly at its hosted home to avoid a second link churn?
- Should the AP2 / VI evidence profile's ownership transfer be executed inside this ADR, or recorded in the evidence-envelope ADR (which performs the original registration) with this ADR only citing it?
- What concrete adoption signal gates Phase 2 (standalone @atrib/payments with root re-exports removed): a named external consumer of the payments subpaths, a fixed deprecation window, or both?
- Does the 'six payment protocols detected' count remain a CLAUDE.md hub-doc claim (with the profile as canonical source for the check-doc-sync number-word check), or is the count dropped from the hub doc entirely once detection is profile-owned?
- Does the protocol-identity line 'atrib sits between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP/AP2)' keep the explicit rail enumeration post-split, or generalize to 'payment rails (via the payments profile)'?
- Should the payments-detection profile's verified tier require re-running the hook match against retrievable payload bytes (Tier 2/3 archive or mirror access), or is shape-plus-hash binding sufficient for verified when the payload is withheld?
