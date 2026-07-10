# P045 candidate ADR draft: Delegation certificates: principal keys certify ephemeral run keys

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P045](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

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

# ADR draft: Delegation certificates: principal keys certify ephemeral run keys

**Status:** Draft (not accepted; candidate ADR for step 3 of [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md))

**Extends:** [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) (scope schema), [D033](../DECISIONS.md#d033-key-rotation-and-revocation) / [§1.9](../atrib-spec.md#19-key-rotation-and-revocation) (revocation machinery). **Amends:** [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) / [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) (key-isolation MUST narrowed to principal keys). **Depends on:** the step-4 universal evidence envelope ADR (this ADR defines the `delegation-certificate` envelope profile). **Deliberately not:** [D038](../DECISIONS.md#d038-per-conversation-key-derivation) per-conversation key derivation, which stays deferred.

## Context

Today every atrib producer signs with one long-lived Ed25519 creator key. That couples three concerns the 2026-07-06 clean-room redesign pulled apart:

1. **Compromise blast radius.** A leaked key forces a full [§1.9](../atrib-spec.md#19-key-rotation-and-revocation) rotation: `key_revocation` record, directory claim update, every downstream consumer re-pinning. For sandboxed or hosted runs, the key most exposed to prompt-injected code is also the operator's durable identity.
2. **Sandbox custody.** [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) made a host signer proxy structurally required for sandboxed execution ([§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution)) precisely because the in-sandbox key was worth the entire identity. The proxy is the right hardening but a heavy default: it forces an IPC hop into every signing path and a host process into every deployment topology.
3. **Scoping.** [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) capability envelopes constrain a key via the directory, but envelope rotation is identity-claim publication, the wrong cadence for "this run may only call these tools for the next hour."

[D038](../DECISIONS.md#d038-per-conversation-key-derivation) already spec'd (and deferred) HKDF per-conversation derivation. Derivation is the wrong tool for this problem: derived keys carry no scope and no expiry, revocation granularity is per-master only ([D038](../DECISIONS.md#d038-per-conversation-key-derivation) point 5), and verification requires the directory-published derivation rule. The redesign's answer is **certification**: an explicit signed statement, no deterministic linkage from a parent secret, verifiable offline from the certificate alone.

The governing constraint from the redesign doc applies in full: **no signed byte of any existing record, log entry, or checkpoint changes.**

## Decision

Introduce the **delegation certificate**: a standalone JCS-canonical object in which a *principal* key certifies an ephemeral *run* key with an explicit scope, expiry, and optional session binding. Run records are signed by the run key, which occupies the existing `creator_key` slot in both the record ([§1.2.1](../atrib-spec.md#121-field-definitions)) and the 90-byte log entry ([§2.3.1](../atrib-spec.md#231-entry-serialization)); no format change anywhere.

A record signed directly by a principal is **delegation depth 0**: no certificate exists or is needed, and verification is byte-for-byte today's [§1.4.3](../atrib-spec.md#143-verification-procedure) procedure. Every record ever signed is therefore already valid under this model, by definition.

The certificate travels **in-band**: an OPTIONAL `delegation_cert_hash` field on new genesis records commits to it inside the signed session genesis; the certificate body is distributed via the `_local` sidecar ([§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape)), the archive evidence surface ([§2.12](../atrib-spec.md#212-record-body-archive-layer), [D111](../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)), and/or the **`delegation-certificate` profile of the step-4 universal evidence envelope**. Verifiers additionally accept caller-supplied certificates out-of-band, so the walk works even when the genesis field is absent, which is the routine case for multi-producer contexts (see Mechanism).

The directory ([§6](../atrib-spec.md#6-key-directory)) maps **principals only**. Run keys never enter the directory. Revocation of a single run rides the existing [§1.9](../atrib-spec.md#19-key-rotation-and-revocation) machinery via a new principal-signing rule. [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)'s signer proxy demotes from structural requirement to recommended hardening.

Spec home: new normative section **[§1.11](../atrib-spec.md#111-delegation-certificates) Delegation Certificates** ([§1.10](../atrib-spec.md#110-per-conversation-key-derivation-reserved) stays reserved for the deferred [D038](../DECISIONS.md#d038-per-conversation-key-derivation) derivation text), plus targeted amendments to [§1.2.1](../atrib-spec.md#121-field-definitions), [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution), [§1.9](../atrib-spec.md#19-key-rotation-and-revocation), [§6.3](../atrib-spec.md#63-verifier-consultation-algorithm), and [§6.7](../atrib-spec.md#67-capability-declarations).

## Mechanism

### Certificate schema and signature rule

A delegation certificate is a JSON object, canonicalized with JCS (RFC 8785, same as records per [§1.3](../atrib-spec.md#13-canonical-serialization)):

```jsonc
{
  "cert_type":     "atrib/delegation-cert/v1",  // MUST; literal version discriminator
  "context_id":    "4bf92f3577b34da6a3ce929d0e0e4736", // OPTIONAL; 32 lowercase hex; binds the cert to one session
  "not_after":     1751812200000,               // MUST; Unix ms; records after this are out-of-window
  "not_before":    1751808600000,               // OPTIONAL; Unix ms; default 0 when absent
  "principal_key": "L7pnH1...43chars...",       // MUST; base64url 32-byte Ed25519 principal public key
  "run_pubkey":    "Qx9tGe...43chars...",       // MUST; base64url 32-byte Ed25519 run public key
  "scope":         { "tool_names": ["search", "read_email"], "max_amount": { "currency": "USD", "value": 100 } }, // OPTIONAL; D051 capability envelope schema, verbatim
  "signature":     "..."                        // MUST; Ed25519 by principal_key
}
```

JCS lexicographic field order is exactly as listed: `cert_type` < `context_id` < `not_after` < `not_before` < `principal_key` < `run_pubkey` < `scope` < `signature`. Optional fields are **omitted, not null**, when absent; presence/absence changes the canonical form and therefore the signature, mirroring the `session_token` rule (critical invariant 5).

**Signature rule (mirrors [§1.4.2](../atrib-spec.md#142-signing-procedure)):** `signature = base64url(Ed25519-sign(principal_seed, UTF-8(JCS(cert with signature field omitted))))`. Verification requires `run_pubkey !== principal_key` (a self-certificate is invalid) and both keys well-formed per [§1.4.1](../atrib-spec.md#141-key-format).

**Certificate hash (stable identifier):** `cert_hash = "sha256:" + hex(SHA-256(UTF-8(JCS(full signed cert))))`, over the *signed* bytes, analogous to `record_hash`. Used by the genesis field, revocation records, sidecars, and archive keys.

**Depth limit:** v1 permits depth ≤ 1. `principal_key` MUST NOT itself be a run key under another certificate known to the verifier; a chained certificate is rejected *as delegation evidence* (`delegation_depth_exceeded`) and the record falls back to plain attribution to its signing key. Chains are future work behind their own ADR.

### New OPTIONAL genesis-record field

`delegation_cert_hash` (string, `"sha256:" + 64 lowercase hex`) MAY appear on **genesis records only** (same genesis-only discipline as `provenance_token`, [§1.2.6](../atrib-spec.md#126-provenance_token)). It commits the genesis signer's session start to the certificate covering **its own run key**. JCS-canonical form slots it between `creator_key` (`c-r`) and `event_type` (`e`), consistent with the "new optional fields slot lexicographically" rule in CLAUDE.md's key technical decisions. Non-genesis records MUST NOT carry it. Existing records never carried the field, so no existing signature is affected; new records that omit it are byte-identical to today's output.

**Binding scope, single-producer sessions:** for subsequent records signed by the same run key in the same context, the verifier associates them with the genesis commitment through `creator_key` + `context_id` equality and the CHAIN_PRECEDES linkage back to the genesis record; `cert_bound` is then evaluable for the whole run.

**Multi-producer posture (explicit, expected):** under [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition) / [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) chain composition, a certified run key routinely joins a context whose genesis record was signed by a *different* producer key. That run key then owns no record that is permitted to carry the field: there is nothing for `chain_root` linkage to inherit, and this ADR does not pretend otherwise. For such records the certificate is supplied out-of-band through the three carriers below and `cert_bound` remains `null` permanently, while `cert_valid`, `in_window`, `context_bound`, scope checks, and revocation checks are all unaffected. `delegation_cert_hash` is a strengthening bind available exactly to the producer that signs a context's genesis record; it is never a prerequisite for delegation resolution. Producers whose run key joins an existing chain SHOULD set the certificate's `context_id` (giving `context_bound: true`) as the substitute session binding.

### Carriage

Three carriers, any subset sufficient for a verifier that obtains the certificate somehow:

1. **Local sidecar:** producers write the full certificate to `_local.delegation_cert` in the mirror envelope ([§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape)). Signed bytes unchanged; sidecar-only, like `_local.producer`.
2. **Archive evidence:** producers configured for archive submission attach the certificate as an evidence object keyed by `cert_hash` through the [§2.12](../atrib-spec.md#212-record-body-archive-layer) evidence API ([D111](../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure)). Certificates contain only public keys, a scope, and timestamps, so there is no salted-commitment exposure concern.
3. **Evidence envelope profile:** the verifier-facing carrier is a profile of the step-4 universal evidence envelope, under the profile identifier **`delegation-certificate`**, the name the envelope ADR reserves for this ADR. The profile payload is the certificate object (or its `cert_hash` as a payload reference); the profile's verifier facts are exactly the walk outputs below. Because this ADR is sequenced after step 4 in the declared landing order (4 → 1 → 2 → 3 → 5 → 6 → 7), the profile is defined here directly against the normative envelope schema, tier enum included: **no interim protocol string is introduced.** Contingency only: if landing order changes and the envelope is not yet normative when this lands, the identical facts ride the legacy [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) block shape (whose `protocol` union is open: `'oauth2' | 'mcp_oauth' | 'aauth' | 'ap2_vi' | string`) using the *same* `'delegation-certificate'` identifier, and the block is re-declared as the envelope profile without rename when step 4 lands; exactly one name ever exists. Callers pass certificates to `verifyRecord(record, { authorizationEvidence })` in either regime.

### Verifier walk (offline, deterministic)

Given record `R` and available certificate set `C`:

1. Verify `R.signature` under `R.creator_key` per [§1.4.3](../atrib-spec.md#143-verification-procedure). **Unchanged; delegation never alters signature validity.**
2. Select certificates `c ∈ C` with `c.run_pubkey === R.creator_key` and a valid principal signature. No match → **depth 0**: attribute to `R.creator_key` as today; if `R`'s genesis carries `delegation_cert_hash` but no matching cert is available, surface `delegation_unresolved: true` (signal, not invalidation; the [D113](../DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default) posture).
3. For a matching `c`, check: `(c.not_before ?? 0) <= R.timestamp <= c.not_after` → `in_window`; `c.context_id` absent or `=== R.context_id` → `context_bound`; genesis `delegation_cert_hash`, when present *and when the context genesis was signed by `R.creator_key`*, `=== cert_hash(c)` → `cert_bound` (otherwise `cert_bound: null`, the standing state for run keys that joined a multi-producer context per above).
4. Consult the directory ([§6.3](../atrib-spec.md#63-verifier-consultation-algorithm)) for `c.principal_key`, not the run key. A directory claim found *for the run key itself* is surfaced as the structural anomaly `run_key_in_directory: true`; the expected result for a run key is a non-membership proof.
5. Scope check: `effective envelope = intersection(principal's directory envelope active at R.timestamp, c.scope)`. Both checks surface independently: `in_scope` (record vs. cert scope) and `attenuation_ok` (cert scope ⊆ principal envelope; a cert granting what the principal's own envelope excludes sets `attenuation_ok: false`). All scope outputs are signals, never invalidation, per [§6.7.3](../atrib-spec.md#673-out-of-envelope-is-a-signal-not-invalidation).
6. Revocation: scan for [§1.9](../atrib-spec.md#19-key-rotation-and-revocation) `key_revocation` records retiring either the run key (per-run revocation, below) or the principal (which cascades: certificates signed by a revoked principal are invalid as delegation evidence for records at `log_index >= R`, per existing [§1.9.3](../atrib-spec.md#193-verifier-semantics) semantics).

Verifier output extends `verifyRecord()` with an optional block (surfaced through the `delegation-certificate` envelope profile per carrier 3):

```jsonc
"delegation": {
  "depth": 0 | 1,
  "principal_key": "..." | null,
  "cert_hash": "sha256:..." | null,
  "cert_valid": true | false | null,
  "in_window": true | false | null,
  "context_bound": true | false | null,   // null when cert has no context_id
  "cert_bound": true | false | null,      // null when no genesis delegation_cert_hash applies to this run key (incl. multi-producer joins)
  "scope_check": { "in_scope": true, "attenuation_ok": true, "mismatches": [] } | null,
  "revoked": true | false | null,
  "errors": []
}
```

`verifyRecord().valid` is unaffected by every field in this block: delegation is attribution resolution and trust signal, exactly like [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) capability checks.

**Ambiguity rule:** if two valid certificates from *different* principals cover the same run key in overlapping windows, the verifier surfaces both and sets `delegation_ambiguous: true` rather than choosing. Choosing would be interpretation; surfacing is fact.

**Transaction interaction ([D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)):** the ≥2-distinct-verified-keys rule counts raw keys and is unchanged. A new signal, `signers_share_principal: true`, fires when two signer keys resolve to the same principal through certificates (an agent co-signing with its own principal, or two run keys of one principal, does not demonstrate a real counterparty). Whether policy should *require* distinct principals is left open (open question 7).

### Revocation record shape

Reuse [§1.9](../atrib-spec.md#19-key-rotation-and-revocation) rather than minting a parallel mechanism. Two amendments, both additive:

1. **New signing rule 3 in [§1.9.2](../atrib-spec.md#192-signing-rules):** a `key_revocation` record retiring a run key MAY be signed by the principal key of a delegation certificate covering that run key. The record carries a new OPTIONAL field `delegation_cert_hash` (JCS slots after `creator_key`, before `emergency_signed_by`; new records only) referencing the certificate that proves the principal-run relationship. Verifiers MUST resolve that certificate before accepting the principal as an authorized revoker. The [§1.9.1](../atrib-spec.md#191-revocation-record-format) canonical-order note (currently "places `emergency_signed_by` after `creator_key` and before `revoked_key`") is amended in the same edit, since the new field sits between them: the order becomes `creator_key` < `delegation_cert_hash` < `emergency_signed_by` < `revoked_key` when the field is present.
2. **[§1.9.3](../atrib-spec.md#193-verifier-semantics) applies unchanged** to the revoked run key: records signed by it at `log_index >= R` flag `revoked_after_revocation`; earlier records keep their state. `revocation_reason` is `'compromise'` for a burned sandbox, `'retirement'` for clean early wind-down. `not_after` expiry remains the primary bound; revocation is the early-kill path.

No directory tombstone exists for run keys because run keys are not in the directory; the log is the sole source of revocation truth, which [§1.9.3](../atrib-spec.md#193-verifier-semantics) already states. `key_revocation` is an existing event type, so no [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) promotion is required; the only new record semantics are an OPTIONAL field, inside the hard constraint.

### D051 capability envelopes and the [§6](../atrib-spec.md#6-key-directory) directory

- The certificate `scope` reuses the [§6.7.1](../atrib-spec.md#671-identity-claim-extension) envelope schema **verbatim** (`tool_names`, `max_amount`, `counterparties`, `event_types`, `expires_at`). One schema, two carriers: directory-published (per-key, identity-claim cadence) and certificate-carried (per-run, issuance cadence). `scope.expires_at`, when present, further caps `not_after` (effective expiry is the minimum).
- Directory stays principals-only: bounded by operators, not runs; AKD insertion cost and audit surface do not scale with run cadence; run-key absence proofs are the expected lookup result.
- [§6.7.4](../atrib-spec.md#674-envelope-rotation) unchanged for principals. Run scopes never rotate; issue a new certificate instead.

### D102 demotion (explicit normative change)

[§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) currently says the private key MUST NOT be reachable from sandboxed execution. This ADR narrows that MUST: **principal keys MUST NOT be reachable from sandboxed execution, unconditionally. Run-key seeds MAY be provisioned into a sandbox when covered by a delegation certificate whose `not_after`, `scope`, and (RECOMMENDED) `context_id` binding the host accepts for that run.** The in-sandbox key is then worth one scoped, expiring, individually revocable run. The signer proxy ([§9.7](../atrib-spec.md#97-pattern-sandboxed-execution-signer-proxy)) remains RECOMMENDED hardening (it still uniquely provides a pre-signing host policy gate and prevents mid-window misuse) but stops being the only conforming topology. This is a deliberate relaxation of a normative MUST and is called out here rather than papered over; it lands as a v2 note on [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) in the same commit.

### Producer surface

- `@atrib/cli`: new `atrib delegate --scope <file.json> --ttl <seconds> [--context <32-hex>] [--not-before <ms>]`: generates a run keypair (Keychain-managed like existing keys), signs the certificate with the principal key, and emits an env bundle (`ATRIB_KEY` = run seed, `ATRIB_DELEGATION_CERT` = path or base64 of the certificate) suitable for the [D135](../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args) orchestrator-injected pattern.
- `@atrib/mcp` (and via it `handleEmit`/`emitInProcess`, so all seven primitives inherit): new optional config `delegationCert`. When set: stamp `delegation_cert_hash` on the genesis record *when this producer signs the context genesis* (per the multi-producer posture above, a producer joining an existing chain writes no genesis and stamps nothing), write `_local.delegation_cert`, and include the certificate in archive submission when the archive path is configured.
- **Degradation ([§5.8](../atrib-spec.md#58-degradation-contract)):** every failure (unreadable cert file, malformed JSON, expired cert at startup, principal-signature mismatch) is caught, logged with the `atrib:` prefix, and signing proceeds *without* the genesis field. Records remain valid; the verifier simply sees an uncertified run key (`delegation_unresolved` at worst). Delegation failures never block the primary tool call.

### Fact-layer discipline

No graph change of any kind. No new edge types ([§3.2.4](../atrib-spec.md#324-edge-derivation-rules) untouched; the nine stay nine), no delegation interpretation in graph responses, no principal grouping from any graph endpoint (critical invariants 2 and 6). Graph nodes remain keyed by `creator_key` (the run key, for delegated records). Aggregation-by-principal is verifier output and product presentation. The [§4.6](../atrib-spec.md#46-the-calculation-algorithm) calculation is unchanged in v1; if a future policy wants principal-level aggregation, the certificate set becomes part of the calculation's *explicit inputs* (preserving the pure-function invariant), behind its own ADR.

## Compatibility and migration

- **Existing signed records:** untouched, byte-for-byte. Every one is delegation depth 0 and verifies identically. No re-signing, no backfill.
- **Log entry format:** unchanged 90 bytes; the run key occupies the same 32-byte `creator_key` slot. log-node requires zero changes.
- **Canonicalization:** unchanged rules; two new OPTIONAL fields (`delegation_cert_hash` on genesis records, `delegation_cert_hash` on `key_revocation` records) affect only the signatures of new records that opt in, exactly like `informed_by` and `provenance_token` did when introduced.
- **Old verifiers:** verify new delegated records' signatures fine and attribute to the run key: degraded attribution, not broken verification. Unknown optional fields are covered by the signature and otherwise ignored.
- **[§1.2.1](../atrib-spec.md#121-field-definitions) field-semantics text:** the `creator_key` row currently says "It is not an ephemeral session key." That sentence is amended to: the field carries either a principal key (depth 0) or a certified run key (depth 1); the *durable* identity is the principal resolved through [§1.11](../atrib-spec.md#111-delegation-certificates). Informative text change only; no byte semantics change.
- **Published packages:** additive minor releases: `@atrib/verify` (delegation block + `delegation-certificate` envelope profile), `@atrib/cli` (`delegate` subcommand), `@atrib/mcp` (`delegationCert` config), seven primitives via dependency bump. No breaking changes; Changesets as usual.
- **Deployed services:** log-node none. graph-node none (no edges, no schema). directory-node none in code; docs state the principals-only convention. archive-node gains the certificate evidence kind through the existing evidence API. Explorer display of principal attribution is a DESIGN.md backlog item, not part of this ADR.
- **Operator machines:** no migration. Existing flat keys become principals implicitly: a principal is simply a key that signs certificates. No re-registration, no directory re-publication, no mirror rewrite. Dogfood adoption starts where the risk is: the [D135](../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args) delegated-builder flow and any [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) sandbox topology; long-lived local runtimes keep signing at depth 0 indefinitely.
- **[D038](../DECISIONS.md#d038-per-conversation-key-derivation):** stays deferred and unmodified. [§1.10](../atrib-spec.md#110-per-conversation-key-derivation-reserved) remains reserved for it; this ADR takes [§1.11](../atrib-spec.md#111-delegation-certificates). The two are compatible (a derived key could later be certified), but no interaction ships now.
- **Step-4 envelope:** this ADR consumes the envelope's normative schema and reserved `delegation-certificate` profile identifier; it defines the profile document, not a second attachment vocabulary. Only if landing order inverts does the single-name [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) fallback in Mechanism/Carriage apply, and it re-declares as the profile without rename.

## Conformance-corpus plan

New directory: **`spec/conformance/1.11/`** (delegation certificates), generator under `packages/log-dev/scripts/` and reference tests in `packages/verify/test/`, following the 1.2.6 corpus pattern. Case families:

1. **Canonical form and signing:** byte-exact JCS vectors for certificates with every optional-field presence combination (`context_id`/`not_before`/`scope` present/absent); signature verification vectors; `cert_hash` derivation vectors; invalid: self-certificate (`run_pubkey === principal_key`), malformed keys, absence-not-null violations.
2. **Verifier walk:** depth-0 identity case (record with no cert verifies as today; regression pin for "every existing record already valid"); depth-1 happy path (bound and unbound `context_id`); expired (`timestamp > not_after`); not-yet-valid; context mismatch; wrong principal signature; genesis `delegation_cert_hash` match and mismatch; `delegation_unresolved` (hash present, cert absent); multi-producer join (run key in a context whose genesis another key signed → `cert_bound: null`, all other facts evaluable); chained cert → `delegation_depth_exceeded`; two-principal ambiguity → `delegation_ambiguous`.
3. **Scope and attenuation:** in-scope; out-of-cert-scope (signal only, record stays valid); cert scope wider than principal envelope → `attenuation_ok: false`; no directory envelope (cert scope alone); `scope.expires_at` capping `not_after`.
4. **Revocation (extends `spec/conformance/1.9/`):** principal-signed run-key revocation with `delegation_cert_hash`, pre/post log-index records; revocation signed by a non-principal (rejected); revocation referencing a cert that does not cover `revoked_key` (rejected); principal `key_revocation` cascading over its certificates.
5. **Directory interaction:** run-key non-membership as the expected path; `run_key_in_directory` anomaly vector.
6. **Transaction interaction:** run key + genuine counterparty satisfying [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records); adversarial run-key + own-principal pair → two distinct keys (rule satisfied) but `signers_share_principal: true`.
7. **Envelope-profile projection:** fixtures pinning the `delegation-certificate` profile serialization (type URI, tier, verifier facts, payload hash/reference) against the step-4 envelope corpus, so the profile and the envelope schema cannot drift independently.

Adversarial vectors (families 2, 4, 6) also register in the [D101](../DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)-style substrate-wide corpus discipline: same-input determinism across two implementations is a required test.

## Alternatives rejected

1. **[D038](../DECISIONS.md#d038-per-conversation-key-derivation) HKDF per-conversation derivation (revived).** Rejected for this purpose. Derivation gives linkage without scope or expiry; revocation is per-master only; verifiers need the directory-published derivation rule; the master seed (or a derivation oracle) must be reachable at run start. Certification is explicit, offline-verifiable, per-run revocable, and carries scope. [D038](../DECISIONS.md#d038-per-conversation-key-derivation) stays deferred on its own merits (cross-session unlinkability), which certification does not address; the two are different problems.
2. **Run keys published to the directory (short-lived identity claims).** Rejected. Scales the AKD with run cadence instead of operator count, leaks operational tempo through the public directory, and makes verification depend on directory availability where a self-contained certificate verifies offline.
3. **X.509 / DID / VC delegation chains.** Rejected. [§1.4.1](../atrib-spec.md#141-key-format)'s posture is "Simple, fast, no PKI." A JCS+Ed25519 certificate is a few hundred bytes, reuses the exact signing and canonicalization stack every implementation already has, and needs no ASN.1, resolver, or credential framework. The DIF/VC route remains the [§1.8](../atrib-spec.md#18-scope-boundaries) interoperability roadmap, not the core object.
4. **Biscuit/macaroon-style attenuable tokens.** Rejected. Offline attenuation is attractive but introduces a second cryptographic construction (and for macaroons, an HMAC trust model wrong for public third-party verification). Depth-1 certificates cover the actual demand (sandbox runs, delegated builders) with existing crypto.
5. **A new `delegation` event type carrying the certificate as a log-committed record.** Rejected for v1. It makes certificate availability depend on log/archive retrieval when the certificate must travel *with* the run to be useful at verification time, and it would front-run the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar before any usage evidence exists. Producers MAY additionally emit an observation record whose `args_hash` commits to the certificate for timestamped existence; that composes without a new event type.
6. **Arbitrary-depth delegation chains now.** Rejected. Revocation cascade semantics, cycle handling, and verification cost all compound; no current consumer needs depth > 1. The depth field and `delegation_depth_exceeded` signal leave the door open for a future ADR.
7. **Keeping [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) unconditional and treating certificates as pure attribution metadata.** Rejected as papering over the real conflict: if the MUST stays unconditional, the headline benefit (sandbox holds a disposable key) is void. The ADR instead narrows the MUST explicitly: principal keys unconditionally proxied; certified run keys admissible in-sandbox; proxy RECOMMENDED.
8. **A standalone protocol string (`atrib_delegation`) in the legacy [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) union instead of the envelope profile.** Rejected. This ADR is sequenced after the step-4 envelope ADR, which reserves the `delegation-certificate` profile URI for it; introducing a second, differently named attachment vocabulary for the same object would fork the evidence model the envelope exists to unify. One identifier, one carrier schema; the [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) shape appears only as the same-named contingency fallback described under Carriage.

## Doc-sync impact

- **`atrib-spec.md`:** new [§1.11](../atrib-spec.md#111-delegation-certificates) (certificate schema, signing rule, verifier walk, depth rule, multi-producer posture); [§1.2.1](../atrib-spec.md#121-field-definitions) new `delegation_cert_hash` row + `creator_key` semantics amendment; [§1.9.1](../atrib-spec.md#191-revocation-record-format) new field row **and the canonical-order note amended** (`creator_key` < `delegation_cert_hash` < `emergency_signed_by` < `revoked_key`); [§1.9.2](../atrib-spec.md#192-signing-rules) signing rule 3; [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) narrowed MUST; [§6.3](../atrib-spec.md#63-verifier-consultation-algorithm) walk step for principal resolution; [§6.7](../atrib-spec.md#67-capability-declarations) cross-reference to the second scope carrier; the step-4 envelope section's profile registry gains the `delegation-certificate` profile entry.
- **`DECISIONS.md`:** this ADR; v2 note on [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox); cross-reference from [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) and [D038](../DECISIONS.md#d038-per-conversation-key-derivation) (stays deferred).
- **`CLAUDE.md`:** new "Key technical decisions" bullet (certificate JCS order, depth-0 identity rule, principals-only directory); repository-structure line for `spec/conformance/1.11/`; the D-summary line in the DECISIONS.md entry.
- **`docs/redesign-upgrade-path.md`:** step 3 marked accepted with the ADR number.
- **`ARCHITECTURE.md`:** trust-model section gains the principal/run distinction.
- **`PRIOR-ART.md`:** rows for UCAN, Biscuit, and SPIFFE/SVID as the compared delegation systems.
- **`[§8.7](../atrib-spec.md#87-adversarial-threat-model)` layer-count check:** the [§8.7.2](../atrib-spec.md#872-layered-trust-assessment) stack is documented as 10 layers in CLAUDE.md. Recommended: delegation resolution folds into the existing identity + revocation + capability layers, so the count does not change and `scripts/check-doc-sync.mjs` is untouched. If instead delegation becomes layer 11, [§8.7](../atrib-spec.md#87-adversarial-threat-model), CLAUDE.md, and a new number-word check in `check-doc-sync.mjs` must land in the same commit.
- **`DESIGN.md`:** backlog entry for explorer principal-attribution display (identity view); no surface contract changes in this ADR itself.
- **Package READMEs:** `packages/cli/README.md` (`delegate` command), `packages/verify/README.md` (delegation block + `delegation-certificate` evidence profile), `packages/mcp/README.md` (`delegationCert` config).

## Open questions (operator decisions)

- Sequencing dependency: this ADR is written against the step-4 universal evidence envelope being normative first (declared landing order 4 -> 1 -> 2 -> 3). If the envelope ADR slips, is the single-name [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks) fallback (same 'delegation-certificate' identifier, re-declared as the profile later) acceptable, or should this ADR block on step 4 outright?
- [§1.4.6](../atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution) MUST narrowing: does the operator sign off on relaxing the [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) key-isolation requirement for certified run keys, and should the certificate's context_id binding be RECOMMENDED (as drafted) or MUST for in-sandbox provisioning?
- Default TTL policy for `atrib delegate`: what default not_after window should the CLI ship (single-run scale, e.g. 1-4 hours, vs. day-scale), and should the CLI refuse to issue certificates without a scope?
- Should principal-signed run-key revocation require the referenced certificate to be retrievable from a committed carrier (archive or an observation record committing to it), or accept sidecar/out-of-band certificates as the drafted text does?
- Should the directory identity-claim schema gain an explicit principal opt-in marker (e.g. a 'delegates: true' fact) so verifiers can distinguish 'principal that never delegates' from 'principal whose certificates I have not seen', or is that inference left to policy?
- Depth-1 limit confirmation: is there any near-term consumer (e.g. [D135](../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args) orchestrator chains spawning sub-builders) that needs depth 2, which would change the v1 depth rule before it ships?
- [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) policy posture: should any core or reference policy require distinct principals (not just distinct keys) for transaction cross-attestation, or does 'signers_share_principal' remain a pure signal consumed by merchant-side policy?
- [§8.7.2](../atrib-spec.md#872-layered-trust-assessment) trust-stack accounting: fold delegation resolution into the existing identity/revocation/capability layers (drafted recommendation, no count change) or promote it to layer 11 with the corresponding CLAUDE.md and check-doc-sync.mjs updates?
- Explorer surfacing: what priority does the DESIGN.md backlog item for principal-attribution display (identity view grouping run keys under their principal) get relative to the existing design backlog?
