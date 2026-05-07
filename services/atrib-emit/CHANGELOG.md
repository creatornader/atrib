# @atrib/emit

## 0.4.2

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.4.1

### Patch Changes

- 2204434: Documentation refresh — package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

  `@atrib/recall` ships its first README (the package was previously internal and never had a public README).

  `@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

  `@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

  CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

  No code changes — purely docs + metadata for npmjs.com surface accuracy.

> **Pre-0.4.0 versions exist in this changelog but were never published to npm.**
> The package was renamed from `@atrib/atrib-emit` to `@atrib/emit` and flipped public on 2026-05-05; prior bumps (0.2.0, 0.3.0) were workspace-private. The first npm-published version is 0.4.0.

## 0.4.0

### Minor Changes

- c35127f: Publish the 4 cognitive-primitive MCP servers to npm.

  These were previously workspace-private (developers ran them from source). They now ship as installable npm packages so any agent runtime can pull them in directly.

  `@atrib/emit` — producer-side: agents sign explicit observations, annotations, and revisions beyond what middleware auto-signs.

  `@atrib/recall` — consumer-side: agents query their own provable past from the local signed-record mirror with per-record signature verification. Defaults to `~/.atrib/records/mcp-wrap-claude-code.jsonl`; override via `ATRIB_RECORD_FILE` env.

  `@atrib/trace` — consumer-side: walks `informed_by` chains backward from a record_hash to surface the reasoning chain that produced it.

  `@atrib/summarize` — consumer-side: synthesizes a narrative across N records via an OpenAI-compatible LLM so agents read context, not raw record bytes.

  Naming convention rationale: package names dropped the redundant `@atrib/atrib-` prefix in favor of `@atrib/<noun>` (per the `@atrib/<noun>` namespace pattern already used by `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, etc). Binary names retained the `atrib-<noun>` form to preserve operator hook-script compatibility — package rename only, no binary rename.

  Also adopted: the local mirror filename convention `<wrapper-name>-<agent>.jsonl` per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) with the default wrapper name `mcp-wrap`. `@atrib/recall`'s default mirror path picks up this convention; existing wrappers using a different `name` config value should override `ATRIB_RECORD_FILE` accordingly.

## 0.3.0

### Minor Changes

- 3c2d0b7: Add `revises` field for revision event_type ([D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) / spec [§1.2.9](../../atrib-spec.md#129-revises)).

  `atrib-emit` now accepts a top-level `revises: "sha256:<64-hex>"` field on the `emit` tool input. REQUIRED when `event_type` is `https://atrib.dev/v1/types/revision`; FORBIDDEN on any other event_type. The require/forbid invariant surfaces as a warnings-only response per [§5.8](../../atrib-spec.md#58-degradation-contract) rather than producing a malformed signed record.

  `BuildEmitRecordInput.revises` flows through `buildAndSignEmitRecord` into the signed `AtribRecord`. JCS canonical-form ordering puts `revises` after `provenance_token` (r > p) and before `session_token` (r < s), handled automatically by `canonicalize`.

  This mirrors the `annotates` plumbing shipped in the previous release. Required for retrospective-extraction producers that classify cognitive events as revisions and need to emit them with a referent record_hash pointing at the predecessor being superseded.

  Three new integration tests cover round-trip emit, the require-when-revision invariant, and the FORBIDDEN-elsewhere invariant.

## 0.2.0

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
