# atrib spec [§2.11](../../../../atrib-spec.md#211-cross-log-replication) anchors conformance corpus

Test fixtures for the anchor interface and anchor plurality per spec
[§2.11](../../../../atrib-spec.md#211-cross-log-replication) (P043 anchor-plurality ADR, extending
[D050](../../../../DECISIONS.md#d050-cross-log-replication-for-equivocation-defense)).

The corpus is the shared contract between every implementation that
produces or consumes proof bundles whose `log_proofs` elements carry the
OPTIONAL `anchor_type` discriminator: `@atrib/verify`, `@atrib/mcp`
anchor fan-out, and any third-party implementation that asserts the
anchor-interface invariants. An *anchor* is a service that accepts a
32-byte SHA-256 hash and later yields an offline-verifiable proof that
the hash existed no later than an attested time; atrib log-nodes are the
richest conforming anchor, and `sigstore-rekor`, `rfc3161-tsa`, and
`opentimestamps` conform with existence-by-time semantics.

## Cases

| File | Asserts |
|---|---|
| `cases/legacy-single-log.json` | Backward compatibility. A `log_proofs` element with absent `anchor_type` MUST parse as `atrib-log` carrying the existing `(log_id, checkpoint, inclusion_proof)` triple, byte-for-byte unchanged. Verifies as `independent_count: 1`, `single_anchor: true`, `plurality_met: false` — and the record stays VALID. Single-anchor is a tier, never a failure. |
| `cases/discriminator-malformed-elements.json` | Discriminator rules. `anchor_type` present (registered, non-`atrib-log`) without `anchor_id` + `proof` is malformed (rule b); `anchor_type` absent without the legacy triple is malformed (rule a). Malformed elements are excluded from every count except `proof_count` / `malformed_count`; they never invalidate the record. |
| `cases/unknown-anchor-type.json` | Forward compatibility. Unknown `anchor_type` values MUST be surfaced in `unknown_types`, MUST NOT count toward plurality, and MUST NOT invalidate the bundle (same rule as unknown event types). |
| `cases/plurality-atrib-log-plus-rfc3161.json` | Plurality met: one `atrib-log` proof plus one `rfc3161-tsa` element whose `hashed_message_hex` binds the bundle's `record_hash` gives `independent_count: 2`, `plurality_met: true`, `single_anchor: false`. |
| `cases/rekor-anchor-claim.json` | The anchoring-signature claim artifact. A `sigstore-rekor` element whose entry body carries a FRESH Ed25519 signature over the reconstructible claim bytes `"atrib-anchor/v1:" + record_hash`. The anchoring key differs from `creator_key`. Claim binding, anchoring signature, RFC 6962 inclusion proof, checkpoint signature, and signed entry timestamp are all REAL and all verify. |
| `cases/rekor-claim-binding-mismatch.json` | Adversarial. A genuinely-signed anchor claim for a DIFFERENT record hash: the embedded signature verifies over its own artifact, but the artifact does not reconstruct from the bundle's `record_hash`, so the element is an invalid proof — not counted, not equivocation, record still valid on the remaining anchor. |
| `cases/record-signature-digest-path-invalid.json` | Why the record's own `signature` MUST NOT be reused as the anchoring signature. `record_hash` covers the COMPLETE record INCLUDING `signature` ([§1.2.3](../../../../atrib-spec.md#123-chain_root-for-genesis-records)), while the signature verifies over the signature-less form ([§1.4.2](../../../../atrib-spec.md#142-signing-procedure)); the vector proves `verify(sig, canonicalRecord(record))` is false while `verify(sig, canonicalSigningInput(record))` is true. Pure EdDSA additionally cannot be verified from a digest alone. |
| `cases/ots-pending-then-upgraded.json` | An `opentimestamps` proof with `status: "pending"` is carried, counted in `pending_count`, and excluded from plurality. The same bundle after in-place upgrade (`status: "complete"`) meets plurality. Bundle caching stays keyed by `record_hash` per [§5.3.5](../../../../atrib-spec.md#535-log-submission), which is what makes in-place upgrade safe. |
| `cases/same-operator-group.json` | Independence counts distinct operator groups, not elements. Two atrib logs declared in one group collapse to `independent_count: 1`; the default grouping (one group per distinct `(anchor_type, anchor_id)` pair) counts 2. |
| `cases/threshold-not-met.json` | [§2.11.4](../../../../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection) unchanged: M=2 with one trusted-set proof fires `cross_log_threshold_not_met` (hard rejection) even though `plurality_met` is true — threshold and tiering are orthogonal. Untrusted-set proofs are surfaced, not counted toward M. |
| `cases/equivocation-detected.json` | [§2.11.4](../../../../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection) unchanged: two trusted `atrib-log` proofs for the same `record_hash` with differing committed leaf bytes fire `cross_log_equivocation_detected` (hard rejection) and surface the disagreeing pair with both leaf hashes. |
| `cases/censorship-suspected.json` | [§2.11.4](../../../../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection) unchanged: a trusted log returning "record not found" inside the bundle epoch window while another trusted log holds a verified proof fires `cross_log_censorship_suspected` with the silent log identified. Flag, not rejection. |
| `cases/allow-single-anchor-config.json` | Producer posture. Zero-config resolves to the built-in two-anchor default set; explicit ≥ 2 configs are used as given; one anchor with `allow_single_anchor: true` is deliberate (no warning); one anchor without the flag warns with an `atrib:` prefix and writes the `_local.anchor_config` sidecar marker. Never a throw on the primary path, never disables signing ([§5.8](../../../../atrib-spec.md#58-degradation-contract)). |

## What is real, what is structural

All record signatures, anchoring-claim signatures, checkpoint signed
notes ([§2.4.3](../../../../atrib-spec.md#243-signed-note-format) format, including the
[§2.4.2](../../../../atrib-spec.md#242-log-signing-key-and-key-id) key-id computation), RFC 6962
Merkle roots, and inclusion proofs in this corpus are REAL — computed
from fixed seeds with Ed25519 and SHA-256, verifiable offline.

The `rfc3161-tsa` and `opentimestamps` payload interiors are
STRUCTURAL in this corpus revision: the commitment-binding fields
(`hashed_message_hex` / `commitment_hex`) are the real record hash and
MUST be checked, while the DER `TimeStampToken` and serialized `.ots`
bytes are labeled placeholder payloads. Full per-type cryptographic
vectors (bad DER signature, bad OTS Merkle path, clock edges) are a
planned corpus extension; implementations with real RFC 3161 / OTS
verifiers MUST additionally verify those payloads and treat a
cryptographic failure as an invalid proof.

The `sigstore-rekor` fixtures are fixture-shaped, not wire captures
from the public Rekor instance: the entry body is a flat JSON object
(`artifact_b64`, `kind`, `public_key_b64url`, `signature_b64url`) and
the signed-entry-timestamp input is the sorted-key JSON of
`{entry_body_b64, integrated_time_ms, log_index}`. The cryptography —
claim reconstruction, fresh Ed25519 anchoring signature, RFC 6962
inclusion, signed-note checkpoint, SET — is exactly the verification
discipline a production Rekor adapter performs.

## Generator

`packages/log-dev/scripts/generate-conformance-anchors.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-anchors.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce
byte-identical files. Regenerate when:

- the anchor registry gains a type or a registered type's proof payload
  schema changes
- the `anchor_plurality` annotation shape changes
- the [§2.11.4](../../../../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection)
  threshold/equivocation contract changes (it should not)
- canonical record format ([§1.2](../../../../atrib-spec.md#12-the-attribution-record) /
  [§1.3](../../../../atrib-spec.md#13-canonical-serialization)) changes
- a new test case is added

## Reference implementation

`packages/verify/test/conformance-anchors.test.ts` loads each case,
re-verifies every real signature and inclusion proof, computes the
`anchor_plurality` annotation with a reference implementation, and
asserts every expected field — including a two-run determinism check
per case ([§4.6](../../../../atrib-spec.md#46-the-calculation-algorithm)-style discipline).
Conforming third-party implementations SHOULD load the same fixtures
and assert the same invariants.

## Status

**Initial thirteen-case corpus shipped.** The cases collectively cover
the anchor-interface contract: legacy absent-discriminator
compatibility, discriminator malformation rules, unknown-type forward
compatibility, plurality tiering (`single_anchor` as signal, never
block), pending-proof exclusion and in-place upgrade, operator-group
independence, the fresh anchoring-signature claim artifact with the
digest-path impossibility proof, unchanged
[§2.11.4](../../../../atrib-spec.md#2114-verifier-side-threshold-and-equivocation-detection)
hard conditions, and the producer-side `allow_single_anchor` posture.
Future cases (full RFC 3161 DER and OTS crypto vectors, Rekor
`hashedrekord`-rejection wire captures, multi-anchor time-window edge
cases) can be added by extending the generator.
