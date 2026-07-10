# P043 candidate ADR draft: Anchor plurality as the default trust posture

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P043](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

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

# D0XX: Anchor plurality as the default trust posture

**Date:** (assigned at integration)

**Status:** Draft

**Extends:** [D050](#d050-cross-log-replication-for-equivocation-defense) (cross-log replication), [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default) (explicit opt-in escape-hatch pattern). Supersedes the blocked `cross_log_*` item in [P005](#p005-reconcile-atribverify-readme-per-record-annotations-with-actual-code-surface).

## Context

atrib's operator-level threat defenses already exist on paper. [§2.9](../atrib-spec.md#29-witnessing-and-cosignatures) witnessing secures checkpoint roots; [D050](#d050-cross-log-replication-for-equivocation-defense) / [§2.11](../atrib-spec.md#211-cross-log-replication) define record-level replication to multiple logs, a multi-proof `log_proofs` bundle shape ([§2.11.3](../atrib-spec.md#2113-proof-bundle-format-extension)), and a verifier threshold M with equivocation detection ([§2.11.4](../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection)). But three facts keep the trust claim terminating at one operator in practice:

1. **Replication is OPTIONAL with default M=1**, so the default posture is single-log.
2. **The only conforming anchor class is another atrib log-node.** Standing up a second *operator-independent* atrib log is a real deployment; nobody has done it, so [P005](#p005-reconcile-atribverify-readme-per-record-annotations-with-actual-code-surface)'s `cross_log_*` verifier surface stayed blocked on "when a second independent log node ships."
3. `@atrib/mcp` never shipped the `submitToLogs` extension [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)'s consequences anticipated; `@atrib/verify` has no multi-proof parsing (see the pending-annotations note at the top of [`packages/verify/src/verify-record.ts`](../packages/verify/src/verify-record.ts)).

The 2026-07-06 clean-room redesign analysis ([`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md) [§1](../atrib-spec.md#1-attribution-record-format)) identified the generalization that removes the blocker: the thing a verifier needs from a second log is not "another atrib log" but *any independently operated service that can prove a hash existed no later than time T*. Sigstore Rekor, RFC 3161 timestamping authorities, and OpenTimestamps all provide exactly that, today, free or near-free, with no atrib-side deployment. Generalizing "log" to "anchor" turns the missing second log from an ops project into an HTTP call.

**Constraint check.** This ADR changes no signed byte: attribution records ([§1.3](../atrib-spec.md#13-canonical-serialization)), the 90-byte log entry ([§2.3.1](../atrib-spec.md#231-entry-serialization)), and checkpoints are untouched. Proof bundles are post-signing artifacts stored alongside records ([§2.8](../atrib-spec.md#28-proof-bundle-format)). The apparent conflict between "SDK *requires* ≥2 anchors" and critical invariants 1 and 4 (atrib failures never affect the primary path; log submission is never awaited, [§5.8](../atrib-spec.md#58-degradation-contract) / [§5.3.5](../atrib-spec.md#535-log-submission)) is resolved explicitly in the Mechanism section: the requirement is a *configuration-time posture* plus a *verifier-side tier*, never a runtime block. A record whose anchoring entirely fails is still signed, still mirrored, still returned to the caller.

## Decision

1. **The spec defines a normative anchor interface** (new [§2.11](../atrib-spec.md#211-cross-log-replication) subsections). The current heading is "2.11 Cross-log Replication" with slug `#211-cross-log-replication`, linked today by [D050](#d050-cross-log-replication-for-equivocation-defense), CLAUDE.md, DOC-SYNC-TRIGGERS.md rows, and [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md). If the section is retitled (candidate: "Cross-log Replication and Anchor Plurality"), the same commit MUST add an explicit HTML anchor preserving `#211-cross-log-replication`. The fallback anchor is mandatory whenever the heading text changes at all, not a contingency. An *anchor* is a service that (a) accepts a 32-byte SHA-256 hash, (b) later yields a proof that the hash existed no later than an attested time, and (c) whose proof is verifiable offline by a pure function given only the anchor's published trust material. atrib log-nodes are the richest conforming anchor (inclusion + ordering + explorer surface); Sigstore Rekor, RFC 3161 TSAs, and OpenTimestamps conform with existence-by-time semantics.

2. **The existing `log_proofs` array is the wire shape for all anchors.** Elements gain an OPTIONAL `anchor_type` discriminator. Absence means `"atrib-log"` and the element MUST carry the existing `(log_id, checkpoint, inclusion_proof)` triple, so every existing bundle parses unchanged, byte-for-byte.

3. **SDK default posture is ≥2 independent anchors.** The zero-config default anchor set ships with two entries (log.atrib.dev plus one non-atrib anchor, choice below). Explicitly configuring fewer than two independent anchors requires `allow_single_anchor: true`, mirroring [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default)'s `allow_unresolved_informed_by`. Without the flag, a single-anchor config produces an `atrib:`-prefixed warning and a sidecar degradation marker; it never throws into the primary path and never disables signing ([§5.8](../atrib-spec.md#58-degradation-contract)).

4. **Verifier-side, anchor count 1 is a tier, not a failure.** `@atrib/verify` gains an `anchor_plurality` annotation with `single_anchor: true` when only one independent anchor verifies: signal not block, exactly like `cross_attestation_missing` ([D052](#d052-cross-attestation-requirement-for-transaction-records)) and `in_envelope: false` ([D051](#d051-capability-scoped-records-via-directory-published-envelopes)). Hard rejection remains reserved for the existing [§2.11.4](../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection) conditions: consumer-configured threshold M not met (M still defaults to 1) and equivocation detection.

5. **log.atrib.dev is one member of the anchor set.** It keeps the explorer, read APIs, SSE / JSON Feed surfaces ([D103](#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields)), and fast inclusion proofs; the product surface is unchanged. The protocol's trust claim no longer terminates at its operator.

## Mechanism

### Anchor interface (spec-level, normative)

An anchor type registration defines four things:

| Field | Meaning |
| --- | --- |
| `anchor_type` | Stable string identifier (see registry below) |
| Anchored message | Exactly which bytes the proof commits to, derived deterministically from `record_hash` |
| Proof payload schema | The fields inside the bundle element's `proof` object |
| Verification function | Pure function `(proof, record_hash, trust_material) → { valid, anchored_at_ms | null, pending }`; no network, deterministic, same discipline as [§4.6](../atrib-spec.md#46-the-calculation-algorithm) |

Initial registry (v1):

| `anchor_type` | Anchored message | Proof payload | Trust material | Time semantics |
| --- | --- | --- | --- | --- |
| `atrib-log` (default when absent) | 90-byte AtribLogEntry ([§2.3.1](../atrib-spec.md#231-entry-serialization)) embedding `record_hash` | existing `checkpoint` + `inclusion_proof` per [§2.11.3](../atrib-spec.md#2113-proof-bundle-format-extension) | log public key ([§2.4](../atrib-spec.md#24-checkpoint-format)) | checkpoint time + in-log ordering |
| `sigstore-rekor` | `rekord`-type entry over the *anchor-claim artifact*: the UTF-8 bytes of `"atrib-anchor/v1:sha256:" + hex(record_hash)`, signed by the anchoring party's Ed25519 key (a fresh anchoring signature, never the record's own `signature`; the anchoring key MAY be `creator_key` or any third party's key, since anchoring is permissionless) | `entry_uuid`, `log_index`, `entry_body_b64` (canonical Rekor entry body carrying content, anchoring signature, and anchoring public key), `inclusion_proof`, `checkpoint`, `signed_entry_timestamp_b64` | Rekor instance public key | `integrated_time` |
| `rfc3161-tsa` | `messageImprint.hashedMessage` = the raw 32 `record_hash` bytes, `hashAlgorithm` = SHA-256 | `timestamp_token_b64` (DER TimeStampToken) | TSA certificate chain / root | `genTime` |
| `opentimestamps` | the raw 32 `record_hash` bytes as the OTS commitment input | `ots_b64` (serialized .ots proof), `status: "complete" | "pending"` | Bitcoin block headers (via any header source the verifier trusts) | attested block time |

**Rekor design note (normative rationale).** The record's own `signature` cannot be anchored via Rekor's `hashedrekord` type, for two independent reasons. First, `record_hash` is computed over the JCS canonicalization of the COMPLETE record INCLUDING the `signature` field ([§1.2.3](../atrib-spec.md#123-chain_root-for-genesis-records) normative clarification), while the signature verifies over the signature-less canonical form ([§1.4.2](../atrib-spec.md#142-signing-procedure)). These are two different byte strings, so Rekor's upload-time check that the signature verifies over the artifact behind `data.hash` fails by construction. Second, atrib signatures are Pure EdDSA (RFC 8032 §5.1.6, no prehashing), which cannot be verified from a digest alone. The registry therefore uses a `rekord`-type entry whose full artifact bytes are deterministically reconstructible from `record_hash` (they reveal nothing beyond the commitment itself, preserving the [§8.3](../atrib-spec.md#83-salted-commitment-posture) posture), with a fresh anchoring signature over those bytes. Verification: reconstruct the anchor-claim artifact from `record_hash`; check the entry body's content matches and verify its embedded Ed25519 signature over the artifact; verify the inclusion proof against the checkpoint and the signed entry timestamp against the Rekor instance key. The `atrib-anchor/v1:` prefix domain-separates the anchoring signature from any canonical record (JCS records begin with `{`; the prefix makes the separation explicit rather than structural).

Unknown `anchor_type` values MUST be surfaced by verifiers but neither counted toward plurality nor treated as invalid (forward compatibility, same rule as unknown event types).

### Proof bundle extension ([§2.11.3](../atrib-spec.md#2113-proof-bundle-format-extension))

```jsonc
{
  "record_hash": "sha256:…",
  "log_proofs": [
    // legacy element, no discriminator ⇒ anchor_type "atrib-log"; parses exactly as today
    {
      "log_id": "log.atrib.dev",
      "checkpoint": "…",                    // C2SP-canonical signed note
      "inclusion_proof": ["sha256:…", "…"]
    },
    // non-tlog anchor element
    {
      "anchor_type": "rfc3161-tsa",
      "anchor_id": "freetsa.org",           // stable anchor identity, role of log_id
      "proof": {
        "timestamp_token_b64": "MIIC…",
        "gen_time_ms": 1751760031000
      }
    },
    {
      "anchor_type": "opentimestamps",
      "anchor_id": "opentimestamps-calendars",
      "proof": { "ots_b64": "AE9w…", "status": "pending" }
    }
  ]
}
```

Rules: (a) `anchor_type` absent ⇒ legacy triple REQUIRED, `proof` object forbidden; (b) `anchor_type` present and ≠ `"atrib-log"` ⇒ `anchor_id` + `proof` REQUIRED; (c) the array key stays `log_proofs`: renaming would break every existing bundle for zero semantic gain (the field name is a historical artifact, documented as such); (d) elements are unordered; (e) a `pending` proof (OTS awaiting Bitcoin attestation) is carried in the bundle and upgraded in place later; proof bundle caching stays keyed by `record_hash` per [§5.3.5](../atrib-spec.md#535-log-submission), which is what makes in-place upgrade safe.

### Independence

Two verified anchors are *independent* iff they fall in different operator groups. The verifier's trust configuration maps `(anchor_type, anchor_id)` → operator group; the default grouping is one group per distinct `(anchor_type, anchor_id)` pair. Two atrib log-nodes run by the same operator MUST be declared as one group by that operator's consumers; atrib maintains no central registry (same posture as [§2.11.5](../atrib-spec.md#2115-log-identity)). `independent_count` counts distinct groups among verified, non-pending proofs, mirroring [D052](#d052-cross-attestation-requirement-for-transaction-records)'s distinct-verified-keys counting rule.

### Producer-side (`@atrib/mcp` + anchor adapters)

Config:

```jsonc
{
  "anchors": [
    { "anchor_type": "atrib-log", "url": "https://log.atrib.dev/v1" },
    { "anchor_type": "opentimestamps", "calendars": ["https://a.pool.opentimestamps.org"] }
  ],
  "allow_single_anchor": false   // default
}
```

Precedence and behavior, exact:

1. No anchor config at all ⇒ the SDK's built-in default set (two anchors) applies. Zero-config users get plurality without opting in; this is how the "default requires ≥2" claim is made true without breaking anyone.
2. Explicit config with ≥2 entries ⇒ used as given.
3. Explicit config with 1 entry and `allow_single_anchor: true` ⇒ used as given, no warning; the deliberate-single-anchor analog of a deliberate dangling `informed_by` claim per [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default).
4. Explicit config with 1 entry and no flag ⇒ `atrib:` warning naming the missing plurality, sidecar `_local.anchor_config = { configured: 1, allow_single_anchor: false }`, operation continues. Never a throw on the primary path ([§5.8](../atrib-spec.md#58-degradation-contract)).

Submission fan-out is per-anchor fire-and-forget with independent retry queues; anchoring is never awaited before returning a response (invariant 4, [§5.3.5](../atrib-spec.md#535-log-submission)). A fully-failed anchor degrades the bundle to whatever proofs arrived; the record itself is unaffected. The atrib-log anchor keeps today's exact submission path ([§2.6.1](../atrib-spec.md#261-submit-entry)); non-tlog adapters are additive clients. Adapter code (ASN.1/DER for RFC 3161, OTS serialization, Rekor client) lives outside `@atrib/mcp`'s core dependency set; packaging is an open question (new `@atrib/anchor` package vs. optional-dep adapters).

### Verifier-side (`@atrib/verify`)

New always-populated annotation on `verifyRecord` when a bundle is supplied:

```jsonc
"anchor_plurality": {
  "proof_count": 3,               // elements in log_proofs
  "verified_count": 2,            // proofs whose pure-function verification passed
  "pending_count": 1,             // e.g. OTS status "pending"; not counted as verified
  "unknown_types": [],            // surfaced, not counted, not invalidating
  "independent_count": 2,         // distinct operator groups among verified
  "plurality_met": true,          // independent_count >= requiredAnchors (verifier option, default 2)
  "single_anchor": false,         // tier flag: independent_count == 1
  "equivocation_detected": false,
  "anchored_at_range_ms": [1751760000000, 1751760031000]  // min/max attested times; informational
}
```

Tiering when anchor count is 1: the record verifies as valid with `single_anchor: true` and `plurality_met: false`. No bundle at all ⇒ `anchor_plurality: null` (unanchored records are already a legitimate state; the log commitment is itself optional evidence). Hard rejection occurs only when (a) the consumer configured threshold M and `verified-in-trusted-set < M` (`cross_log_threshold_not_met`, M defaults to 1, unchanged from [§2.11.4](../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection)), or (b) equivocation is detected. Equivocation checks per pair: two `atrib-log` proofs compare leaf bytes exactly as today; any pair of anchors is additionally checked for anchoring the same `record_hash` (a TSA token whose `hashedMessage` differs from the bundle's `record_hash`, or a Rekor entry whose artifact bytes do not reconstruct from it, is simply an invalid proof, not counted). Time-window disagreement across anchors is informational (`anchored_at_range_ms`), never a rejection: anchors legitimately attest at different times.

This surface finally implements, and generalizes, the `cross_log_*` annotation that [P005](#p005-reconcile-atribverify-readme-per-record-annotations-with-actual-code-surface) left blocked; the "needs a second independent log node" blocker dissolves because the second anchor no longer needs to be an atrib log.

Fact/policy separation (invariant 6): anchors and their verification live entirely in bundles and verifier annotations. Nothing enters the graph layer ([§3](../atrib-spec.md#3-graph-query-interface)); no graph endpoint returns anchor-weighted or anchor-interpreted data. What a consumer *does* with `single_anchor: true` is consumer policy.

## Compatibility and migration

- **Existing signed records:** untouched. No canonical-form field, no signature input, no log entry byte changes. Records already committed to log.atrib.dev retroactively gain plurality the moment anyone (producer, host, or third party) anchors their `record_hash` to a second anchor and appends the proof to the bundle; anchoring is permissionless and post-hoc by construction (the Rekor anchor-claim signature is fresh, so no access to the original signing key is needed).
- **Existing proof bundles:** parse unchanged; verify as `independent_count: 1`, `single_anchor: true`, valid. No re-issuance required, ever.
- **Published packages:** `@atrib/mcp` gains the `anchors` config and fan-out (additive; absent config uses the new built-in default set, so the only observable behavior change for zero-config users is a second background submission). `@atrib/verify` gains `anchor_plurality` (additive annotation; existing outputs unchanged). Anchor adapters ship per the packaging decision (open question 1); if a new public package lands, [`docs/publishing-new-npm-package.md`](publishing-new-npm-package.md) applies.
- **Deployed services:** `services/log-node` requires no change: logs remain oblivious to replication per [D050](#d050-cross-log-replication-for-equivocation-defense). `services/archive-node` ([D070](#d070-record-body-archive-layer)) is unaffected: anchors attest the commitment, the archive serves bodies; the layers stay separate. The explorer (apps/dashboard) MAY later render anchor badges from bundle contents (a `DESIGN.md` backlog item, not a blocker).
- **Operator machines / dogfood:** the operator's producer configs flip from one anchor to two in a deliberate config change ([D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned)-style measured rollout: config, restart long-lived producers per the [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default) restart lesson, then verify-loop gate). Until flipped, existing configs warn per rule 4 above or are grandfathered by shipping the built-in default set; exact sequencing is open question 8.
- **Degradation contract:** every new producer-side path (anchor submission, retry, pending-upgrade, config warning) is catch-everything, `atrib:`-prefixed, silent-failure per [§5.8](../atrib-spec.md#58-degradation-contract). Anchor plurality can only ever *add* proofs; it can never block a tool call, a response, or a signature.

## Conformance-corpus plan

New corpus at `spec/conformance/2.11/anchors/` (creating the `2.11` directory [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) earmarked but never populated), generator in `packages/log-dev`, reference tests in `packages/verify`. Case families:

1. **Legacy compatibility:** single-log bundle without `anchor_type` ⇒ valid, `independent_count: 1`, `single_anchor: true`.
2. **Discriminator rules:** element with `anchor_type` + legacy triple (malformed); element without `anchor_type` missing the triple (malformed); unknown `anchor_type` ⇒ surfaced in `unknown_types`, not counted, not invalidating.
3. **Plurality:** atrib-log + RFC 3161 ⇒ `plurality_met: true`; two atrib-logs declared same operator group ⇒ `independent_count: 1`; OTS `pending` ⇒ counted in `pending_count`, excluded from plurality; the same bundle after in-place OTS upgrade ⇒ plurality met.
4. **Per-type verification vectors:** valid/invalid RFC 3161 token (bad signature, `hashedMessage` ≠ `record_hash`, truncated DER); valid/invalid OTS proof (bad Merkle path, wrong commitment input); valid/invalid Rekor `rekord` entry (artifact bytes that do not reconstruct from `record_hash`, bad embedded anchoring signature, bad signed entry timestamp, bad inclusion proof, wrong domain-separation prefix); clock edges (TSA `genTime` before record `timestamp` ⇒ informational flag, valid).
5. **Threshold and equivocation (ported from [§2.11.4](../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection)):** M=2 with one trusted-set proof ⇒ `cross_log_threshold_not_met`; two atrib-log proofs with differing leaf bytes ⇒ `cross_log_equivocation_detected`; proof + not-found-in-epoch ⇒ `cross_log_censorship_suspected`; untrusted-set proofs surfaced but not counted toward M.
6. **Determinism:** two verifier runs on identical bundle + trust config produce identical `anchor_plurality` output (the [§4.6](../atrib-spec.md#46-the-calculation-algorithm)-style two-run test).

Adversarial vectors follow the [D101](#d101-substrate-wide-adversarial-conformance-corpus) corpus conventions.

## Alternatives rejected

- **Mandate ≥2 anchors at the protocol level / invalidate single-anchor bundles.** Rejected: adoption barrier ([D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)'s own reasoning), and it would retroactively degrade every bundle ever issued. Tier-not-block is the established pattern ([D051](#d051-capability-scoped-records-via-directory-published-envelopes), [D052](#d052-cross-attestation-requirement-for-transaction-records)).
- **Block record submission until two anchors confirm.** Rejected outright: violates critical invariants 1 and 4 ([§5.8](../atrib-spec.md#58-degradation-contract), [§5.3.5](../atrib-spec.md#535-log-submission)). Plurality is a posture and a tier, never a gate on the primary path.
- **Reuse the record's own `signature` in a Rekor `hashedrekord` entry (`data.hash` = `record_hash`).** Rejected as cryptographically unimplementable, twice over: `record_hash` is computed over the complete record INCLUDING the `signature` field ([§1.2.3](../atrib-spec.md#123-chain_root-for-genesis-records) normative clarification) while the signature verifies over the signature-less canonical form ([§1.4.2](../atrib-spec.md#142-signing-procedure)), so Rekor's upload-time requirement that the supplied signature verify over the artifact behind `data.hash` fails by construction; and atrib signatures are Pure EdDSA (RFC 8032 §5.1.6, no prehashing), which cannot be verified from a digest alone regardless. Hence the registry's `rekord`-type entry over a reconstructible anchor-claim artifact with a fresh anchoring signature.
- **A sibling `anchor_proofs` array next to `log_proofs`.** Rejected: two arrays with overlapping meaning force merge/precedence rules on every verifier and split the equivocation-detection surface. One discriminated array with absence-defaulting keeps legacy bundles canonical.
- **Stand up a second atrib log-node as the second anchor.** Rejected as the *default* answer: a second node run by the same operator adds zero independence, and recruiting an independent atrib log operator is exactly the blocker that stalled P005 for months. It remains a fine anchor when it exists.
- **Model anchors as [D109](#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)-style evidence blocks (redesign step 4 envelope).** Rejected: evidence blocks attach externally verifiable material *about a record's semantics* at the record layer; anchors attest existence of the commitment itself and live in the [§2](../atrib-spec.md#2-merkle-log-protocol) proof-bundle layer. Collapsing them would push inclusion proofs into record semantics and couple this ADR to the envelope ADR's schedule. This boundary holds regardless of when the envelope ADR lands: anchors are not an envelope profile and take no schema from it.
- **Blockchain-native anchoring as a normative type of its own.** Rejected: OpenTimestamps already covers the Bitcoin path as one registered adapter; enshrining chains individually is registry bloat.
- **Renaming `log_proofs` to `anchor_proofs` in the bundle.** Rejected: breaks every existing bundle parser for a cosmetic gain; the name is documented as historical.

## Doc-sync impact

- **`CLAUDE.md`:** rewrite the "Cross-log replication is OPTIONAL" bullet in Key technical decisions (replication machinery generalizes to anchors; plurality is the default SDK posture with `allow_single_anchor` opt-out; single-anchor bundles remain valid); repository-structure tree gains `spec/conformance/2.11/anchors/` and, if a new package ships, its `packages/` row; workspace/public package counts update accordingly. The same commit MUST also fix the hub doc's stale "52 rows" claim about `DOC-SYNC-TRIGGERS.md` (the table currently carries 64 data rows), a pre-existing drift this ADR's DOC-SYNC edits would otherwise widen.
- **`DOC-SYNC-TRIGGERS.md`:** rows citing [§2.11](../atrib-spec.md#211-cross-log-replication) / cross-log replication update to the anchor vocabulary; new rows for the anchor registry (spec) → `@atrib/verify` README annotation table, and for the `spec/conformance/2.11/anchors/` corpus → generator/reference-test pairing.
- **`scripts/check-doc-sync.mjs`:** if `@atrib/anchor` ships as a package, the public-package-count and workspace-package-list checks must be extended in the same commit; a new number-word check for "four registered anchor types" wherever that claim lands; and (per the repo's extend-the-script guidance) a `DOC-SYNC-TRIGGERS.md` row-count check pinning the CLAUDE.md claim to the actual table, so the 52-vs-64 class of drift cannot recur silently.
- **`atrib-spec.md`:** [§2.11](../atrib-spec.md#211-cross-log-replication) gains the anchor interface, registry, and discriminator subsections (existing subsection anchors preserved). If the [§2.11](../atrib-spec.md#211-cross-log-replication) heading text is changed at all, an explicit HTML anchor preserving `#211-cross-log-replication` lands in the same commit (mandatory: the slug is linked by [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), CLAUDE.md, DOC-SYNC-TRIGGERS.md, and `docs/redesign-upgrade-path.md`). [§2.8](../atrib-spec.md#28-proof-bundle-format) cross-references the extended element shape; [§8.7](../atrib-spec.md#87-adversarial-threat-model)'s trust-stack layer 9 rewords "cross-log replication" to "anchor plurality."
- **`ARCHITECTURE.md`:** trust-model section updates: the trust claim terminates at the anchor set, not the log operator.
- **`PRIOR-ART.md`:** new rows for RFC 3161, Sigstore Rekor, and OpenTimestamps in the transparency/timestamping layer.
- **`DECISIONS.md`:** this ADR; [P005](#p005-reconcile-atribverify-readme-per-record-annotations-with-actual-code-surface) updated with a backlink marking the `cross_log_*` item superseded.
- **`DESIGN.md`:** backlog entry for explorer anchor badges (per-record anchor count/type from bundle contents); the explorer surface contract itself does not change in this ADR.
- **`README.md` / package READMEs:** `@atrib/verify` README gains the `anchor_plurality` annotation row (finally reconciling the P005 aspirational text); `@atrib/mcp` README documents the `anchors` config and default set.
- **`METRICS.md`:** candidate dogfood metric (fraction of newly committed records with `plurality_met`) enters the tiered framework at proposal state.

## Open questions (operator decisions)

- 1. Packaging for the non-tlog anchor adapters: a new public `@atrib/anchor` package (follows docs/publishing-new-npm-package.md, adds to the public package count) vs. optional-dependency adapters inside `@atrib/mcp`. The RFC 3161 DER and OTS serialization code should not enter `@atrib/mcp`'s core dependency set either way.
- 2. Which non-atrib anchor ships in the zero-config default set: OpenTimestamps (free, permissionless, but attestation completes on Bitcoin's schedule, so fresh bundles verify as pending) vs. the Sigstore public-good Rekor instance (fast integrated_time, but rate limits and retention/sharding policy are operator-controlled) vs. a specific RFC 3161 TSA (which one, and on what trust basis).
- 3. Whether to sequence this after the session-checkpoint event type (redesign item 2) so the default posture anchors one checkpoint root per interval instead of every record (a volume/courtesy question for public anchor infrastructure), or ship per-record anchoring now and thin it later.
- 4. Rekor anchor-claim signing key policy: default to the record's `creator_key` (zero-config, binds the creator to the anchoring act) vs. a dedicated anchoring key (key-use hygiene; also what third-party anchorers will use anyway). Includes whether the `atrib-anchor/v1:` domain-separation prefix is registered as a spec-level constant in [§2.11](../atrib-spec.md#211-cross-log-replication) or alongside the [§1.5](../atrib-spec.md#15-context-propagation) token constants.
- 5. Verifier default for `requiredAnchors`: flip to 2 immediately (new bundles from default-config producers will satisfy it, but every historical bundle reads `plurality_met: false`) vs. ship at 1 with a dated flip once dogfood metrics show plurality coverage.
- 6. Who owns the pending-proof upgrade loop for OpenTimestamps (producer-side retry queue, the [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) local substrate coordinator, or a standalone job), and whether upgraded bundles are re-pushed to the archive-node evidence surface.
- 7. Whether [D050](../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)'s status line is updated to 'extended by this ADR' or the cross-log-specific text is left intact with only the P005 backlink, i.e., how loudly the generalization is recorded in the decision log.
- 8. Operator dogfood rollout sequencing: grandfather existing single-anchor producer configs via the built-in default set, or force the explicit two-anchor config change (with long-lived producer restarts per the [D113](../DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default) lesson) before the verifier default flips.
