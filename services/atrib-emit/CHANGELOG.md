# @atrib/atrib-emit

## 0.3.0

### Minor Changes

- 3c2d0b7: Add `revises` field for revision event_type (D059 / spec §1.2.9).

  `atrib-emit` now accepts a top-level `revises: "sha256:<64-hex>"` field on the `emit` tool input. REQUIRED when `event_type` is `https://atrib.dev/v1/types/revision`; FORBIDDEN on any other event_type. The require/forbid invariant surfaces as a warnings-only response per §5.8 rather than producing a malformed signed record.

  `BuildEmitRecordInput.revises` flows through `buildAndSignEmitRecord` into the signed `AtribRecord`. JCS canonical-form ordering puts `revises` after `provenance_token` (r > p) and before `session_token` (r < s), handled automatically by `canonicalize`.

  This mirrors the `annotates` plumbing shipped in the previous release. Required for retrospective-extraction producers that classify cognitive events as revisions and need to emit them with a referent record_hash pointing at the predecessor being superseded.

  Three new integration tests cover round-trip emit, the require-when-revision invariant, and the FORBIDDEN-elsewhere invariant.

## 0.2.0

### Minor Changes

- b22913a: Annotates pipeline and auto-detect informed_by from args.

  `@atrib/mcp` adds:
  - `autoDetectInformedByFromArgs?: boolean` option on `AtribOptions` (default `false`). When `true`, the middleware scans tool-call params for `sha256:<64hex>` substrings (skipping the `chain_root` field) and merges them with the explicit `informedBy` callback result, lex-sorted per spec §1.2.5. Records with auto-detected references gain INFORMED_BY graph edges automatically.
  - `SHA256_REF_PATTERN`, `SHA256_REF_GLOBAL_PATTERN`, and `extractRecordHashes(value)` exported from the package root. These are co-located so producer-side consumers (middleware, atrib-emit, out-of-tree wrappers) share one definition. Drift between them would silently produce records with inconsistent reference detection.
  - Three previously-internal `EVENT_TYPE_*_URI` constants now re-exported from the package root: `EVENT_TYPE_DIRECTORY_ANCHOR_URI`, `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`. The other three were already exported.

  `atrib-emit` adds:
  - Top-level `annotates` field on the `emit` tool input schema (`sha256:<64-hex>`). REQUIRED when `event_type` is the annotation URI; FORBIDDEN on any other event_type, per spec §1.2.7 / D058. Validation surfaces as warnings-only response per §5.8 rather than producing a malformed signed record.
  - `BuildEmitRecordInput.annotates` flows through to the signed `AtribRecord`.

  `@atrib/mcp-wrap` defaults `autoDetectInformedByFromArgs: true` so wrapper consumers (Claude Code, Cursor, generic stdio hosts) get auto-detect for free without explicit middleware configuration.

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.3

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

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
