# atrib spec [§5.5.7](../../../atrib-spec.md#557-universal-evidence-envelope) conformance corpus

Test fixtures for the universal evidence envelope per spec
[§5.5.7](../../../atrib-spec.md#557-universal-evidence-envelope) (the
P042 evidence-envelope ADR, extending
[D109](../../../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks)).

The corpus is the shared contract between every implementation that
produces, relays, projects, or consumes evidence envelopes. It is used by
`@atrib/verify`, producer-side sidecar writers, the archive evidence
projection ([§2.12](../../../atrib-spec.md#212-record-body-archive-layer)),
and any third-party implementation that asserts the
[§5.5.7](../../../atrib-spec.md#557-universal-evidence-envelope) invariants.
Profile-internal semantics (JOSE, JWKS, SD-JWT, DPoP, x401 headers) are NOT
re-pinned here; they remain authoritative in
`spec/conformance/5.5.6/{oauth,aauth,x401}/` and
`spec/conformance/ap2-vi-crypto/`.

## Case families

| Family | Asserts |
|---|---|
| `shape--*` | Envelope schema validity: required fields, the closed four-value `tier` enum, the closed five-value `ref.kind` enum, the `sha256:` hash format, `inline` only under `ref.kind: "inline"`, and the `ref.record_hash` sibling rule (`record` is NOT a `kind` value). |
| `registry--*` | Profile registration rule: profile type URIs MUST be absolute HTTPS URIs; atrib-maintained names live under `https://atrib.dev/v1/evidence/<name>`; profile identity is the full URI, so a foreign domain reusing an atrib name is a third-party profile. |
| `unknown-profile--*` | Unknown-profile preservation: consumers MUST preserve unrecognized envelopes untouched (pinned by a JCS round-trip hash), MUST render them opaquely (URI, tier, payload hash), and MUST NOT drop them. |
| `legacy-mapping--*` | The frozen legacy [§5.5.6](../../../atrib-spec.md#556-generic-authorization-evidence-blocks) `protocol` string set (`oauth2`, `mcp_oauth`, `aauth`, `x401`, `ap2_vi`) maps deterministically to envelope form; two independent implementations MUST produce identical envelopes; a sixth protocol string MUST be rejected. |
| `tier--*` | Tier semantics: the tier belongs to the envelope instance, relaying under a swapped verifier identity is a violation, `verified`-with-withheld-payload reports as claimed-but-not-reproducible, and evidence NEVER flips `verifyRecord().valid`. |
| `continuation-packet--*` | The ninth atrib-maintained profile ([D142](../../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions)): the continuation packet a baton-pass record hands to a successor. Raw-bytes hash rule for markdown packets, the `record_hash` sibling spelling for signed baton records, profile-level hash-mismatch rejection, and the private-body sanitization posture. |
| `payments-detection--*` | The tenth atrib-maintained profile ([P048](../../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core), owned by the [payments profile §12](../../../docs/payments-profile.md#12-evidence-profiles)): rail detection facts on a transaction record. JCS hash rule for detection material, hash-mismatch rejection, the no-payments-profile degradation posture (`profile_unrecognized` at tier `declared` with record verdicts unchanged), and a [D052](../../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) duplicate-signer re-pin across the profile split. Hook re-verification semantics live in `spec/conformance/payments-profile/detection/`, not here. |
| `payments-settlement--*` | The eleventh atrib-maintained profile ([P048](../../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core), owned by the [payments profile §12](../../../docs/payments-profile.md#12-evidence-profiles)): a settlement recommendation document attached as evidence by hash. JCS hash rule, tampered-document rejection, and the hash-only public posture for withheld documents. Recalculation semantics live in `spec/conformance/4.6/`, not here. |

## Cases

| File | Asserts |
|---|---|
| `cases/shape--minimal-valid.json` | Smallest well-formed envelope. `facts`, `verifier`, `media_type`, `inline`, `ref.uri`, `ref.record_hash` are OPTIONAL. MUST accept. |
| `cases/shape--maximal-valid.json` | Every optional field populated, including an inline payload under `ref.kind: "inline"`. `payload.hash` = sha256(JCS(inline)). MUST accept. |
| `cases/shape--missing-tier.json` | Required field omitted. MUST reject the envelope (never the record). |
| `cases/shape--missing-payload-hash.json` | `payload.hash` is required. MUST reject. |
| `cases/shape--invalid-tier-value.json` | `tier: "trusted"` is outside the closed enum. MUST reject. |
| `cases/shape--invalid-hash-prefix.json` | A genuine SHA-512 digest under a `sha512:` prefix. MUST reject on the `sha256:` format rule. |
| `cases/shape--inline-with-non-inline-ref.json` | `inline` present while `ref.kind` is `mirror`. MUST reject. |
| `cases/shape--record-kind-rejected.json` | `ref.kind: "record"` misuse. `record_hash` is a sibling field, not a `kind` value. MUST reject on the kind enum. |
| `cases/shape--record-hash-sibling.json` | Correct record-payload spelling: `ref.record_hash` names a real Ed25519-signed record, `ref.kind` states retrievability, `payload.hash` = sha256(JCS(record)). MUST accept; the record's signature verifies independently. |
| `cases/registry--atrib-profile-registered.json` | `https://atrib.dev/v1/evidence/oauth2` is atrib-maintained and registered. |
| `cases/registry--third-party-profile.json` | Third parties use an HTTPS URI on a domain they control; no atrib registration step exists. Accept, treat as unknown-preserve. |
| `cases/registry--non-https-profile-rejected.json` | `http://` profile URI. MUST reject. |
| `cases/registry--bare-name-profile-rejected.json` | A bare name (`oauth2`) is not a type URI. MUST reject. |
| `cases/registry--foreign-domain-collision.json` | `https://example.com/v1/evidence/oauth2` MUST NOT be treated as the atrib oauth2 profile. Profile identity is the full URI. |
| `cases/unknown-profile--unknown-profile-preserved.json` | Unknown envelope round-trips byte-identical (JCS hash pinned) and renders opaquely. |
| `cases/unknown-profile--unknown-profile-never-dropped.json` | A mixed known/unknown evidence list keeps both entries, in order. |
| `cases/legacy-mapping--legacy-oauth2.json` | `protocol: "oauth2"` → `https://atrib.dev/v1/evidence/oauth2` envelope, exact bytes pinned. |
| `cases/legacy-mapping--legacy-mcp-oauth.json` | `protocol: "mcp_oauth"` → `https://atrib.dev/v1/evidence/mcp-oauth`, including a failed-scope block whose `result.valid` stays `false`. |
| `cases/legacy-mapping--legacy-aauth.json` | `protocol: "aauth"` → `https://atrib.dev/v1/evidence/aauth`, with AAuth-shaped details committed as `facts.details_hash`. |
| `cases/legacy-mapping--legacy-x401.json` | `protocol: "x401"` → `https://atrib.dev/v1/evidence/x401`, with sanitized x401 detail hashes preserved through the mapping. |
| `cases/legacy-mapping--legacy-ap2-vi.json` | `protocol: "ap2_vi"` → `https://atrib.dev/v1/evidence/ap2-vi`. |
| `cases/legacy-mapping--legacy-unknown-protocol-rejected.json` | The executable legacy-string freeze: a hypothetical `atrib_delegation` protocol string MUST be rejected, never mapped to an invented profile URI. |
| `cases/tier--tier-ladder-all-four.json` | One payload at all four tiers, shared `(profile, payload.hash)` identity key, tier-descending consumer ordering. |
| `cases/tier--relay-identity-swap-rejected.json` | Relaying another party's envelope with a swapped `verifier` identity MUST be flagged; re-verification produces a new instance. |
| `cases/tier--verified-withheld-not-reproducible.json` | `tier: "verified"` with a withheld payload is well-formed but MUST be reported claimed-but-not-reproducible. |
| `cases/tier--evidence-never-flips-valid.json` | A real signed record verified alongside failing OAuth evidence: the evidence block and mapped envelope carry `valid: false` while `verifyRecord().valid` stays `true`. |
| `cases/continuation-packet--baton-envelope-valid.json` | Typical baton handoff: markdown packet under the raw-bytes hash rule, role-term routing facts, a real Ed25519-signed baton-pass observation named by `facts.baton_record_hash`. MUST accept. |
| `cases/continuation-packet--packet-hash-mismatch.json` | Shape-valid envelope whose `payload.hash` does not match the packet bytes. Profile verification fails; the envelope stays shape-valid; no record validity changes. |
| `cases/continuation-packet--withheld-packet-declared.json` | Public-projection posture: `ref.kind: "withheld"`, hash plus sanitized role-term facts only; packet bodies are private by default. MUST accept. |
| `cases/continuation-packet--signed-baton-record.json` | The signed baton-pass observation itself as payload via the `ref.record_hash` sibling rule; `payload.hash` = sha256(JCS(record)); signature verifies independently. |
| `cases/payments-detection--detection-envelope-valid.json` | Producer-declared detection envelope on a cross-attested transaction record: JCS-hashed detection material, rail/hook/receipt-identity facts, two distinct verified signer keys. MUST accept. |
| `cases/payments-detection--detection-payload-hash-mismatch.json` | Shape-valid detection envelope whose `payload.hash` does not match the detection material. Profile verification fails; envelope stays shape-valid; record verdicts untouched. |
| `cases/payments-detection--unloaded-profile-degrades.json` | The degradation family: no payments profile loaded. `profile_unrecognized: true`, tier capped at `declared`, signature and cross-attestation verdicts identical to a payments-aware run. |
| `cases/payments-detection--duplicate-signer-not-inflated.json` | [D052](../../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) re-pin: the same agent signer entry twice. One distinct verified signer, `cross_attestation_missing: true`; the detection envelope never substitutes for a counterparty signature. |
| `cases/payments-settlement--recommendation-envelope-valid.json` | Settlement recommendation attached by JCS hash with session, calculator, policy-record, and tree-size facts. MUST accept; recalculation is profile-internal. |
| `cases/payments-settlement--tampered-recommendation-rejected.json` | Recommendation with an altered distribution: recomputed hash mismatch. Profile verification fails; envelope stays shape-valid. |
| `cases/payments-settlement--withheld-recommendation-declared.json` | Hash-only public posture: `ref.kind: "withheld"` with sanitized facts; distribution bodies stay private. MUST accept. |

## Generator

`packages/log-dev/scripts/generate-conformance-evidence-envelope.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-evidence-envelope.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce
byte-identical files. All hashes are real: payload commitments are
sha256 over JCS bytes (JSON media types) or raw UTF-8 bytes (non-JSON
media types), record hashes are sha256 over canonical record bytes, and
the signed fixtures carry genuine Ed25519 signatures. Regenerate when:

- the envelope schema or a closed enum changes (requires revising the
  evidence-envelope ADR first)
- a new atrib-maintained profile is registered (add its family in the
  same commit as the profile document)
- a new test case is added

The legacy-to-profile mapping table MUST NOT change: the legacy
`protocol` string set is frozen at five. A generator change that adds a
sixth mapping row is a conformance failure, not an extension.

## Reference implementation

`packages/verify/test/conformance-evidence-envelope.test.ts` loads each
committed case (not the generator) and asserts every expected field. It
independently re-implements the envelope shape checker and
`fromLegacyEvidenceBlock` mapping, recomputes every committed hash with
the real `canonicalize` package, verifies the fixture signatures with
`@atrib/mcp`, and drives `verifyRecord()` from `@atrib/verify` for the
never-flips-valid case. Conforming third-party implementations SHOULD
load the same fixtures and assert the same invariants.

## Status

**37 cases across eight families.** The initial 26-case corpus shipped
across five families; the `continuation-packet--*` family landed with
[D142](../../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions),
and the `payments-detection--*` and `payments-settlement--*` families
landed with the [P048](../../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core)
payments-profile registrations. Future per-profile families (`oauth2/`,
`mcp-oauth/`, `aauth/`, `x401/`, `ap2-vi/`, `human-approval/`,
`counterparty-attestation/`) land in the same commit as each
`docs/evidence-profiles/<name>.md` profile document, plus `hashing/` and
`sanitization/` families as the producer and archive surfaces adopt
envelope form.
