# @atrib/directory

## 0.2.1

### Patch Changes

- 1378d4f: Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.

## 0.2.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  atrib's own public APIs are unchanged, and signing-output, hash-output, and
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
  - Lowercased "atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)
