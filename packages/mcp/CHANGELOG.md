# @atrib/mcp

## 0.3.0

### Minor Changes

- 03fe031: Extend the local mirror with an optional pre-sign payload sidecar.

  The local jsonl mirror previously stored only the bare signed AtribRecord, so consumers (recall, atrib-trace, atrib-summarize) saw only event_type + hashes — never the semantic content (tool name, args, result, observation payload) the record's content_id / args_hash / result_hash COMMITS TO. This made the mirror impoverished relative to what an agent's own working memory needs.

  `@atrib/mcp` `AtribOptions.onRecord` now accepts an optional second argument `OnRecordSidecar` carrying `{ toolName?, args?, result? }` — the pre-sign payload context captured from the wrapped tool call. The signed record bytes are unchanged; the sidecar lives at the host's persistence layer only and is never sent to the public log (which still only sees the bare AtribRecord via the submission queue).

  `@atrib/mcp-wrap`'s `persistRecord` extends to accept the sidecar and write a new envelope shape `{ record, _local?, written_at }` per line. `loadAutoChainSeed` tolerates BOTH the new envelope shape AND legacy bare-record entries from prior wrapper versions — fully backward-compatible. Tests cover both shapes plus mixed lines in the same file.

  This lays the groundwork for richer consumer-side tools (atrib-trace, atrib-summarize) that need semantic context to be useful, and for a future spec section formalizing the two-tier "private local + public canonical" pattern (deferred until consumer evidence informs the spec).

## 0.2.0

### Minor Changes

- 79199ee: Add `args_commitment_form` and `result_commitment_form` posture detection (atrib spec §8.3 / D045).

  `@atrib/mcp` `AtribRecord` type gains optional `args_salt` and `result_salt` fields. These were already MAY fields per spec §1.2.1 (lines 293-294 of `atrib-spec.md`) but had not been surfaced in the TypeScript type. JCS-canonical sort positions: `args_salt` between `annotates` and `chain_root` (a-n < a-r < c); `result_salt` between `provenance_token` and `revises` (p < r-e-s < r-e-v). Backward-compatible (absence preserves default posture).

  `@atrib/verify` `PostureAnnotation` gains `args_commitment_form` and `result_commitment_form` fields (`'plain-sha256' | 'salted-sha256'`). Detection is structural per §8.3: presence of `args_salt` / `result_salt` ⇒ `salted-sha256`; absence ⇒ `plain-sha256`. The §8.3 `hmac-sha256` variant is signaled out-of-band and is not structurally detectable.

  5 new tests added; verify package now at 247 passing.

  Implements the args/result commitment-posture half of the §8.3 surface. The `tool_name_form` (§8.2) surface remains blocked on a §1.2.1 spec extension to add `tool_name` as a MAY field.

- 8abcb67: D052 / §1.7.6: cross-attestation type + verifier surface.

  `@atrib/mcp` `AtribRecord` type gains optional `signers?: SignerEntry[]` field for transaction records per spec §1.7.6. New `canonicalCrossAttestationInput(record)` helper exported alongside `canonicalRecord` / `canonicalSigningInput` produces the JCS form with `signers: []` and the top-level `signature` field omitted — the bytes every signer in `signers[]` covers per §1.7.6.

  `@atrib/verify` `verifyRecord()` now surfaces `cross_attestation: { signers_count, signers_valid, missing }` on transaction records (`event_type = transaction`). Verifies each signer's Ed25519 signature against the cross-attestation canonical bytes; flags `missing: true` when below the §1.7.6 normative minimum of 2 verified signers. Per §1.7.6 missing is a SIGNAL, not invalidation: the underlying signature path keeps the record cryptographically valid. Legacy single-signer transaction records (no `signers[]`, top-level `signature` only) surface as `signers_count: 0, missing: true`.

  The verifier's top-level signature check is skipped for transaction records that carry a populated `signers[]` array per §1.2.1's "signature is OPTIONAL on transaction records" clause; in those records `signatureOk` is set to `true` and the actual cryptographic validity flows through `cross_attestation.signers_valid`.

  `spec/conformance/1.7.6/` corpus (5 cases) ships alongside: legacy-single-signer, one-signer (below minimum), two-signers-valid (canonical happy path), three-signers (above minimum), tampered-second-signature (count vs valid independence). Reference test at `packages/verify/test/conformance-1.7.6.test.ts`.

  7 new verifier tests + 5 conformance-corpus reference tests added; verify package now at 279 passing tests.

  **Middleware-side signing of multi-signer transaction records is a separable follow-up.** This change implements the verifier; the producer-side counterparty-coordination protocol (how the agent and counterparty exchange signatures over the same canonical bytes) is its own design problem and ships in a separate ADR when payment-protocol integration work begins.

- 3161e59: D061: add `tool_name`, `args_hash`, `result_hash` to the §1.2.1 canonical record schema.

  Closes the spec gap where §8.2 (opaque-name posture) and §8.3 (salted-commitment posture) referenced record fields that had never been added to the §1.2 canonical shape. Verifier surfaces for both postures now have structural inputs to detect against.

  `@atrib/mcp` `AtribRecord` type gains three optional fields with documented JCS-canonical sort positions:
  - `tool_name?` — last in current schema (`t-o-...` after `t-i-...`)
  - `args_hash?` — between `annotates` and `args_salt`
  - `result_hash?` — between `provenance_token` and `result_salt`

  All three default to absence (preserving the §8.1 default posture). Backward-compatible: existing records continue to verify identically.

  `@atrib/verify` `PostureAnnotation` gains `tool_name_form: 'hashed' | 'plain' | null`. Detection per the D061 fix to §8.2's regex ambiguity:
  - `'hashed'` when value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
  - `'plain'` for any other present value (verbatim and opaque-label NOT structurally distinguishable; both surface as plain)
  - `null` when the field is absent

  5 new verifier tests + 4 conformance-corpus reference tests added; verify package now at 267 passing tests. New `spec/conformance/8.2/` corpus (4 cases) ships alongside.

  §8.2 prose updated to acknowledge the regex ambiguity. §8.3 prose clarifies that `args_hash` / `result_hash` are §1.2.1 MAY fields. §1.2.1 standard-shape example record + field table extended with all three fields.

  Middleware-side opt-in (config-gated emission of the new fields) is a separate follow-up; this change is verifier-only and spec-only and does not change the bytes any existing record produces.

- a3d24f9: Add opt-in `disclosure` option to `atrib()` middleware (D061 / §8.2 / §8.3).

  `AtribOptions.disclosure` lets callers opt into producing records with `tool_name`, `args_hash`, and `args_salt` populated. Both dials default to `'omit'`, preserving the §8.1 default posture; existing callers see no behavior change and produce byte-identical records.

  ```ts
  atrib(server, {
    creatorKey,
    serverUrl,
    disclosure: {
      tool_name: 'verbatim', // 'omit' | 'verbatim' | 'hashed'
      args: 'salted-sha256', // 'omit' | 'plain-sha256' | 'salted-sha256'
    },
  })
  ```

  - `tool_name: 'verbatim'` writes the raw tool name from the MCP request.
  - `tool_name: 'hashed'` writes `sha256:<64 hex>` of the verbatim name.
  - `args: 'plain-sha256'` writes `args_hash = sha256(JCS(arguments))`.
  - `args: 'salted-sha256'` generates a 16-byte random salt per record and writes both `args_salt` and `args_hash = sha256(salt ‖ JCS(arguments))`.

  Result-side commitment (`result_hash`/`result_salt`) is intentionally NOT in this surface because signing happens before the upstream handler returns (to support `preCallTransform`). A separate post-call signing path is the next ADR.

  8 new middleware tests added; mcp package now at 384 passing tests.

- d7c806c: Add `disclosure.result` to the middleware opt-in dial (D061 / §8.3 result-side commitment).

  `AtribOptions.disclosure.result: 'omit' | 'plain-sha256' | 'salted-sha256'` populates `result_hash` (and optionally `result_salt`) on the signed record. The result is hashed BEFORE atrib mutates `result._meta` with its own propagation token, so the commitment covers exactly what the upstream handler returned. Same scheme as the existing `args` disclosure.

  ```ts
  atrib(server, {
    creatorKey,
    serverUrl,
    disclosure: {
      args: 'salted-sha256',
      result: 'salted-sha256',
    },
  })
  ```

  **Compatibility note**: `disclosure.result` requires the post-call signing path and is INCOMPATIBLE with `preCallTransform` (which signs pre-call when no result is available). When both are set, `result` disclosure is silently inactive on the pre-call path and an init-time warning fires so the conflict is visible at config time rather than as silently-missing fields.

  4 new middleware tests added; mcp package now at 388 passing tests.

  Closes the §8.3 commitment-form middleware surface end-to-end. The verifier's `args_commitment_form` and `result_commitment_form` posture annotations now have real-data inputs.

## 0.1.2

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "Atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)
