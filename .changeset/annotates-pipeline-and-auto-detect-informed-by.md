---
"@atrib/mcp": minor
"@atrib/atrib-emit": minor
"@atrib/mcp-wrap": minor
---

Annotates pipeline and auto-detect informed_by from args.

`@atrib/mcp` adds:

- `autoDetectInformedByFromArgs?: boolean` option on `AtribOptions` (default `false`). When `true`, the middleware scans tool-call params for `sha256:<64hex>` substrings (skipping the `chain_root` field) and merges them with the explicit `informedBy` callback result, lex-sorted per spec §1.2.5. Records with auto-detected references gain INFORMED_BY graph edges automatically.
- `SHA256_REF_PATTERN`, `SHA256_REF_GLOBAL_PATTERN`, and `extractRecordHashes(value)` exported from the package root. These are co-located so producer-side consumers (middleware, atrib-emit, out-of-tree wrappers) share one definition. Drift between them would silently produce records with inconsistent reference detection.
- Three previously-internal `EVENT_TYPE_*_URI` constants now re-exported from the package root: `EVENT_TYPE_DIRECTORY_ANCHOR_URI`, `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`. The other three were already exported.

`atrib-emit` adds:

- Top-level `annotates` field on the `emit` tool input schema (`sha256:<64-hex>`). REQUIRED when `event_type` is the annotation URI; FORBIDDEN on any other event_type, per spec §1.2.7 / D058. Validation surfaces as warnings-only response per §5.8 rather than producing a malformed signed record.
- `BuildEmitRecordInput.annotates` flows through to the signed `AtribRecord`.

`@atrib/mcp-wrap` defaults `autoDetectInformedByFromArgs: true` so wrapper consumers (Claude Code, Cursor, generic stdio hosts) get auto-detect for free without explicit middleware configuration.
