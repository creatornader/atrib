# @atrib/verify

## 0.3.5

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.3.4

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.3.3

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.3.2

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.3.1

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0

## 0.3.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  Atrib's own public APIs are unchanged, and signing-output, hash-output, and
  JCS-canonicalization-output remain byte-identical — verified by the signing
  corpus (spec [§1.4](../atrib-spec.md#14-signing-and-verification)) and the Wycheproof Ed25519 test vectors.

  The single user-visible break is `@atrib/openinference`'s peer dep: consumers
  of that package must now use `@opentelemetry/sdk-trace-base@^2.7.1` (instead
  of `^1.27.0`). The OTel SDK v2 also replaced `provider.addSpanProcessor(p)`
  with the `new BasicTracerProvider({ spanProcessors: [p] })` constructor form;
  the adapter and its tests have been migrated accordingly.

  The other deps' major-version changes were API-shape internal:
  `@noble/ed25519` v3 moved sha512 wiring from `etc.sha512Sync` to
  `hashes.sha512` and renamed `utils.randomPrivateKey` to `utils.randomSecretKey`;
  `@noble/hashes` v2 is ESM-only and requires `.js` extensions on import paths;
  `canonicalize` v3 is ESM-only (atrib was already ESM-only). None of these
  shifts touch atrib's exported surface.

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.2.6

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.2.5

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.2.4

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0

## 0.2.0

### Minor Changes

- 79199ee: Add `args_commitment_form` and `result_commitment_form` posture detection (atrib spec [§8.3](../../atrib-spec.md#83-salted-commitment-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)).

  `@atrib/mcp` `AtribRecord` type gains optional `args_salt` and `result_salt` fields. These were already MAY fields per spec [§1.2.1](../../atrib-spec.md#121-field-definitions) (lines 293-294 of `atrib-spec.md`) but had not been surfaced in the TypeScript type. JCS-canonical sort positions: `args_salt` between `annotates` and `chain_root` (a-n < a-r < c); `result_salt` between `provenance_token` and `revises` (p < r-e-s < r-e-v). Backward-compatible (absence preserves default posture).

  `@atrib/verify` `PostureAnnotation` gains `args_commitment_form` and `result_commitment_form` fields (`'plain-sha256' | 'salted-sha256'`). Detection is structural per [§8.3](../../atrib-spec.md#83-salted-commitment-posture): presence of `args_salt` / `result_salt` ⇒ `salted-sha256`; absence ⇒ `plain-sha256`. The [§8.3](../../atrib-spec.md#83-salted-commitment-posture) `hmac-sha256` variant is signaled out-of-band and is not structurally detectable.

  5 new tests added; verify package now at 247 passing.

  Implements the args/result commitment-posture half of the [§8.3](../../atrib-spec.md#83-salted-commitment-posture) surface. The `tool_name_form` ([§8.2](../../atrib-spec.md#82-opaque-name-posture)) surface remains blocked on a [§1.2.1](../../atrib-spec.md#121-field-definitions) spec extension to add `tool_name` as a MAY field.

- 98c6ff9: Add `capability_check` per-record annotation ([D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) / atrib spec [§6.7](../../atrib-spec.md#67-capability-declarations)).

  `verifyRecord(record, options)` now accepts `options.identityClaim` and surfaces a `capability_check: { envelope, in_envelope, mismatches, unresolvable }` field on the result. The verifier checks the record against the envelope's `event_types` allowlist and `expires_at` cutoff. Constraints that depend on data not on the standard record shape (`tool_names` against `tool_call`) or out-of-band protocol-event data (`max_amount`, `counterparties` against `transaction`) flag `unresolvable: true` rather than passing or failing silently, per spec [§6.7.2](../../atrib-spec.md#672-verifier-semantics).

  Per spec [§6.7.3](../../atrib-spec.md#673-out-of-envelope-is-a-signal-not-invalidation) out-of-envelope is a signal, not invalidation: mismatches do not flip `valid` to false. Callers decide policy.

  The caller is responsible for fetching the active capability envelope at the record's timestamp (typically via `@atrib/directory`'s `lookup()` or a cached equivalent). `@atrib/verify` intentionally has no `@atrib/directory` dependency, the new `ResolvedIdentityClaim` interface is structurally compatible with `@atrib/directory`'s `IdentityClaim`, so callers can pass either the directory's response or a hand-rolled cache entry.

  New exports: `CapabilityEnvelope`, `CapabilityCheckAnnotation`, `ResolvedIdentityClaim`, `VerifyRecordOptions.identityClaim`.

- 8abcb67: [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records): cross-attestation type + verifier surface.

  `@atrib/mcp` `AtribRecord` type gains optional `signers?: SignerEntry[]` field for transaction records per spec [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records). New `canonicalCrossAttestationInput(record)` helper exported alongside `canonicalRecord` / `canonicalSigningInput` produces the JCS form with `signers: []` and the top-level `signature` field omitted, the bytes every signer in `signers[]` covers per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records).

  `@atrib/verify` `verifyRecord()` now surfaces `cross_attestation: { signers_count, signers_valid, missing }` on transaction records (`event_type = transaction`). Verifies each signer's Ed25519 signature against the cross-attestation canonical bytes; flags `missing: true` when below the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) normative minimum of 2 verified signers. Per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) missing is a SIGNAL, not invalidation: the underlying signature path keeps the record cryptographically valid. Legacy single-signer transaction records (no `signers[]`, top-level `signature` only) surface as `signers_count: 0, missing: true`.

  The verifier's top-level signature check is skipped for transaction records that carry a populated `signers[]` array per [§1.2.1](../../atrib-spec.md#121-field-definitions)'s "signature is OPTIONAL on transaction records" clause; in those records `signatureOk` is set to `true` and the actual cryptographic validity flows through `cross_attestation.signers_valid`.

  `spec/conformance/1.7.6/` corpus (5 cases) ships alongside: legacy-single-signer, one-signer (below minimum), two-signers-valid (canonical happy path), three-signers (above minimum), tampered-second-signature (count vs valid independence). Reference test at `packages/verify/test/conformance-1.7.6.test.ts`.

  7 new verifier tests + 5 conformance-corpus reference tests added; verify package now at 279 passing tests.

  **Middleware-side signing of multi-signer transaction records is a separable follow-up.** This change implements the verifier; the producer-side counterparty-coordination protocol (how the agent and counterparty exchange signatures over the same canonical bytes) is its own design problem and ships in a separate ADR when payment-protocol integration work begins.

- 3161e59: [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121): add `tool_name`, `args_hash`, `result_hash` to the [§1.2.1](../../atrib-spec.md#121-field-definitions) canonical record schema.

  Closes the spec gap where [§8.2](../../atrib-spec.md#82-opaque-name-posture) (opaque-name posture) and [§8.3](../../atrib-spec.md#83-salted-commitment-posture) (salted-commitment posture) referenced record fields that had never been added to the [§1.2](../../atrib-spec.md#12-the-attribution-record) canonical shape. Verifier surfaces for both postures now have structural inputs to detect against.

  `@atrib/mcp` `AtribRecord` type gains three optional fields with documented JCS-canonical sort positions:
  - `tool_name?`, last in current schema (`t-o-...` after `t-i-...`)
  - `args_hash?`, between `annotates` and `args_salt`
  - `result_hash?`, between `provenance_token` and `result_salt`

  All three default to absence (preserving the [§8.1](../../atrib-spec.md#81-default-posture) default posture). Backward-compatible: existing records continue to verify identically.

  `@atrib/verify` `PostureAnnotation` gains `tool_name_form: 'hashed' | 'plain' | null`. Detection per the [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) fix to [§8.2](../../atrib-spec.md#82-opaque-name-posture)'s regex ambiguity:
  - `'hashed'` when value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
  - `'plain'` for any other present value (verbatim and opaque-label NOT structurally distinguishable; both surface as plain)
  - `null` when the field is absent

  5 new verifier tests + 4 conformance-corpus reference tests added; verify package now at 267 passing tests. New `spec/conformance/8.2/` corpus (4 cases) ships alongside.

  [§8.2](../../atrib-spec.md#82-opaque-name-posture) prose updated to acknowledge the regex ambiguity. [§8.3](../../atrib-spec.md#83-salted-commitment-posture) prose clarifies that `args_hash` / `result_hash` are [§1.2.1](../../atrib-spec.md#121-field-definitions) MAY fields. [§1.2.1](../../atrib-spec.md#121-field-definitions) standard-shape example record + field table extended with all three fields.

  Middleware-side opt-in (config-gated emission of the new fields) is a separate follow-up; this change is verifier-only and spec-only and does not change the bytes any existing record produces.

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

## 0.1.2

### Patch Changes

- edf710f: Refine package descriptions for accuracy and consistency.
  - `@atrib/cli`: previous description listed macOS Keychain as if required (it's an optional backend; CLI works on any platform via `--key-file`) and singled out "publish identity claims" as the headline (one of several capabilities). New description: "Key management, identity-claim publishing, and revocation."
  - `@atrib/directory`: dropped "AKD-backed" (implementation detail) from the headline; replaced with "with cryptographic proofs" which captures the value proposition without leaking the implementation choice into the package summary. Also disambiguated "spec [§6](../../atrib-spec.md#6-key-directory)" to "atrib spec [§6](../../atrib-spec.md#6-key-directory)" since the npm package page strips surrounding context.
  - `@atrib/verify`: removed awkward double-"re-" stutter ("re-derivation" + "re-calculation"); replaced with "Independent" which carries the verifier semantic without the verb-stacking. Also disambiguated "[§4.6](../../atrib-spec.md#46-the-calculation-algorithm)" to "atrib spec [§4.6](../../atrib-spec.md#46-the-calculation-algorithm)".

## 0.1.1

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "Atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
