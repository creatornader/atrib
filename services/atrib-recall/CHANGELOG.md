# @atrib/recall

## 0.3.2

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.3.1

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.3.0

### Minor Changes

- 895f406: Default mirror discovery is now directory-scan, not single-file. Envelope shape parsed alongside bare records.

  Two latent bugs compounded into recall being blind to ~97% of an agent's own history:
  - The default `ATRIB_RECORD_FILE` pointed at one specific producer's mirror (`mcp-wrap-claude-code.jsonl`). When that producer goes silent, recall returns stale results. The wrapper had been silently dormant since 2026-05-05; current production records land in `atrib-emit-claude-code.jsonl` via the Layer-2 hooks.
  - Even pointing recall at the emit mirror would have returned zero records because the parser required `spec_version` at the top level. emit writes the [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelope shape `{record, proof, _local}` where `spec_version` is nested under `.record`.

  New design:
  - Default: scan `ATRIB_MIRROR_DIR` (defaults `~/.atrib/records/`) and load every `*.jsonl`. The directory IS the contract per spec [§5.9](../atrib-spec.md#59-local-mirror-conventions).
  - Back-compat: if `ATRIB_RECORD_FILE` is set, use only that file.
  - Parser handles both bare records and [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelopes; nested record extraction matches the wrapper-side `normalizeMirrorLine`.
  - Result includes `record_files` array; legacy `record_file` kept as deprecated single-string for back-compat with existing callers.

  Three new exports: `loadRecordsFromDir(dir)`, `discoverRecords(recordFile?)`, plus the existing `loadRecords(path)` extended with envelope parsing. 17 prior tests still pass; 10 new tests added covering envelope parsing, dir-scan, mixed shapes, back-compat priority, ignored non-jsonl files.

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.2.1

### Patch Changes

- 2204434: Documentation refresh — package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

  `@atrib/recall` ships its first README (the package was previously internal and never had a public README).

  `@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

  `@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

  CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

  No code changes — purely docs + metadata for npmjs.com surface accuracy.

> **Pre-0.2.0 versions exist in this changelog but were never published to npm.**
> The package moved from a workspace-private location and flipped public on 2026-05-05; the prior 0.1.0 bump was internal. The first npm-published version is 0.2.0.

## 0.2.0

### Minor Changes

- c35127f: Publish the 4 cognitive-primitive MCP servers to npm.

  These were previously workspace-private (developers ran them from source). They now ship as installable npm packages so any agent runtime can pull them in directly.

  `@atrib/emit` — producer-side: agents sign explicit observations, annotations, and revisions beyond what middleware auto-signs.

  `@atrib/recall` — consumer-side: agents query their own provable past from the local signed-record mirror with per-record signature verification. Defaults to `~/.atrib/records/mcp-wrap-claude-code.jsonl`; override via `ATRIB_RECORD_FILE` env.

  `@atrib/trace` — consumer-side: walks `informed_by` chains backward from a record_hash to surface the reasoning chain that produced it.

  `@atrib/summarize` — consumer-side: synthesizes a narrative across N records via an OpenAI-compatible LLM so agents read context, not raw record bytes.

  Naming convention rationale: package names dropped the redundant `@atrib/atrib-` prefix in favor of `@atrib/<noun>` (per the `@atrib/<noun>` namespace pattern already used by `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, etc). Binary names retained the `atrib-<noun>` form to preserve operator hook-script compatibility — package rename only, no binary rename.

  Also adopted: the local mirror filename convention `<wrapper-name>-<agent>.jsonl` per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) with the default wrapper name `mcp-wrap`. `@atrib/recall`'s default mirror path picks up this convention; existing wrappers using a different `name` config value should override `ATRIB_RECORD_FILE` accordingly.
