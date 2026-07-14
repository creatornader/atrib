# P042 candidate ADR draft: Universal evidence envelope: one tiered attachment model for all externally verifiable material

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P042](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

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

# DXXX: Universal evidence envelope: one tiered attachment model for all externally verifiable material

**Date:** (assigned at integration)

**Status:** Draft

**Extends:** [D094](../DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110](../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111](../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side), [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence), and [D134](../DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized). Source: [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md) step 4; this ADR lands first in that document's dependency order (4 → 1 → 2 → 3 → 5 → 6 → 7) and is the single schema source for the evidence sections of the later steps (see "Single source for the set" below).

## Context

atrib attaches externally verifiable material to signed records in four accreted shapes:

1. **Generic authorization evidence blocks** ([§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks), [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)): `{ protocol, valid, issuer, subject, scope, attenuation_ok, delegation_ok, constraints, errors, warnings, details }`, with `protocol` a bare string (`'oauth2' | 'mcp_oauth' | 'aauth' | 'ap2_vi' | string`) switch-cased inside `@atrib/verify`.
2. **AP2 / VI evidence** at the legacy `ap2_vi_evidence` field ([D089](../DECISIONS.md#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify)-[D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation)), mirrored into `evidence[]`.
3. **x401 proof evidence** ([D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence)/[D134](../DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized)) with its own sanitized `details` vocabulary (`proof_request_hash`, `payment_separation`, …).
4. **Material with no declared attachment shape at all**: human approvals are "a record under a human-controlled `creator_key`, or an archive / external evidence block" ([D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain), decision item 7); counterparty co-signature receipts that are external evidence per [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation); and the delegation certificates proposed by redesign step 3, whose stated carrier is "genesis record body, or as an evidence attachment per step 4" (i.e., this ADR).

The costs of the accretion: every new external system grows the `protocol` union and the spec body; producers ([D110](../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop)), the archive evidence API ([D111](../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [§2.12](../atrib-spec.md#212-record-body-archive-layer)), and the explorer each re-derive per-protocol sanitization rules; tier semantics ("what was actually checked") are implicit in per-adapter prose rather than a field; and there is no rule for third parties to define evidence types without a spec change. The clean-room redesign's conclusion stands: the protocol accommodates payments (and authorization, and approvals) precisely by knowing nothing specific about any of them.

The layer boundary from [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) is preserved verbatim: atrib does not issue credentials or decide who may act. Evidence describes what a verifier accepted about a signed action. Evidence never flips `verifyRecord().valid`.

## Decision

Declare one normative **evidence envelope** schema as the single protocol-level attachment model for all externally verifiable material, and make everything currently attached a **profile** of that envelope: OAuth/MCP introspection results, AAuth tokens, x401 proofs, AP2 / VI receipts, human approvals, counterparty co-signature receipts, and (forward) delegation certificates. Profiles are identified by type URI, version independently of the spec, and are registered under a documented rule. The `transaction` event type and the ≥2-distinct-signers cross-attestation rule ([D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)) stay in core: they are trust semantics, not protocol plumbing, and the envelope never substitutes for the `signers[]` array.

No signed byte of any existing or future record changes. Envelopes exist only in: (a) the local mirror sidecar ([§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape)), (b) the archive evidence projection ([§2.12](../atrib-spec.md#212-record-body-archive-layer)), (c) verifier results, and (d) host-owned packets (handoff, continuation, proof packets).

**Single source for the set (normative).** This ADR is the sole definition of the envelope schema, its field names, and the four-value tier enum for the entire redesign sequence. Dependent ADRs, delegation certificates (step 3) and the payments profile spin-out (step 7), MUST express their externally verifiable material as profiles of this envelope, using these exact field names and tier values. They MUST NOT define sibling attachment schemas, alternate tier vocabularies, or additional tier values; extending the tier enum requires revising this ADR, not a consumer ADR.

## Mechanism

### Envelope schema

One schema, normative, versioned by an integer `envelope` field:

```jsonc
{
  "envelope": 1,
  "profile": "https://atrib.dev/v1/evidence/oauth2",   // absolute HTTPS type URI
  "profile_version": "1.0.0",                          // semver of the profile document
  "tier": "verified",                                  // see tier ladder below
  "payload": {
    "hash": "sha256:9f2c…",                            // commitment to the raw evidence material
    "media_type": "application/jwt",                   // optional
    "ref": {                                           // optional; where the payload lives
      "kind": "mirror",                                // 'inline' | 'mirror' | 'archive' | 'external' | 'withheld'
      "uri": null,                                     // for 'archive' / 'external'
      "record_hash": null                              // sibling of kind, NOT a kind value; see ref.record_hash rule
    },
    "inline": null                                     // raw payload; ONLY when ref.kind === 'inline'; never public
  },
  "facts": {                                           // profile-defined verifier facts (flat JSON object)
    "issuer": "https://as.example",
    "subject": "agent-7",
    "scope": ["tools:read"],
    "attenuation_ok": true,
    "delegation_ok": null
  },
  "result": {
    "valid": true,
    "constraints": [
      { "type": "required_scope", "status": "passed", "expected": ["tools:read"], "actual": ["tools:read"] }
    ],
    "errors": [],
    "warnings": []
  },
  "verifier": {                                        // optional; who produced this envelope instance
    "name": "@atrib/verify",
    "version": "1.x.y",
    "checked_at_ms": 1780000000000
  }
}
```

TypeScript shape in `@atrib/verify` (`EvidenceEnvelope`), with `result.constraints[]` reusing the existing constraint shape from [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) unchanged (`status: 'passed' | 'failed' | 'unresolved' | 'not_checked'`).

**Payload hash rule.** `payload.hash` is `"sha256:" + hex(SHA-256(bytes))` where `bytes` is: the exact raw payload bytes for non-JSON media types (e.g. a compact JWT's UTF-8 bytes, a receipt JWT, an SD-JWT); `JCS(payload)` per RFC 8785 for JSON payloads. The profile document declares which rule applies per media type. This matches the existing sanitized-hash practice from [D134](../DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized) (`proof_request_hash` etc.) and the [§8.3](../atrib-spec.md#83-salted-commitment-posture) hash-not-body posture.

**`ref.record_hash` rule.** `record_hash` is not a `kind` value and never appears in the `kind` enum. It MAY accompany any `kind` (except `inline`, where it is redundant with the inline body): when set, it declares that the payload is itself a signed atrib record (`payload.hash` commits to that record's canonical JCS bytes), while `kind` still states where those bytes are retrievable (typically `mirror` or `archive`, or `withheld`). Profiles whose payload is a signed record (e.g. `human-approval` below) reference it exactly this way.

### Tier ladder

`tier` states how the party named in `verifier` established the claim, ordered by independent reproducibility:

| Tier | Name | Meaning |
| --- | --- | --- |
| 0 | `declared` | Payload hash and facts asserted by a producer or counterparty. Nothing checked. |
| 1 | `shape` | Payload parsed and structurally validated offline. No trust root exercised. |
| 2 | `attested` | A caller-owned external path accepted the material (introspection response per [D111](../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), credential-verifier `resultVerified` per [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence)/[D134](../DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized)). Not independently reproducible from the envelope alone. |
| 3 | `verified` | Cryptographically verified against declared trust roots (JWKS, pinned keys, pinned corpus per [D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus)). Reproducible by anyone with the envelope, the payload, and the same trust roots. |

**Tier rules (exact).** (1) A tier belongs to the envelope *instance*: it states what the `verifier` party did, not what is true. (2) A consumer MUST NOT relay another party's envelope with its own identity in `verifier` or with a raised tier; re-verification produces a new envelope instance. (3) A consumer re-running checks MAY produce a higher- or lower-tier instance than the one it received. (4) The identity key for deduplication is `(profile, payload.hash)`; multiple instances per key are permitted and consumers order by tier descending, then `checked_at_ms` descending, then verifier name. (5) A `tier: "verified"` envelope whose payload cannot be retrieved (ref `withheld`/unresolvable) is still well-formed; consumers report it as claimed-but-not-reproducible, mirroring the Tier 1/2/3 record-verifiability ladder of [D070](../DECISIONS.md#d070-record-body-archive-layer).

### Profile registration rule

A profile is registered by publishing, together:

1. **A type URI.** atrib-maintained profiles use `https://atrib.dev/v1/evidence/<name>`. Third parties use an HTTPS URI on a domain they control, the same self-sovereign convention as extension event_type URIs, deliberately below the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion bar because no event_type byte and no signed field is involved.
2. **A profile document** (for atrib-maintained profiles: `docs/evidence-profiles/<name>.md`) defining: accepted payload media types and the applicable hash rule; the `facts` vocabulary (each fact's name, JSON type, and provenance class: `verifier-derived`, `caller-attested`, or `producer-declared`); what each tier requires for this profile; the sanitization contract (which facts and hashes may appear in public projections; raw payloads never, by default, per [D110](../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop)/[D134](../DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized)); and its own semver rules. `profile_version` refers to this document, which versions independently of the spec.
3. **A conformance case family** at `spec/conformance/evidence-envelope/<name>/` in the same commit (atrib-maintained profiles only; third parties SHOULD publish equivalents).

**Unknown-profile handling (normative).** Consumers MUST preserve envelopes whose profile URI they do not recognize, MUST render them opaquely (URI, tier, payload hash), MUST NOT drop them, and MUST NOT let them affect record validity, the same posture as unknown extension event types.

**Legacy `protocol` strings are frozen (normative).** The pre-envelope `protocol` string set is closed at exactly the five values shipped today in `@atrib/verify` (`'oauth2'` and `'mcp_oauth'` in `packages/verify/src/authorization-evidence.ts`, `'aauth'` in `aauth-evidence.ts`, `'x401'` in `x401-evidence.ts`, `'ap2_vi'` in `verifier.ts`/`verify-record.ts`). After this ADR lands, no new legacy protocol string may be introduced anywhere in the substrate: not in `@atrib/verify`, not in producers, and not in later redesign-sequence ADRs. Every new evidence type, including the step-3 delegation certificates (whose profile URI `delegation-certificate` is reserved below), registers as an envelope profile. The legacy-to-profile mapping table in `fromLegacyEvidenceBlock` is therefore complete and final at five rows; a sixth row is a conformance failure, not an extension point.

**Initial registry** (spec carries one table; detail moves to the profile docs): `oauth2`, `mcp-oauth`, `aauth`, `x401`, `ap2-vi` (the four-plus-one existing adapters, mapped 1:1 from today's `protocol` strings); `human-approval` ([D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain) item 7; the payload is the human-signed approval record itself: `payload.ref.record_hash` names it per the `ref.record_hash` rule above, `ref.kind` is `mirror`, `archive`, or `withheld` per where its body is retrievable, and `payload.hash` commits to its canonical bytes; facts: approver key, approval scope, decision); `counterparty-attestation` (out-of-band co-signature receipts that are external evidence per [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation)/[D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)); and `delegation-certificate` (URI reserved; semantics defined by the redesign step-3 ADR, which MUST build on this envelope rather than introducing a new legacy protocol string).

### Carriage and precedence

Envelopes attach at four positions, all outside signed bytes:

1. **Producer sidecar**: `_local.evidence[]` per [§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape). The [D110](../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop) capture path emits envelope form; `payload.inline` is permitted here (local-only).
2. **Archive projection**: archive-node `/v1/evidence` serves envelopes with `payload.inline` stripped and `ref.kind` rewritten to `archive` or `withheld` per the profile's sanitization contract.
3. **Verifier results**: `verifyRecord()` and `AtribVerifier.verify()` return envelope instances the verifier itself produced.
4. **Host-owned packets**: handoff claims ([D105](../DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance)), continuation packets, action-gate packets ([D133](../DECISIONS.md#d133-action-gate-is-a-host-owned-controlproof-package)), and proof packets carry envelopes as their evidence sections.

Envelopes are never carried in propagation tokens (`tracestate` size budget, [§1.5.2](../atrib-spec.md#152-http-transport-tracestate)) and never enter the 90-byte log entry.

**Deliberate commitment path.** A producer that wants the *signed record* to commit to evidence uses existing mechanisms only: include `{ profile, payload_hash }` in the content hashed into `args_hash` (per the [D099](../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash) default) or emit a [D133](../DECISIONS.md#d133-action-gate-is-a-host-owned-controlproof-package)-style extension record referencing the envelope and linked via `informed_by`. This ADR adds **no** signed-record field. (Noted for the record: a future optional `evidence_hash` field would slot lexicographically after `event_type` and before `informed_by` under [§1.3](../atrib-spec.md#13-canonical-serialization); it is explicitly deferred, not designed here.)

### Invariant conflict resolution

- **Fact/policy separation ([§3.6](../atrib-spec.md#36-implementation-notes)).** `result.valid` and `facts` are verification facts, not weights. graph-node never stores, derives from, or serves envelopes; the [§4.6](../atrib-spec.md#46-the-calculation-algorithm) calculation takes no envelope input. Edge derivation ([§3.2.4](../atrib-spec.md#324-edge-derivation-rules)) is untouched.
- **[D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) cross-attestation.** The `signers[]` array over canonical transaction bytes remains the only way to satisfy the ≥2-distinct-keys rule. The `counterparty-attestation` profile carries receipts *about* attestation; a verifier that sees only such an envelope still reports `cross_attestation_missing: true`.
- **[§5.8](../atrib-spec.md#58-degradation-contract).** Every producer-side envelope writer is catch-all, silent-failure, `atrib:`-prefixed logging; a failed envelope construction drops the envelope, never the record or the primary tool response.
- **[§8.3](../atrib-spec.md#83-salted-commitment-posture) / [§8.7](../atrib-spec.md#87-adversarial-threat-model).** Public surfaces carry hashes and sanitized facts only. The envelope is the concrete shape of threat-model layer 7 ("external evidence"). It does not certify truth; it records what a named verifier accepted.

## Compatibility and migration

- **Existing signed records:** zero change, byte-for-byte. Envelopes attach retroactively to any record ever signed; a legacy record with no envelopes verifies exactly as today.
- **Published packages:** `@atrib/verify` adds `EvidenceEnvelope`, `toEvidenceEnvelope()` / `fromLegacyEvidenceBlock()` (deterministic mapping: `protocol` → profile URI via the fixed, frozen five-row table above; `issuer`/`subject`/`scope`/`attenuation_ok`/`delegation_ok` → `facts`; `valid`/`constraints`/`errors`/`warnings` → `result`; `details` → profile facts or payload ref) and returns `evidence_envelopes[]` alongside the unchanged legacy `evidence[]` and `ap2_vi_evidence` fields for at least two minor versions; removal of legacy fields requires a major. Because the legacy `protocol` set is frozen, this mapping table never grows: any evidence type not in the table exists only in envelope form. `@atrib/mcp` (and transitively `@atrib/mcp-wrap`, `@atrib/agent`) writes sidecar evidence in envelope form and keeps writing the [D110](../DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop) legacy sidecar shape during the same window. All changes ship as minor releases.
- **Deployed services:** archive-node's `/v1/evidence` response adds `envelopes[]` beside the existing projection (additive; same route); log-node, graph-node, directory-node untouched; the explorer gains one generic envelope card (profile URI, tier badge, facts table, payload hash) replacing per-protocol rendering over time.
- **Operator machines:** existing `~/.atrib` sidecar JSONL files remain readable forever; recall/trace/summarize read both shapes; no state rewrite, no re-signing, no key or mirror migration. [D084](../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) instrumentation join keys are unchanged.
- **Spec:** [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) is restructured: the envelope schema, tier ladder, registration rule, legacy-string freeze, and registry table become the normative core; per-adapter verifier prose migrates to `docs/evidence-profiles/<name>.md`. Existing `spec/conformance/5.5.6/*` and `spec/conformance/ap2-vi-crypto/` corpora remain authoritative for profile internals and are referenced, not moved.
- **Downstream redesign ADRs:** steps 3 (delegation certificates) and 7 (payments profile spin-out) attach their material through this envelope, per the "Single source for the set" rule in the Decision. Any draft of those ADRs that carries a different evidence field vocabulary, a tier value outside the four-value enum, or a new legacy protocol string must be rewritten against this schema before acceptance.

## Conformance-corpus plan

New directory `spec/conformance/evidence-envelope/`, consumed by `packages/verify` tests and `services/archive-node` tests, following the pinned-offline pattern of [D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus) and [D101](../DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus). Case families:

1. `shape/`: minimal valid, maximal valid, missing required fields, invalid tier value, invalid hash prefix, `inline` present with non-`inline` ref kind, `record_hash` misuse as a `kind` value (must be rejected), unknown-profile preservation (must round-trip untouched).
2. `hashing/`: raw-bytes hashing for `application/jwt`; JCS hashing for JSON payloads; hash-mismatch detection cases; `record_hash`-referenced payload whose `payload.hash` does not match the record's canonical bytes.
3. `tier/`: one fixture payload emitted at all four tiers; relay-without-reverify violation (verifier identity swap must be rejected by the reference checker); claimed-`verified`-with-withheld-payload reported as not-reproducible.
4. `legacy-mapping/`: round-trip fixtures for `oauth2`, `mcp_oauth`, `aauth`, `x401`, `ap2_vi` legacy blocks against pinned inputs drawn from `spec/conformance/5.5.6/{oauth,aauth,x401}/` and `spec/conformance/ap2-vi-crypto/`; two implementations must produce identical envelopes; an adversarial case with an unknown legacy protocol string (e.g. a hypothetical `atrib_delegation`) that the mapping helper MUST reject rather than silently inventing a profile URI (the executable form of the legacy-string freeze).
5. `sanitization/`: public-projection cases per profile: `inline` stripped, non-public facts removed, hashes preserved; leakage-detection adversarial cases (raw JWT in facts, token in details).
6. `registry/`: fixture third-party profile URI handling; `profile_version` bump with unchanged facts; profile URI that collides with an atrib name on a foreign domain.
7. Profile subdirectories `oauth2/ mcp-oauth/ aauth/ x401/ ap2-vi/ human-approval/ counterparty-attestation/` seeded in the same commit as each profile doc.

## Alternatives rejected

- _Keep growing the [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) `protocol` string union._ Rejected. Each new system re-touches `@atrib/verify` internals, the spec body, producers, the archive projection, and the explorer; third parties cannot define evidence types at all; tier and sanitization semantics stay implicit prose. The freeze above makes this rejection enforceable rather than aspirational.
- _Add a `record` value to the `ref.kind` enum instead of the sibling `record_hash` field._ Rejected. "The payload is a signed atrib record" and "where the payload bytes are retrievable" are orthogonal facts (a record-payload can live in a mirror, in the archive, or be withheld), so folding them into one enum would force a `record` kind to duplicate the retrievability axis. The sibling field keeps one axis per field; the `shape/` corpus pins the invalid `kind: "record"` spelling as a rejection case.
- _Put envelopes (or an evidence hash) into the signed record now._ Rejected. Evidence arrives before, during, and after signing, from parties other than the producer; freezing it into signed bytes would either race the action path (violating [§5.8](../atrib-spec.md#58-degradation-contract)) or force re-signing. The deliberate-commitment path via `args_hash` / extension records already exists; an optional signed field is deferred until demand.
- _Make low-tier or invalid envelopes affect `verifyRecord().valid`._ Rejected, re-affirming [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks): a signed action is real even when its external evidence is missing, expired, over-scoped, or forged. Consumers apply their own policy over tiers.
- _Adopt an external envelope standard (W3C VC wrapper, C2PA assertion, in-toto attestation) instead of defining one._ Rejected for v1. Each imports a canonicalization and signing stack orthogonal to atrib's JCS/Ed25519 core, and none natively expresses caller-attested-vs-locally-verified tiers over hash-referenced payloads. Any of them can be *carried as a payload* by a profile, which is the correct interop seam (see the [§1.8](../atrib-spec.md#18-scope-boundaries) interoperability roadmap).
- _Move the cross-attestation rule and transaction event type into a payments profile too._ Rejected. [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)/[D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes) are trust semantics over canonical record bytes, exactly the thing that must not vary per profile. The step-7 spin-out subtracts detection and settlement schemas, not signer rules.
- _Register profiles through the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) event_type gate._ Rejected. That gate protects a scarce resource (the 1-byte event_type space and normative record semantics). Profile URIs are not scarce and never touch signed bytes; a lighter documented rule with a conformance requirement is proportionate.

## Doc-sync impact

- **DECISIONS.md:** this entry; retire the corresponding P-entry; the hub summary line in `CLAUDE.md`'s DECISIONS.md row.
- **CLAUDE.md:** new "Key technical decisions" bullet ("The evidence envelope is the single attachment model for external material; profiles version independently; the legacy protocol-string set is frozen at five; envelopes never enter signed bytes or flip record validity"); repository-structure rows for `spec/conformance/evidence-envelope/` and `docs/evidence-profiles/`.
- **atrib-spec.md:** restructured [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) (envelope schema, tier ladder, registration rule, legacy-string freeze, registry table); per-adapter prose moves to profile docs.
- **ARCHITECTURE.md:** trust-model section: layer 7 ("external evidence") of the [§8.7](../atrib-spec.md#87-adversarial-threat-model) stack now names the envelope.
- **Package READMEs:** `packages/verify/README.md` (envelope API, mapping helpers, deprecation window, frozen legacy-string table), `packages/mcp/README.md` (sidecar envelope capture), `services/archive-node` README (`envelopes[]` in the evidence response).
- **DESIGN.md:** explorer generic envelope card (profile URI, tier badge, facts table) replaces per-protocol evidence rendering, a product-surface contract change updated in the same commit per the design-system rule.
- **DOC-SYNC-TRIGGERS.md:** new row: "Evidence profile registered → spec registry table + `docs/evidence-profiles/<name>.md` + `spec/conformance/evidence-envelope/<name>/` in the same commit." The hub-doc row count in `CLAUDE.md` ("52 rows") is already stale against the file (~64 data rows today); the commit adding this row corrects the count.
- **scripts/check-doc-sync.mjs:** two new mechanical checks: (1) the registered-profile count in the spec registry table must equal the `docs/evidence-profiles/` entry count and the profile-family directory count under `spec/conformance/evidence-envelope/`; (2) the `CLAUDE.md` DOC-SYNC-TRIGGERS row-count claim must equal the file's actual data-row count, per the repo's extend-the-script guidance, so the count can never silently drift again. A third check pinning the legacy `protocol` mapping table at exactly five entries is optional but cheap.
- **docs/redesign-upgrade-path.md:** mark step 4 accepted; point steps 3 and 7 at this ADR as their normative evidence schema and record the legacy-string freeze so neither introduces a new protocol string.

## Open questions (operator decisions)

- Deprecation window: is two minor versions of @atrib/verify carrying both evidence[] and evidence_envelopes[] the right window, or should removal be pinned to a date/major independent of release cadence?
- Profile URI hosting: should https://atrib.dev/v1/evidence/<name> URIs resolve (serve the profile document) or remain pure identifiers like extension event_type URIs? Resolving them creates an availability dependency the offline-verification posture otherwise avoids.
- ref.record_hash vs a 'record' ref.kind: this draft keeps record_hash as a sibling field combinable with any retrievability kind (rejected-alternatives section explains why); confirm the operator prefers that over extending the kind enum, since the shape corpus pins whichever spelling is chosen.
- Enforcement locus for the legacy protocol-string freeze: conformance-corpus rejection case only, an additional check-doc-sync.mjs guard on the five-row mapping table, or a closed TypeScript union in @atrib/verify with no trailing '| string' (a breaking type change for any out-of-tree consumers using custom strings today)?
- Human-approval profile depth: does [D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)-style approval evidence stay envelope-only, or does the approval decision eventually warrant its own event_type through the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) gate (which would change the profile's payload from observation-record reference to a dedicated record type)?
- Should the deferred optional signed evidence_hash field get a placeholder P-entry now (like [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)'s reserved byte pattern) or wait for concrete demand?
- Tier granularity: is four tiers enough for delegation certificates (step 3), where 'verified against principal key' and 'verified including revocation freshness' differ materially, or should that distinction live in profile facts rather than new tiers (this ADR's closed-enum rule forces the facts route unless revised)?
- Explorer migration pacing: does the generic envelope card replace per-protocol rendering in one release, or do the five existing profiles keep bespoke cards behind the generic one during the deprecation window (DESIGN.md contract either way)?
