# @atrib/mcp-wrap

## 0.4.3

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.4.2

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.4.1

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0

## 0.4.0

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

## 0.3.4

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.3.3

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.3.2

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.3.0

### Minor Changes

- b22913a: Annotates pipeline and auto-detect informed_by from args.

  `@atrib/mcp` adds:
  - `autoDetectInformedByFromArgs?: boolean` option on `AtribOptions` (default `false`). When `true`, the middleware scans tool-call params for `sha256:<64hex>` substrings (skipping the `chain_root` field) and merges them with the explicit `informedBy` callback result, lex-sorted per spec [§1.2.5](../../atrib-spec.md#125-informed_by). Records with auto-detected references gain INFORMED_BY graph edges automatically.
  - `SHA256_REF_PATTERN`, `SHA256_REF_GLOBAL_PATTERN`, and `extractRecordHashes(value)` exported from the package root. These are co-located so producer-side consumers (middleware, atrib-emit, out-of-tree wrappers) share one definition. Drift between them would silently produce records with inconsistent reference detection.
  - Three previously-internal `EVENT_TYPE_*_URI` constants now re-exported from the package root: `EVENT_TYPE_DIRECTORY_ANCHOR_URI`, `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`. The other three were already exported.

  `atrib-emit` adds:
  - Top-level `annotates` field on the `emit` tool input schema (`sha256:<64-hex>`). REQUIRED when `event_type` is the annotation URI; FORBIDDEN on any other event_type, per spec [§1.2.7](../../atrib-spec.md#127-annotates) / [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05). Validation surfaces as warnings-only response per [§5.8](../../atrib-spec.md#58-degradation-contract) rather than producing a malformed signed record.
  - `BuildEmitRecordInput.annotates` flows through to the signed `AtribRecord`.

  `@atrib/mcp-wrap` defaults `autoDetectInformedByFromArgs: true` so wrapper consumers (Claude Code, Cursor, generic stdio hosts) get auto-detect for free without explicit middleware configuration.

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.2.0

### Minor Changes

- 03fe031: Extend the local mirror with an optional pre-sign payload sidecar.

  The local jsonl mirror previously stored only the bare signed AtribRecord, so consumers (recall, atrib-trace, atrib-summarize) saw only event_type + hashes, never the semantic content (tool name, args, result, observation payload) the record's content_id / args_hash / result_hash COMMITS TO. This made the mirror impoverished relative to what an agent's own working memory needs.

  `@atrib/mcp` `AtribOptions.onRecord` now accepts an optional second argument `OnRecordSidecar` carrying `{ toolName?, args?, result? }`, the pre-sign payload context captured from the wrapped tool call. The signed record bytes are unchanged; the sidecar lives at the host's persistence layer only and is never sent to the public log (which still only sees the bare AtribRecord via the submission queue).

  `@atrib/mcp-wrap`'s `persistRecord` extends to accept the sidecar and write a new envelope shape `{ record, _local?, written_at }` per line. `loadAutoChainSeed` tolerates BOTH the new envelope shape AND legacy bare-record entries from prior wrapper versions, fully backward-compatible. Tests cover both shapes plus mixed lines in the same file.

  This lays the groundwork for richer consumer-side tools (atrib-trace, atrib-summarize) that need semantic context to be useful, and for a future spec section formalizing the two-tier "private local + public canonical" pattern (deferred until consumer evidence informs the spec).

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

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
